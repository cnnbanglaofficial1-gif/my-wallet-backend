const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// In-Memory Database Storage
let users = {};
let depositHistory = [];
let withdrawRequests = [];

// Real SMS Received Buffer (Populated by SMS Forwarder App)
let verifiedSMSList = []; // Stores { trxId, amount, method, sender }

let config = {
    rotationMinutes: 1,
    methods: {
        bkash: {
            name: "bKash Personal",
            icon: "bkash",
            enabled: true,
            limit: 20000,
            numbers: [
                { num: "01700000001", collected: 0 },
                { num: "01700000002", collected: 0 }
            ],
            currentIndex: 0,
            lastRotated: Date.now()
        },
        nagad: {
            name: "Nagad Personal",
            icon: "nagad",
            enabled: true,
            limit: 20000,
            numbers: [
                { num: "01800000001", collected: 0 }
            ],
            currentIndex: 0,
            lastRotated: Date.now()
        },
        rocket: {
            name: "Rocket Personal",
            icon: "rocket",
            enabled: true,
            limit: 20000,
            numbers: [
                { num: "01900000001", collected: 0 }
            ],
            currentIndex: 0,
            lastRotated: Date.now()
        },
        upay: {
            name: "Upay Personal",
            icon: "upay",
            enabled: true,
            limit: 20000,
            numbers: [
                { num: "01300000001", collected: 0 }
            ],
            currentIndex: 0,
            lastRotated: Date.now()
        }
    }
};

const ADMIN_PASSWORD = "adminsecretpass";

// Helper: Get Active Number with Auto-Rotation
function getActiveNumber(methodKey) {
    const method = config.methods[methodKey];
    if (!method || !method.enabled || !method.numbers || method.numbers.length === 0) return null;

    const rotationIntervalMs = (config.rotationMinutes || 1) * 60 * 1000;
    if (Date.now() - method.lastRotated >= rotationIntervalMs) {
        method.currentIndex = (method.currentIndex + 1) % method.numbers.length;
        method.lastRotated = Date.now();
    }

    let active = method.numbers[method.currentIndex];
    if (active.collected >= method.limit) {
        let found = false;
        for (let i = 0; i < method.numbers.length; i++) {
            let nextIndex = (method.currentIndex + i) % method.numbers.length;
            if (method.numbers[nextIndex].collected < method.limit) {
                method.currentIndex = nextIndex;
                active = method.numbers[nextIndex];
                found = true;
                break;
            }
        }
        if (!found) return null;
    }
    return active.num;
}

// Helper: Extract TrxID & Amount from Raw SMS Text
function parsePaymentSMS(smsText) {
    let trxId = null;
    let amount = null;

    // TrxID Matching (bKash/Nagad standard formats like 765GQY7O or B7X8Y9Z)
    const trxMatch = smsText.match(/(?:TrxID|TxnID|Trx ID|Txn ID|ID)[:\s]*([A-Za-z0-9]+)/i);
    if (trxMatch) {
        trxId = trxMatch[1].trim();
    }

    // Amount Matching (e.g. Tk 500.00 or 500 BDT)
    const amtMatch = smsText.match(/(?:Tk|BDT|amount)[:\s]*([\d\.]+)/i);
    if (amtMatch) {
        amount = parseFloat(amtMatch[1]);
    }

    return { trxId, amount };
}

// ==========================================
// 📲 1. SMS Forwarder Webhook Endpoint
// ==========================================
// Apnar Android SMS Forwarder App ei URL-e POST request pathabe
app.post('/api/receive-sms', (req, res) => {
    const { smsText, sender, secret } = req.body;

    // Optional Security Secret Check
    if (secret && secret !== "my_sms_secret_123") {
        return res.status(403).json({ success: false, message: "Unauthorized SMS forwarder" });
    }

    if (!smsText) {
        return res.status(400).json({ success: false, message: "No SMS content provided" });
    }

    // Auto Parse SMS
    const parsed = parsePaymentSMS(smsText);

    if (parsed.trxId) {
        // Save to verified SMS list if not already present
        const exists = verifiedSMSList.some(item => item.trxId === parsed.trxId);
        if (!exists) {
            verifiedSMSList.push({
                trxId: parsed.trxId,
                amount: parsed.amount,
                sender: sender || "Unknown",
                used: false,
                receivedAt: Date.now()
            });
            console.log(`[SMS Received] TrxID: ${parsed.trxId}, Amount: ${parsed.amount}`);
        }
        return res.json({ success: true, message: "SMS parsed and stored successfully", parsed });
    }

    res.status(400).json({ success: false, message: "Could not extract TrxID from SMS" });
});


