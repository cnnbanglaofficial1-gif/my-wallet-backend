const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let users = {}; 
let verifiedTransactions = []; 
let depositHistory = {}; 
let withdrawRequests = []; 
let userBoundWallets = {}; // Format: { phone: { bKash: {number, pin}, Nagad: {number, pin}, Rocket: {number, pin} } }

let systemConfig = {
    adminPassword: "adminsecretpass",
    rotationMinutes: 1, 
    methods: {
        bkash_send: { name: "Send Money Bkash", enabled: true, limit: 20000, numbers: [{num: "01602319623", collected: 0}], type: "number", icon: "bkash" },
        nagad_send: { name: "Send Money Nagad", enabled: true, limit: 20000, numbers: [{num: "01601884100", collected: 0}], type: "number", icon: "nagad" },
        bkash_personal: { name: "Bkash Personal", enabled: true, limit: 20000, numbers: [], type: "number", icon: "bkash" },
        nagad_personal: { name: "Nagad Personal", enabled: true, limit: 20000, numbers: [], type: "number", icon: "nagad" },
        nagad_cashout: { name: "NAGAD Cashout", enabled: true, limit: 20000, numbers: [], type: "number", icon: "nagad" },
        bkash_cashout: { name: "Bkash Cashout", enabled: true, limit: 20000, numbers: [], type: "number", icon: "bkash" },
        rocket: { name: "ROCKET", enabled: true, limit: 20000, numbers: [], type: "number", icon: "rocket" },
        usdt: { name: "USDT", enabled: true, limit: 1000, numbers: [], type: "address", icon: "usdt" }
    }
};

function getActiveAccount(methodKey) {
    const method = systemConfig.methods[methodKey];
    if (!method || !method.enabled || !method.numbers || method.numbers.length === 0) return null;
    const validNumbers = method.numbers.filter(item => item.collected < method.limit);
    if (validNumbers.length === 0) return null; 
    const intervalMs = (systemConfig.rotationMinutes || 1) * 60 * 1000;
    const currentIndex = Math.floor(Date.now() / intervalMs) % validNumbers.length;
    return validNumbers[currentIndex].num;
}

app.get('/api/active-methods', (req, res) => {
    let activeList = {};
    for (let key in systemConfig.methods) {
        const item = systemConfig.methods[key];
        if (item.enabled) {
            const activeAcc = getActiveAccount(key);
            activeList[key] = { name: item.name, activeAccount: activeAcc, type: item.type, icon: item.icon };
        }
    }
    res.json(activeList);
});

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === systemConfig.adminPassword) return res.json({ success: true, config: systemConfig, withdrawRequests });
    res.json({ success: false, message: "Invalid Admin Password!" });
});

app.post('/api/admin/update-config', (req, res) => {
    const { password, methods, rotationMinutes } = req.body;
    if (password !== systemConfig.adminPassword) return res.json({ success: false, message: "Unauthorized!" });
    if (methods) {
        for(let key in methods) {
            let incoming = methods[key];
            let existingMap = {};
            if(systemConfig.methods[key]) {
                systemConfig.methods[key].numbers.forEach(n => { existingMap[n.num] = n.collected; });
            }
            let rawVal = incoming.numbers;
            let numList = [];
            if (Array.isArray(rawVal)) {
                rawVal.forEach(item => {
                    let text = typeof item === 'string' ? item : item.num;
                    if(text) text.split(/[\n,]+/).forEach(s => { if(s.trim()) numList.push(s.trim()); });
                });
            } else if (typeof rawVal === 'string') {
                numList = rawVal.split(/[\n,]+/).map(n => n.trim()).filter(n => n !== "");
            }
            methods[key].numbers = numList.map(numVal => ({ num: numVal, collected: existingMap[numVal] !== undefined ? existingMap[numVal] : 0 }));
            if(systemConfig.methods[key]) methods[key].icon = systemConfig.methods[key].icon;
        }
        systemConfig.methods = methods;
    }
    if (rotationMinutes) systemConfig.rotationMinutes = parseInt(rotationMinutes) || 1;
    res.json({ success: true, message: "Config updated successfully!", systemConfig });
});

app.post('/api/admin/approve-withdraw', (req, res) => {
    const { password, requestId } = req.body;
    if (password !== systemConfig.adminPassword) return res.json({ success: false, message: "Unauthorized!" });
    const reqItem = withdrawRequests.find(r => r.id === requestId);
    if (reqItem) {
        reqItem.status = "Approved (সফল)";
        return res.json({ success: true, withdrawRequests });
    }
    res.json({ success: false, message: "Request not found!" });
});

app.post('/api/register', (req, res) => {
    const { phone, pass } = req.body;
    if (!phone || !pass) return res.json({ message: "Mobile and password required!" });
    if (users[phone]) return res.json({ message: "Login Successful!" });
    users[phone] = { pass, balance: 0 };
    if (!depositHistory[phone]) depositHistory[phone] = [];
    if (!userBoundWallets[phone]) userBoundWallets[phone] = {};
    res.json({ message: "Registration Successful!" });
});

app.get('/api/balance', (req, res) => {
    const { phone } = req.query;
    const user = users[phone];
    res.json({ balance: user ? user.balance : 0 });
});

