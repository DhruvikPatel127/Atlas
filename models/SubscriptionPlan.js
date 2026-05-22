const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  tier: { type: String, enum: ['free', 'pro', 'premium'], required: true, unique: true },
  display_name: { type: String, required: true },
  description: { type: String },
  price_inr: { type: Number, required: true },
  price_usd: { type: Number, required: true },
  billing_period_days: { type: Number, default: 30 },
  ai_questions_daily: { type: Number, default: 5 }, // -1 for unlimited
  document_limit: { type: Number, default: 3 }, // -1 for unlimited
  storage_limit_mb: { type: Number, default: 100 },
  features: [{ type: String }],
  isActive: { type: Boolean, default: true }
});

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
