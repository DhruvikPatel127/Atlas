const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
  status: { type: String, enum: ['active', 'cancelled', 'expired'], default: 'active' },
  current_period_start: { type: Date, default: Date.now },
  current_period_end: { type: Date, required: true },
  cancel_at_period_end: { type: Boolean, default: false },
  payment_subscription_id: { type: String }, // Stripe or Razorpay subscription ID
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