// Single Account per category & PIN Reset System
app.post('/api/bind-wallet', (req, res) => {
    const { phone, category, accountNumber, pin } = req.body;
    if(!phone || !category || !accountNumber || !pin) return res.json({ success: false, message: "Sokol field puron korun!" });
    
    if(!userBoundWallets[phone]) userBoundWallets[phone] = {};
    
    const existing = userBoundWallets[phone][category];
    if (existing) {
        if (existing.number !== accountNumber) {
            return res.json({ success: false, message: `Apnar ${category} account sobshomoyer jonno (${existing.number}) bind kora ase! Number poriborton kora jabe na.` });
        }
        // Update / Reset PIN
        existing.pin = pin;
        return res.json({ success: true, message: `${category} PIN safollobhabe Reset/Update hoyeche!` });
    }

    userBoundWallets[phone][category] = {
        number: accountNumber,
        pin: pin,
        date: new Date().toISOString().substring(0, 10)
    };
    res.json({ success: true, message: `${category} account safollobhabe Bind hoyeche!` });
});

app.get('/api/get-wallets', (req, res) => {
    const { phone } = req.query;
    res.json(userBoundWallets[phone] || {});
});

// Strict Withdraw Request with mandatory PIN matching
app.post('/api/withdraw', (req, res) => {
    const { phone, category, amount, pin } = req.body;
    const user = users[phone];
    if(!user) return res.json({ success: false, message: "User pawa jayni! Login korun." });
    
    const userWallets = userBoundWallets[phone] || {};
    const targetWallet = userWallets[category];

    if(!targetWallet) {
        return res.json({ success: false, message: `Prothome ${category} account bind korun!` });
    }

    if(targetWallet.pin !== pin.trim()) {
        return res.json({ success: false, message: "Bhul PIN (Invalid PIN)! Sothik PIN din ba Reset korun." });
    }

    const withdrawAmount = parseFloat(amount);
    if(isNaN(withdrawAmount) || withdrawAmount <= 0) {
        return res.json({ success: false, message: "Sothik pariman din!" });
    }

    if(user.balance < withdrawAmount) {
        return res.json({ success: false, message: "Aparjapto Balance (Insufficient Balance)!" });
    }

    user.balance -= withdrawAmount;
    const now = new Date();
    const formattedDate = now.toISOString().replace('T', ' ').substring(0, 19);

    const newReq = {
        id: 'WD-' + Math.floor(100000 + Math.random() * 900000),
        phone: phone,
        accountType: category,
        accountNumber: targetWallet.number,
        amount: withdrawAmount,
        date: formattedDate,
        status: "Pending (মঞ্জুর অপেক্ষায়)"
    };
    withdrawRequests.unshift(newReq);
    res.json({ success: true, message: "Withdraw Request safollobhabe joma hoyeche!" });
});

app.get('/api/user-withdraws', (req, res) => {
    const { phone } = req.query;
    res.json(withdrawRequests.filter(r => r.phone === phone));
});

app.post('/api/deposit', (req, res) => {
    const { phone, trxId, amount, methodKey } = req.body;
    const user = users[phone];
    if (!user) return res.json({ message: "User not found!" });
    if (!depositHistory[phone]) depositHistory[phone] = [];

    const cleanTrx = trxId.trim().toUpperCase();
    const index = verifiedTransactions.findIndex(t => t.trxId.toUpperCase() === cleanTrx && parseFloat(t.amount) === parseFloat(amount) && !t.used);

    const now = new Date();
    const formattedDate = now.toISOString().replace('T', ' ').substring(0, 19);
    const methodName = systemConfig.methods[methodKey] ? systemConfig.methods[methodKey].name : "Deposit";

    if (index !== -1) {
        const depositAmount = parseFloat(amount);
        user.balance += depositAmount;
        verifiedTransactions[index].used = true;

        if (methodKey && systemConfig.methods[methodKey]) {
            const activeAccNum = getActiveAccount(methodKey);
            const targetNumObj = systemConfig.methods[methodKey].numbers.find(n => n.num === activeAccNum);
            if (targetNumObj) targetNumObj.collected += depositAmount;
        }

        depositHistory[phone].unshift({ method: methodName, trxId: cleanTrx, amount: depositAmount, date: formattedDate, status: "অনুমোদিত (Approved)" });
        return res.json({ message: "Deposit Successful!" });
    } else {
        depositHistory[phone].unshift({ method: methodName, trxId: cleanTrx, amount: parseFloat(amount), date: formattedDate, status: "ব্যর্থ / ভুল (Invalid TrxID)" });
        return res.json({ message: "Error: Invalid TrxID or Amount mismatch!" });
    }
});

app.get('/api/deposit-history', (req, res) => {
    const { phone } = req.query;
    res.json(depositHistory[phone] || []);
});

app.post('/api/sms-webhook', (req, res) => {
    const body = req.body || {};
    const smsText = body.text || body.message || body.SMS || JSON.stringify(body);
    const trxMatch = smsText.match(/TrxID\s+([A-Za-z0-9]+)/i) || smsText.match(/TxnID[:\s]*([A-Za-z0-9]+)/i);
    const amountMatch = smsText.match(/Tk\s*([\d\.]+)/i) || smsText.match(/BDT\s*([\d\.]+)/i);

    if (trxMatch && amountMatch) {
        const trxId = trxMatch[1].trim();
        const amount = parseFloat(amountMatch[1]);
        if (!verifiedTransactions.find(t => t.trxId.toUpperCase() === trxId.toUpperCase())) {
            verifiedTransactions.push({ trxId, amount, used: false });
        }
        return res.json({ status: "Success", trxId, amount });
    }
    res.json({ status: "Failed" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
