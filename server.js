const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// In-Memory Database Storage
let users = {};
let depositHistory = [];
let withdrawRequests = [];

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
        }
    }
};

const ADMIN_PASSWORD = "admin";

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

// Routes
app.post('/api/register', (req, res) => {
    const { phone, pass } = req.body;
    if (!users[phone]) {
        users[phone] = { pass, balance: 0, wallets: {} };
        return res.json({ success: true, message: "রেজিস্ট্রেশন সফল হয়েছে!" });
    }
    if (users[phone].pass === pass) {
        return res.json({ success: true, message: "লগইন সফল হয়েছে!" });
    }
    return res.status(400).json({ success: false, message: "ভুল পাসওয়ার্ড!" });
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

app.post('/api/deposit', (req, res) => {
    const { phone, trxId, amount, methodKey } = req.body;
    if (!users[phone]) return res.status(400).json({ success: false, message: "ইউজার পাওয়া যায়নি" });

    const num = getActiveNumber(methodKey);
    if (!num) return res.status(400).json({ success: false, message: "পেমেন্ট মেথডটি বর্তমানে বন্ধ রয়েছে" });

    users[phone].balance += parseFloat(amount);

    const method = config.methods[methodKey];
    const targetObj = method.numbers.find(n => n.num === num);
    if (targetObj) targetObj.collected += parseFloat(amount);

    depositHistory.unshift({
        phone,
        trxId,
        amount,
        method: method.name,
        status: "Approved (Auto)",
        date: new Date().toLocaleTimeString()
    });

    res.json({ success: true, message: "ডিপোজিট সফলভাবে জমা হয়েছে!" });
});

app.get('/api/deposit-history', (req, res) => {
    const { phone } = req.query;
    const history = depositHistory.filter(item => item.phone === phone);
    res.json(history);
});

// Multi-Wallet Binding
app.post('/api/bind-wallet', (req, res) => {
    const { phone, category, accountNumber, pin } = req.body;
    if (!users[phone]) return res.status(400).json({ success: false, message: "ইউজার পাওয়া যায়নি" });

    if (!users[phone].wallets) users[phone].wallets = {};

    users[phone].wallets[category] = {
        number: accountNumber,
        pin: pin
    };

    res.json({ success: true, message: `${category} ওয়ালেট বাইন্ড ও পিন সেভ হয়েছে!` });
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
    if (!users[phone]) return res.status(400).json({ success: false, message: "ইউজার পাওয়া যায়নি" });

    const userWallet = users[phone].wallets ? users[phone].wallets[category] : null;
    if (!userWallet) return res.status(400).json({ success: false, message: `আপনার ${category} ওয়ালেট বাইন্ড করা নেই!` });

    if (userWallet.pin !== pin) return res.status(400).json({ success: false, message: "ভুল সিক্রেট পিন!" });

    const reqAmt = parseFloat(amount);
    if (users[phone].balance < reqAmt) return res.status(400).json({ success: false, message: "पर्याप्त ব্যালেন্স নেই!" });

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
    res.json({ success: true, message: "উইথড্র রিকোয়েস্ট পাঠানো হয়েছে!" });
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
        return res.json({ success: true, config, withdrawRequests });
    }
    res.status(400).json({ success: false, message: "ভুল পাসওয়ার্ড!" });
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

    res.json({ success: true, message: "কনফিগারেশন সেভ করা হয়েছে!" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
