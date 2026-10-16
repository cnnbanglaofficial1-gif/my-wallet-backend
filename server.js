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
let depositHistory = {}; 
let withdrawRequests = []; // Withdraw requests storage
let userAccountBindings = {}; // User bound bkash/nagad & pin

let systemConfig = {
    adminPassword: "adminsecretpass",
    rotationMinutes: 1, 
    methods: {
        bkash_send: { name: "Send Money Bkash", enabled: true, limit: 20000, numbers: [{num: "01602319623", collected: 0}], type: "number", icon: "https://i.ibb.co/6y18h0L/bkash.png" },
        nagad_send: { name: "Send Money Nagad", enabled: true, limit: 20000, numbers: [{num: "01601884100", collected: 0}], type: "number", icon: "https://i.ibb.co/h8XW5zR/nagad.png" },
        nagad_cashout: { name: "NAGAD Cashout", enabled: true, limit: 20000, numbers: [], type: "number", icon: "https://i.ibb.co/h8XW5zR/nagad.png" },
        bkash_cashout: { name: "Bkash Cashout", enabled: true, limit: 20000, numbers: [], type: "number", icon: "https://i.ibb.co/6y18h0L/bkash.png" },
        rocket: { name: "ROCKET", enabled: true, limit: 20000, numbers: [], type: "number", icon: "https://i.ibb.co/0V1v9v5/rocket.png" },
        usdt: { name: "USDT", enabled: true, limit: 1000, numbers: [], type: "address", icon: "https://i.ibb.co/3s7n96r/usdt.png" },
        bkash_merchant: { name: "bKash Merchant", enabled: false, limit: 50000, numbers: [], type: "number", icon: "https://i.ibb.co/6y18h0L/bkash.png" },
        nagad_merchant: { name: "Nagad Merchant", enabled: false, limit: 50000, numbers: [], type: "number", icon: "https://i.ibb.co/h8XW5zR/nagad.png" },
        bank: { name: "Bank Transfer", enabled: false, limit: 100000, numbers: [], type: "details", icon: "https://i.ibb.co/2k1S0bX/bank.png" }
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
        return res.json({ success: true, config: systemConfig, withdrawRequests });
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
            if(systemConfig.methods[key] && systemConfig.methods[key].icon) {
                methods[key].icon = systemConfig.methods[key].icon;
            }
        }
        systemConfig.methods = methods;
    }
    if (rotationMinutes) systemConfig.rotationMinutes = parseInt(rotationMinutes) || 1;
    res.json({ success: true, message: "System configuration updated successfully!", systemConfig });
});

// Admin Approve Withdraw
app.post('/api/admin/approve-withdraw', (req, res) => {
    const { password, requestId } = req.body;
    if (password !== systemConfig.adminPassword) {
        return res.json({ success: false, message: "Unauthorized!" });
    }
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
    res.json({ message: "Registration Successful!" });
});

app.get('/api/balance', (req, res) => {
    const { phone } = req.query;
    const user = users[phone];
    res.json({ balance: user ? user.balance : 0 });
});

// Bind Account
app.post('/api/bind-account', (req, res) => {
    const { phone, accountType, accountNumber, pin } = req.body;
    if(!phone || !accountNumber || !pin) return res.json({ success: false, message: "Sob field puron korun!" });
    userAccountBindings[phone] = { accountType, accountNumber, pin };
    res.json({ success: true, message: "Account successfully bound!" });
});

app.get('/api/get-binding', (req, res) => {
    const { phone } = req.query;
    res.json(userAccountBindings[phone] || null);
});

// Withdraw Request
app.post('/api/withdraw', (req, res) => {
    const { phone, amount, pin } = req.body;
    const user = users[phone];
    if(!user) return res.json({ success: false, message: "User not found!" });
    const binding = userAccountBindings[phone];
    if(!binding) return res.json({ success: false, message: "Prothome account bind korun!" });
    if(binding.pin !== pin) return res.json({ success: false, message: " ভুল পিন (Invalid PIN)!" });
    
    const withdrawAmount = parseFloat(amount);
    if(user.balance < withdrawAmount) return res.json({ success: false, message: "Pojapto balance nei!" });

    user.balance -= withdrawAmount;
    
    const now = new Date();
    const formattedDate = now.toISOString().replace('T', ' ').substring(0, 19);
    
    const newReq = {
        id: 'WD-' + Math.floor(100000 + Math.random() * 900000),
        phone: phone,
        accountType: binding.accountType,
        accountNumber: binding.accountNumber,
        amount: withdrawAmount,
        date: formattedDate,
        status: "Pending (মঞ্জুর অপেক্ষায়)"
    };
    withdrawRequests.unshift(newReq);

    res.json({ success: true, message: "Withdraw request submitted successfully!" });
});

app.get('/api/user-withdraws', (req, res) => {
    const { phone } = req.query;
    const userReqs = withdrawRequests.filter(r => r.phone === phone);
    res.json(userReqs);
});

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
            if (targetNumObj) targetNumObj.collected += depositAmount;
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
