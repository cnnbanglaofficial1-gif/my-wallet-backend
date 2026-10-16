const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let users = {}; 
let verifiedTransactions = []; 
let depositHistory = {}; // User Deposit History Tracker

let systemConfig = {
    adminPassword: "adminsecretpass",
    rotationMinutes: 1, 
    methods: {
        bkash_send: { name: "Send Money Bkash", enabled: true, limit: 20000, numbers: [{num: "01602319623", collected: 0}], type: "number", icon: "https://i.ibb.co/L5B7n6X/bkash.png" },
        nagad_send: { name: "Send Money Nagad", enabled: true, limit: 20000, numbers: [{num: "01601884100", collected: 0}], type: "number", icon: "https://i.ibb.co/3zd5spt/nagad.png" },
        nagad_cashout: { name: "NAGAD Cashout", enabled: true, limit: 20000, numbers: [], type: "number", icon: "https://i.ibb.co/3zd5spt/nagad.png" },
        bkash_cashout: { name: "Bkash Cashout", enabled: true, limit: 20000, numbers: [], type: "number", icon: "https://i.ibb.co/L5B7n6X/bkash.png" },
        rocket: { name: "ROCKET", enabled: true, limit: 20000, numbers: [], type: "number", icon: "https://i.ibb.co/v4d2Hdt/rocket.png" },
        usdt: { name: "USDT", enabled: true, limit: 1000, numbers: [], type: "address", icon: "https://i.ibb.co/0yLptnF/usdt.png" },
        bkash_merchant: { name: "bKash Merchant", enabled: false, limit: 50000, numbers: [], type: "number", icon: "https://i.ibb.co/L5B7n6X/bkash.png" },
        nagad_merchant: { name: "Nagad Merchant", enabled: false, limit: 50000, numbers: [], type: "number", icon: "https://i.ibb.co/3zd5spt/nagad.png" },
        bank: { name: "Bank Transfer", enabled: false, limit: 100000, numbers: [], type: "details", icon: "https://i.ibb.co/MB27B5X/bank.png" }
    }
};

function getActiveAccount(methodKey) {
    const method = systemConfig.methods[methodKey];
    if (!method || !method.enabled || !method.numbers || method.numbers.length === 0) {
        return null;
    }

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
            activeList[key] = {
                name: item.name,
                activeAccount: activeAcc,
                type: item.type,
                icon: item.icon
            };
        }
    }
    res.json(activeList);
});

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === systemConfig.adminPassword) {
        return res.json({ success: true, config: systemConfig });
    }
    res.json({ success: false, message: "Invalid Admin Password!" });
});

app.post('/api/admin/update-config', (req, res) => {
    const { password, methods, rotationMinutes } = req.body;
    if (password !== systemConfig.adminPassword) {
        return res.json({ success: false, message: "Unauthorized!" });
    }
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
                    if(text) {
                        let splitArr = text.split(/[\n,]+/);
                        splitArr.forEach(s => { if(s.trim()) numList.push(s.trim()); });
                    }
                });
            } else if (typeof rawVal === 'string') {
                numList = rawVal.split(/[\n,]+/).map(n => n.trim()).filter(n => n !== "");
            }

            methods[key].numbers = numList.map(numVal => ({
                num: numVal,
                collected: existingMap[numVal] !== undefined ? existingMap[numVal] : 0
            }));
        }
        systemConfig.methods = methods;
    }
    if (rotationMinutes) systemConfig.rotationMinutes = parseInt(rotationMinutes) || 1;
    
    res.json({ success: true, message: "System configuration updated successfully!", systemConfig });
});

app.post('/api/register', (req, res) => {
    const { phone, pass } = req.body;
    if (!phone || !pass) return res.json({ message: "Mobile and password required!" });
    if (users[phone]) return res.json({ message: "Login Successful!" });
    users[phone] = { pass, balance: 0 };
    if (!depositHistory[phone]) depositHistory[phone] = [];
    res.json({ message: "Registration Successful!" });
});

app.get('/api/balance', (req, res) => {
    const { phone } = req.query;
    const user = users[phone];
    res.json({ balance: user ? user.balance : 0 });
});

// Deposit Submission & Status Logging
app.post('/api/deposit', (req, res) => {
    const { phone, trxId, amount, methodKey } = req.body;
    const user = users[phone];

    if (!user) return res.json({ message: "User not found! Please login." });

    if (!depositHistory[phone]) depositHistory[phone] = [];

    const cleanTrx = trxId.trim().toUpperCase();
    const index = verifiedTransactions.findIndex(t => 
        t.trxId.toUpperCase() === cleanTrx && parseFloat(t.amount) === parseFloat(amount) && !t.used
    );

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
            if (targetNumObj) {
                targetNumObj.collected += depositAmount;
            }
        }

        depositHistory[phone].unshift({
            method: methodName,
            trxId: cleanTrx,
            amount: depositAmount,
            date: formattedDate,
            status: "অনুমোদিত (Approved)"
        });

        return res.json({ message: "Deposit Successful! Balance Added." });
    } else {
        depositHistory[phone].unshift({
            method: methodName,
            trxId: cleanTrx,
            amount: parseFloat(amount),
            date: formattedDate,
            status: "ব্যর্থ / ভুল (Invalid TrxID)"
        });

        return res.json({ message: "Error: Invalid TrxID, Amount mismatch, or already used!" });
    }
});

// Get User Deposit History
app.get('/api/deposit-history', (req, res) => {
    const { phone } = req.query;
    const history = depositHistory[phone] || [];
    res.json(history);
});

app.post('/api/sms-webhook', (req, res) => {
    const body = req.body || {};
    const smsText = body.text || body.message || body.SMS || JSON.stringify(body);

    const trxMatch = smsText.match(/TrxID\s+([A-Za-z0-9]+)/i) || smsText.match(/TxnID[:\s]*([A-Za-z0-9]+)/i);
    const amountMatch = smsText.match(/Tk\s*([\d\.]+)/i) || smsText.match(/BDT\s*([\d\.]+)/i);

    if (trxMatch && amountMatch) {
        const trxId = trxMatch[1].trim();
        const amount = parseFloat(amountMatch[1]);

        const exists = verifiedTransactions.find(t => t.trxId.toUpperCase() === trxId.toUpperCase());
        if (!exists) {
            verifiedTransactions.push({ trxId, amount, used: false });
        }
        return res.json({ status: "Success", trxId, amount });
    }

    res.json({ status: "Parsed Failed / Not a payment SMS" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
