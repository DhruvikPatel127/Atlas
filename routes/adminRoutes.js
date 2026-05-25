const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const auth = require('../middleware/auth');

// ADMIN ONLY: Force Downgrade/Unsubscribe a user
// This is for testing or manual customer support
router.post('/force-downgrade', auth, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    
    // In a real app, you would check if req.user.role === 'admin'
    // For now, we allow it for your testing
    
    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Reset user to free tier
    user.subscription_tier = 'free';
    user.ai_questions_daily_limit = 5;
    user.document_limit = 3;
    user.storage_limit_mb = 100;
    user.subscription_id = null;
    user.subscription_expires_at = null;
    await user.save();

    // Mark active subscription as expired/cancelled
    await Subscription.findOneAndUpdate(
      { userId: targetUserId, status: 'active' },
      { status: 'cancelled' }
    );

    res.json({ 
      success: true, 
      message: `User ${user.name} has been successfully downgraded to Free tier.` 
    });
  } catch (error) {
    res.status(500).json({ message: 'Admin downgrade failed', error: error.message });
  }
});

module.exports = router;
