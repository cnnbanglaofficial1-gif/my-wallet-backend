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

// Default Wallet Numbers (Admin এগুলি পরিবর্তন করতে পারবে)
let walletConfig = {
    bkash: "01602319623",
    nagad: "01601884100",
    adminSecret: "mysecret123" // Admin panel security password/secret
};

// User Register / Login
app.post('/api/register', (req, res) => {
    const { phone, pass } = req.body;
    if (!phone || !pass) return res.json({ message: "Mobile and password required!" });
    if (users[phone]) return res.json({ message: "Login Successful!" });
    users[phone] = { pass, balance: 0 };
    res.json({ message: "Registration Successful!" });
});

// Balance Check
app.get('/api/balance', (req, res) => {
    const { phone } = req.query;
    const user = users[phone];
    res.json({ balance: user ? user.balance : 0 });
});

// Frontend-এর জন্য বর্তমান সচল নম্বরগুলো সরবরাহ করা
app.get('/api/wallet-info', (req, res) => {
    res.json({
        bkash: walletConfig.bkash,
        nagad: walletConfig.nagad
    });
});

// Admin API: সিক্রেট পাসওয়ার্ড দিয়ে নতুন নম্বর সেট করার জন্য
app.post('/api/admin/update-wallet', (req, res) => {
    const { secret, bkash, nagad } = req.body;
    if (secret !== walletConfig.adminSecret) {
        return res.json({ success: false, message: "Unauthorized: Invalid Secret Key!" });
    }
    if (bkash) walletConfig.bkash = bkash.trim();
    if (nagad) walletConfig.nagad = nagad.trim();
    
    res.json({ success: true, message: "Wallet numbers updated successfully!", walletConfig });
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
app.listen(PORT, () => console.log(`Server running on port `${PORT}`));
