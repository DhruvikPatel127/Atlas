const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

console.log('--- Environment Variable Check ---');
console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'LOADED' : 'MISSING');
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'LOADED' : 'MISSING');
console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? 'LOADED' : 'MISSING');
console.log('RAZORPAY_KEY_ID:', process.env.RAZORPAY_KEY_ID ? 'LOADED' : 'MISSING');
console.log('RAZORPAY_KEY_SECRET:', process.env.RAZORPAY_KEY_SECRET ? 'LOADED' : 'MISSING');
console.log('---------------------------------');

const app = express();
const PORT = process.env.PORT || 5000;

const { monitoringMiddleware, register } = require('./config/monitoring');

// Ensure uploads and logs directory exists
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(monitoringMiddleware);
app.use('/uploads', express.static(uploadsDir));

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (ex) {
    res.status(500).end(ex);
  }
});


// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/notes', require('./routes/noteRoutes'));
app.use('/api/chat', require('./routes/chatRoutes'));
app.use('/api/quiz', require('./routes/quizRoutes'));
app.use('/api/flashcards', require('./routes/flashcardRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/video', require('./routes/videoRoutes'));

app.get('/', (req, res) => {
  res.send('Atlas Backend API is running...');
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
module.exports.handler = require('serverless-http')(app);
