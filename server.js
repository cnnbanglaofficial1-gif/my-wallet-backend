const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Temporary Memory Database (Learning Purpose)
let users = {}; 
let receivedSMSLogs = [
    { trxId: "TRX12345", amount: 500 }, // Simulated received bKash/Nagad SMS
    { trxId: "TRX99999", amount: 1000 }
];

// User Registration
app.post('/api/register', (req, res) => {
    const { phone, pass } = req.body;
    if (users[phone]) return res.json({ message: "User exists!" });
    users[phone] = { pass, balance: 0 };
    res.json({ message: "Registration Successful!" });
});

// Balance Fetch
app.get('/api/balance', (req, res) => {
    const { phone } = req.query;
    const user = users[phone];
    res.json({ balance: user ? user.balance : 0 });
});

// Auto-Deposit Matching Logic
app.post('/api/deposit', (req, res) => {
    const { phone, trxId, amount } = req.body;
    const user = users[phone];

    if (!user) return res.json({ message: "User not found!" });

    // Check if TrxID exists in SMS logs
    const match = receivedSMSLogs.find(log => log.trxId === trxId && log.amount == amount);

    if (match) {
        user.balance += parseFloat(amount);
        // Remove used TrxID to prevent double-claim
        receivedSMSLogs = receivedSMSLogs.filter(log => log.trxId !== trxId);
        res.json({ message: "Deposit Verified! Balance Added." });
    } else {
        res.json({ message: "Invalid TrxID or Amount mismatch!" });
    }
});

// Simulated Android Webhook (For receiving SMS)
app.post('/api/sms-webhook', (req, res) => {
    const { trxId, amount } = req.body;
    receivedSMSLogs.push({ trxId, amount: parseFloat(amount) });
    res.json({ status: "SMS Received & Saved" });
});

app.listen(3000, () => console.log("Server running on port 3000"));