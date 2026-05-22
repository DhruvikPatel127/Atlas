const mongoose = require('mongoose');
const dotenv = require('dotenv');
const SubscriptionPlan = require('./models/SubscriptionPlan');

dotenv.config();

const plans = [
  {
    tier: 'free',
    display_name: 'Free Tier',
    description: 'Basic study tools for everyone',
    price_inr: 0,
    price_usd: 0,
    ai_questions_daily: 5,
    document_limit: 3,
    storage_limit_mb: 100,
    features: ['5 AI questions/day', '3 document uploads', 'Basic quizzes']
  },
  {
    tier: 'pro',
    display_name: 'Pro Tier',
    description: 'Advanced tools for serious students',
    price_inr: 299,
    price_usd: 3.99,
    ai_questions_daily: -1, // Unlimited
    document_limit: -1, // Unlimited
    storage_limit_mb: 5000,
    features: ['Unlimited AI questions', 'Unlimited documents', 'Advanced quizzes', 'Spaced repetition', '5GB storage']
  },
  {
    tier: 'premium',
    display_name: 'Premium Tier',
    description: 'The ultimate study experience',
    price_inr: 999,
    price_usd: 11.99,
    ai_questions_daily: -1,
    document_limit: -1,
    storage_limit_mb: 50000,
    features: ['Everything in Pro', '50GB storage', 'Personal study plan', 'Priority support']
  }
];

const seedPlans = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB for seeding...');

    for (const planData of plans) {
      await SubscriptionPlan.findOneAndUpdate(
        { tier: planData.tier },
        planData,
        { upsert: true, new: true }
      );
    }

    console.log('Subscription plans seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding plans:', error);
    process.exit(1);
  }
};

seedPlans();
