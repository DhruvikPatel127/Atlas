const express = require('express');
const router = express.Router();
const User = require('../models/User');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const paymentService = require('../services/PaymentService');
const auth = require('../middleware/auth');

// Get all subscription plans
router.get('/plans', async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({ isActive: true });
    res.json(plans);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching plans', error: error.message });
  }
});

// Create Razorpay Order
router.post('/razorpay/create-order', auth, async (req, res) => {
  try {
    const { planTier } = req.body;
    const userId = req.user.id || req.user._id;
    const orderData = await paymentService.createRazorpayOrder(userId, planTier);
    res.json(orderData);
  } catch (error) {
    res.status(500).json({ message: 'Error creating Razorpay order', error: error.message });
  }
});

// Verify Razorpay Payment
router.post('/razorpay/verify', auth, async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;
    const userId = req.user.id || req.user._id;
    const result = await paymentService.verifyRazorpayPayment(userId, orderId, paymentId, signature);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Payment verification failed', error: error.message });
  }
});

// Create Stripe Checkout Session
router.post('/stripe/create-checkout', auth, async (req, res) => {
  try {
    const { planTier } = req.body;
    const userId = req.user.id || req.user._id;
    const session = await paymentService.createStripeCheckout(userId, planTier);
    res.json(session);
  } catch (error) {
    res.status(500).json({ message: 'Error creating Stripe checkout', error: error.message });
  }
});

// Stripe Webhook (No Auth - Stripe calls this)
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const result = await paymentService.handleStripeWebhook(sig, req.body);
    res.json(result);
  } catch (error) {
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

// Get current user subscription status
router.get('/status', auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId).select('subscription_tier subscription_expires_at ai_questions_daily_limit ai_questions_today document_limit');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching status', error: error.message });
  }
});

module.exports = router;