// ==========================================
// 💳 2. User Deposit Request (Strict Verification)
// ==========================================
app.post('/api/deposit', (req, res) => {
    const { phone, trxId, amount, methodKey } = req.body;

    if (!users[phone]) {
        return res.status(400).json({ success: false, message: "User pawa jayni! Prothome login/register korun." });
    }

    if (!trxId || !amount) {
        return res.status(400).json({ success: false, message: "Sothik TrxID ebong পরিমাণ din." });
    }

    const cleanTrx = trxId.trim();
    const reqAmount = parseFloat(amount);

    // Check if this TrxID exists in SMS Forwarder logs
    const smsIndex = verifiedSMSList.findIndex(item => 
        item.trxId.toLowerCase() === cleanTrx.toLowerCase() && !item.used
    );

    if (smsIndex === -1) {
        // ❌ Strict Rejection: SMS Not Received yet or Invalid TrxID
        depositHistory.unshift({
            phone,
            trxId: cleanTrx,
            amount: reqAmount,
            method: config.methods[methodKey] ? config.methods[methodKey].name : methodKey,
            status: "Failed (Invalid TrxID)",
            date: new Date().toLocaleTimeString()
        });

        return res.status(400).json({ 
            success: false, 
            message: "ভুল TrxID! আপনার পেমেন্টের SMS আমাদের সার্ভারে পাওয়া যায়নি। সঠিক TrxID দিন।" 
        });
    }

    const matchedSMS = verifiedSMSList[smsIndex];

    // Optional: Check if amount matches
    if (matchedSMS.amount && matchedSMS.amount !== reqAmount) {
        return res.status(400).json({ 
            success: false, 
            message: `পরিমাণ মিলছে না! SMS অনুযায়ী প্রাপ্ত পরিমাণ: ${matchedSMS.amount} BDT` 
        });
    }

    // ✅ Match Success! Mark SMS as used and add balance
    verifiedSMSList[smsIndex].used = true;
    users[phone].balance += reqAmount;

    const num = getActiveNumber(methodKey);
    const method = config.methods[methodKey];
    if (method && num) {
        const targetObj = method.numbers.find(n => n.num === num);
        if (targetObj) targetObj.collected += reqAmount;
    }

    depositHistory.unshift({
        phone,
        trxId: cleanTrx,
        amount: reqAmount,
        method: method ? method.name : methodKey,
        status: "Approved (Verified SMS)",
        date: new Date().toLocaleTimeString()
    });

    res.json({ 
        success: true, 
        message: "ডিপোজিট সফল হয়েছে! আপনার ব্যালেন্স যুক্ত করা হয়েছে।" 
    });
});


// ==========================================
// 👤 Standard App Routes
// ==========================================
app.post('/api/register', (req, res) => {
    const { phone, pass } = req.body;
    if (!users[phone]) {
        users[phone] = { pass, balance: 0, wallets: {} };
        return res.json({ success: true, message: "Registration safol hoyeche!" });
    }
    if (users[phone].pass === pass) {
        return res.json({ success: true, message: "Login safol hoyeche!" });
    }
    return res.status(400).json({ success: false, message: "Bhul password!" });
});

app.get('/api/balance', (req, res) => {
    const { phone } = req.query;
    if (users[phone]) {
        return res.json({ balance: users[phone].balance });
    }
    res.json({ balance: 0 });
});

app.get('/api/active-methods', (req, res) => {
    let result = {};
    for (let key in config.methods) {
        if (config.methods[key].enabled) {
            result[key] = {
                name: config.methods[key].name,
                icon: config.methods[key].icon,
                activeAccount: getActiveNumber(key)
            };
        }
    }
    res.json(result);
});

app.get('/api/deposit-history', (req, res) => {
    const { phone } = req.query;
    const history = depositHistory.filter(item => item.phone === phone);
    res.json(history);
});

// Multi-Wallet Binding
app.post('/api/bind-wallet', (req, res) => {
    const { phone, category, accountNumber, pin } = req.body;
    if (!users[phone]) return res.status(400).json({ success: false, message: "User pawa jayni" });

    if (!users[phone].wallets) users[phone].wallets = {};

    users[phone].wallets[category] = {
        number: accountNumber,
        pin: pin
    };

    res.json({ success: true, message: `${category} wallet bind o pin save hoyeche!` });
});

app.get('/api/get-wallets', (req, res) => {
    const { phone } = req.query;
    if (users[phone] && users[phone].wallets) {
        return res.json(users[phone].wallets);
    }
    res.json({});
});

app.post('/api/withdraw', (req, res) => {
    const { phone, category, amount, pin } = req.body;
    if (!users[phone]) return res.status(400).json({ success: false, message: "User pawa jayni" });

    const userWallet = users[phone].wallets ? users[phone].wallets[category] : null;
    if (!userWallet) return res.status(400).json({ success: false, message: `Apnar ${category} wallet bind kora nei!` });

    if (userWallet.pin !== pin) return res.status(400).json({ success: false, message: "Bhul secret pin!" });

    const reqAmt = parseFloat(amount);
    if (users[phone].balance < reqAmt) return res.status(400).json({ success: false, message: "Poryapto balance nei!" });

    users[phone].balance -= reqAmt;

    const reqObj = {
        id: "WD_" + Date.now(),
        phone,
        accountType: category,
        accountNumber: userWallet.number,
        amount: reqAmt,
        status: "Pending",
        date: new Date().toLocaleTimeString()
    };

    withdrawRequests.unshift(reqObj);
    res.json({ success: true, message: "Withdraw request pathano hoyeche!" });
});

app.get('/api/user-withdraws', (req, res) => {
    const { phone } = req.query;
    const list = withdrawRequests.filter(r => r.phone === phone);
    res.json(list);
});

// Admin Panel APIs
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        return res.json({ success: true, config, withdrawRequests, verifiedSMSList });
    }
    res.status(400).json({ success: false, message: "Bhul password!" });
});

app.post('/api/admin/approve-withdraw', (req, res) => {
    const { password, requestId } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(400).json({ success: false, message: "Unauthorized" });

    const reqObj = withdrawRequests.find(w => w.id === requestId);
    if (reqObj) {
        reqObj.status = "Approved";
        return res.json({ success: true, withdrawRequests });
    }
    res.status(404).json({ success: false, message: "Request not found" });
});

app.post('/api/admin/update-config', (req, res) => {
    const { password, methods, rotationMinutes } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(400).json({ success: false, message: "Unauthorized" });

    if (methods) config.methods = methods;
    if (rotationMinutes) config.rotationMinutes = parseFloat(rotationMinutes);

    res.json({ success: true, message: "Configuration save kora hoyeche!" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
