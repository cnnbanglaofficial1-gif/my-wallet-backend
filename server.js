const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

let users = {}; 
let receivedSMSLogs = [
    { trxId: "TRX12345", amount: 500 } // টেস্ট করার জন্য ডেমো ট্রানজেকশন
];

// ইউজার রেজিস্ট্রেশন
app.post('/api/register', (req, res) => {
    const { phone, pass } = req.body;
    if (!phone || !pass) return res.json({ message: "Mobile and password required!" });
    if (users[phone]) return res.json({ message: "Login Successful!" });
    users[phone] = { pass, balance: 0 };
    res.json({ message: "Registration Successful!" });
});

// ব্যালেন্স চেক
app.get('/api/balance', (req, res) => {
    const { phone } = req.query;
    const user = users[phone];
    res.json({ balance: user ? user.balance : 0 });
});

// ডিপোজিট ভ্যালিডেশন (TrxID & Amount Match)
app.post('/api/deposit', (req, res) => {
    const { phone, trxId, amount } = req.body;
    const user = users[phone];

    if (!user) return res.json({ message: "User not found! Please login." });

    // সার্ভারে থাকা SMS লগের সাথে TrxID ও Amount মেলানো
    const matchIndex = receivedSMSLogs.findIndex(log => 
        log.trxId.trim().toLowerCase() === trxId.trim().toLowerCase() && 
        parseFloat(log.amount) === parseFloat(amount)
    );

    if (matchIndex !== -1) {
        user.balance += parseFloat(amount);
        // একবার ব্যবহার করা TrxID মুছে দেওয়া যেন দ্বিতীয়বার কেউ ব্যবহার করতে না পারে
        receivedSMSLogs.splice(matchIndex, 1);
        res.json({ message: "Deposit Verified! Balance Added Successfully." });
    } else {
        res.json({ message: "Invalid TrxID or Amount mismatch! (অথবা এই ট্রানজেকশন ইতিমধ্যে ব্যবহার করা হয়েছে)" });
    }
});

// SMS Webhook (আপনার মোবাইলের SMS App থেকে মেসেজ রিসিভ করার জন্য)
app.post('/api/sms-webhook', (req, res) => {
    const { trxId, amount } = req.body;
    if(trxId && amount) {
        receivedSMSLogs.push({ trxId: trxId.trim(), amount: parseFloat(amount) });
        console.log(`New SMS Received -> TrxID: ${trxId}, Amount: ${amount}`);
        return res.json({ status: "Success", message: "SMS Logged" });
    }
    res.json({ status: "Failed", message: "Invalid data format" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
