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
let receivedSMSLogs = [
    { trxId: "TRX12345", amount: 500 } // Demo test transaction
];

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

// Deposit Verification (Matches TrxID / TxnID & Amount)
app.post('/api/deposit', (req, res) => {
    const { phone, trxId, amount } = req.body;
    const user = users[phone];

    if (!user) return res.json({ message: "User not found! Please login." });

    const cleanInputTrx = trxId.trim().toLowerCase();

    const matchIndex = receivedSMSLogs.findIndex(log => 
        log.trxId.trim().toLowerCase() === cleanInputTrx && 
        parseFloat(log.amount) === parseFloat(amount)
    );

    if (matchIndex !== -1) {
        user.balance += parseFloat(amount);
        receivedSMSLogs.splice(matchIndex, 1);
        res.json({ message: "Deposit Verified! Balance Added Successfully." });
    } else {
        res.json({ message: "Invalid TrxID or Amount mismatch! (অথবা এই ট্রানজেকশন ইতিমধ্যে ব্যবহার করা হয়েছে)" });
    }
});

// SMS Webhook (Parses both bKash TrxID & Nagad TxnID)
app.post('/api/sms-webhook', (req, res) => {
    const body = req.body || {};
    const smsText = body.text || body.message || body.SMS || JSON.stringify(body);

    console.log("Incoming Raw SMS:", smsText);

    // Regex for both bKash (TrxID) and Nagad (TxnID)
    const trxMatch = smsText.match(/TrxID\s+([A-Za-z0-9]+)/i) || smsText.match(/TxnID:\s*([A-Za-z0-9]+)/i) || smsText.match(/TxnID\s+([A-Za-z0-9]+)/i);
    const amountMatch = smsText.match(/Tk\s*([\d\.]+)/i) || smsText.match(/BDT\s*([\d\.]+)/i) || smsText.match(/Amount:\s*Tk\s*([\d\.]+)/i);

    if (trxMatch && amountMatch) {
        const extractedTrx = trxMatch[1].trim();
        const extractedAmount = parseFloat(amountMatch[1]);

        receivedSMSLogs.push({ trxId: extractedTrx, amount: extractedAmount });
        console.log(`Parsed Success -> ID: ${extractedTrx}, Amount: ${extractedAmount}`);
        return res.json({ status: "Success", trxId: extractedTrx, amount: extractedAmount });
    }

    if (body.trxId && body.amount) {
        receivedSMSLogs.push({ trxId: body.trxId.trim(), amount: parseFloat(body.amount) });
        return res.json({ status: "Success Direct" });
    }

    res.json({ status: "Received but could not parse TrxID/Amount" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
