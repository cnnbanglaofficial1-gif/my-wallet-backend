const express = require('express');
const cors = require('cors');
const app = express();

// Enable CORS for all requests
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

let users = {}; 
let receivedSMSLogs = [
    { trxId: "TRX12345", amount: 500 },
    { trxId: "TRX99999", amount: 1000 }
];

app.post('/api/register', (req, res) => {
    const { phone, pass } = req.body;
    if (!phone || !pass) return res.json({ message: "Mobile and password required!" });
    if (users[phone]) return res.json({ message: "User already exists!" });
    users[phone] = { pass, balance: 0 };
    res.json({ message: "Registration Successful!" });
});

app.get('/api/balance', (req, res) => {
    const { phone } = req.query;
    const user = users[phone];
    res.json({ balance: user ? user.balance : 0 });
});

app.post('/api/deposit', (req, res) => {
    const { phone, trxId, amount } = req.body;
    const user = users[phone];

    if (!user) return res.json({ message: "User not found!" });

    const match = receivedSMSLogs.find(log => log.trxId.trim().toLowerCase() === trxId.trim().toLowerCase() && parseFloat(log.amount) === parseFloat(amount));

    if (match) {
        user.balance += parseFloat(amount);
        receivedSMSLogs = receivedSMSLogs.filter(log => log.trxId !== trxId);
        res.json({ message: "Deposit Verified! Balance Added." });
    } else {
        res.json({ message: "Invalid TrxID or Amount mismatch!" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
