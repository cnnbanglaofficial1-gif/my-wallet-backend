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

let systemConfig = {
    adminPassword: "adminsecretpass",
    rotationMinutes: 1, // 1 minute rotation
    methods: {
        bkash_send: { name: "bKash Send Money", enabled: true, limit: 20000, numbers: [{num: "01602319623", collected: 0}], type: "number" },
        nagad_send: { name: "Nagad Send Money", enabled: true, limit: 20000, numbers: [{num: "01601884100", collected: 0}], type: "number" },
        rocket: { name: "Rocket", enabled: false, limit: 20000, numbers: [], type: "number" },
        usdt: { name: "USDT (TRC20)", enabled: false, limit: 1000, numbers: [], type: "address" },
        bkash_cashout: { name: "bKash Cashout", enabled: false, limit: 20000, numbers: [], type: "number" },
        nagad_cashout: { name: "Nagad Cashout", enabled: false, limit: 20000, numbers: [], type: "number" },
        bkash_merchant: { name: "bKash Merchant", enabled: false, limit: 50000, numbers: [], type: "number" },
        nagad_merchant: { name: "Nagad Merchant", enabled: false, limit: 50000, numbers: [], type: "number" },
        bank: { name: "Bank Transfer", enabled: false, limit: 100000, numbers: [], type: "details" }
    }
};

// 1 Minute Rotation Logic: returns strictly ONE active number whose collected < limit
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
            if (activeAcc) {
                activeList[key] = {
                    name: item.name,
                    activeAccount: activeAcc,
                    type: item.type
                };
            }
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
            
            methods[key].numbers = incoming.numbers.map(nObj => {
                const numVal = typeof nObj === 'string' ? nObj : nObj.num;
                return {
                    num: numVal,
                    collected: existingMap[numVal] !== undefined ? existingMap[numVal] : 0
                };
            });
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
    res.json({ message: "Registration Successful!" });
});

app.get('/api/balance', (req, res) => {
    const { phone } = req.query;
    const user = users[phone];
    res.json({ balance: user ? user.balance : 0 });
});

app.post('/api/deposit', (req, res) => {
    const { phone, trxId, amount, methodKey } = req.body;
    const user = users[phone];

    if (!user) return res.json({ message: "User not found! Please login." });

    const cleanTrx = trxId.trim().toUpperCase();
    const index = verifiedTransactions.findIndex(t => 
        t.trxId.toUpperCase() === cleanTrx && parseFloat(t.amount) === parseFloat(amount) && !t.used
    );

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

        return res.json({ message: "Deposit Successful! Balance Added." });
    } else {
        return res.json({ message: "Error: Invalid TrxID, Amount mismatch, or already used!" });
    }
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
