const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  subjects: [{ type: String }], // Custom subjects added by user
  
  // Profile fields
  background: { type: String }, // Engineering, Medical, etc.
  branch: { type: String },     // CS, Mechanical, etc.
  competitiveExam: { type: String }, // JEE, NEET, etc.
  
  // Subscription fields
  subscription_tier: { 
    type: String, 
    enum: ['free', 'pro', 'premium'], 
    default: 'free' 
  },
  subscription_id: { type: String },
  subscription_expires_at: { type: Date },
  
  // Usage limits
  ai_questions_daily_limit: { type: Number, default: 5 },
  ai_questions_today: { type: Number, default: 0 },
  last_ai_reset: { type: Date, default: Date.now },
  document_limit: { type: Number, default: 3 }, // Total documents for free tier
  storage_limit_mb: { type: Number, default: 100 },
  
  createdAt: { type: Date, default: Date.now },
});

// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Compare password
userSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);
