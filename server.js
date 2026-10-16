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

// Admin Credentials & Payment Methods Configuration
let systemConfig = {
    adminPassword: "adminsecretpass", // Admin Panel Security Password
    rotationMinutes: 10,              // Dynamic Number Rotation Time (in Minutes)
    methods: {
        bkash_send: { name: "bKash Send Money", enabled: true, numbers: ["01602319623"], type: "number" },
        nagad_send: { name: "Nagad Send Money", enabled: true, numbers: ["01601884100"], type: "number" },
        rocket: { name: "Rocket", enabled: false, numbers: [], type: "number" },
        usdt: { name: "USDT (TRC20)", enabled: false, numbers: [], type: "address" },
        bkash_cashout: { name: "bKash Cashout", enabled: false, numbers: [], type: "number" },
        nagad_cashout: { name: "Nagad Cashout", enabled: false, numbers: [], type: "number" },
        bkash_merchant: { name: "bKash Merchant", enabled: false, numbers: [], type: "number" },
        nagad_merchant: { name: "Nagad Merchant", enabled: false, numbers: [], type: "number" },
        bank: { name: "Bank Transfer", enabled: false, numbers: [], type: "details" }
    }
};

// 10 Min Loop Math Logic: Dynamic active number fetch
function getActiveAccount(methodKey) {
    const method = systemConfig.methods[methodKey];
    if (!method || !method.enabled || !method.numbers || method.numbers.length === 0) {
        return null;
    }
    const intervalMs = systemConfig.rotationMinutes * 60 * 1000;
    const currentIndex = Math.floor(Date.now() / intervalMs) % method.numbers.length;
    return method.numbers[currentIndex];
}

// Public API for Active Methods and Auto-Rotating Numbers
app.get('/api/active-methods', (req, res) => {
    let activeList = {};
    for (let key in systemConfig.methods) {
        const item = systemConfig.methods[key];
        if (item.enabled) {
            activeList[key] = {
                name: item.name,
                activeAccount: getActiveAccount(key),
                type: item.type
            };
        }
    }
    res.json(activeList);
});

// Admin Login Check
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === systemConfig.adminPassword) {
        return res.json({ success: true, config: systemConfig });
    }
    res.json({ success: false, message: "Invalid Admin Password!" });
});

// Admin Update Config API
app.post('/api/admin/update-config', (req, res) => {
    const { password, methods, rotationMinutes } = req.body;
    if (password !== systemConfig.adminPassword) {
        return res.json({ success: false, message: "Unauthorized!" });
    }
    if (methods) systemConfig.methods = methods;
    if (rotationMinutes) systemConfig.rotationMinutes = parseInt(rotationMinutes) || 10;
    
    res.json({ success: true, message: "System configuration updated successfully!", systemConfig });
});

// User Auth & Balance
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

// Deposit Verification
app.post('/api/deposit', (req, res) => {
    const { phone, trxId, amount } = req.body;
    const user = users[phone];

    if (!user) return res.json({ message: "User not found! Please login." });

    const cleanTrx = trxId.trim().toUpperCase();
    const index = verifiedTransactions.findIndex(t => 
        t.trxId.toUpperCase() === cleanTrx && parseFloat(t.amount) === parseFloat(amount) && !t.used
    );

    if (index !== -1) {
        user.balance += parseFloat(amount);
        verifiedTransactions[index].used = true;
        return res.json({ message: "Deposit Successful! Balance Added." });
    } else {
        return res.json({ message: "Error: Invalid TrxID, Amount mismatch, or already used!" });
    }
});

// SMS Webhook Parser
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
