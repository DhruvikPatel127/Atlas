const User = require('../models/User');

const checkUsageLimit = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if it's a new day to reset AI counter
    const now = new Date();
    const lastReset = new Date(user.last_ai_reset);
    
    if (now.toDateString() !== lastReset.toDateString()) {
      user.ai_questions_today = 0;
      user.last_ai_reset = now;
      await user.save();
    }

    // Skip limit check for pro/premium if limit is -1
    if (user.ai_questions_daily_limit !== -1 && user.ai_questions_today >= user.ai_questions_daily_limit) {
      return res.status(403).json({ 
        message: 'Daily AI limit reached', 
        tier: user.subscription_tier,
        limit: user.ai_questions_daily_limit
      });
    }

    next();
  } catch (error) {
    console.error('Usage limit check error:', error);
    res.status(500).json({ message: 'Server error during limit check' });
  }
};

const checkDocumentLimit = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const Note = require('../models/Note');
    const noteCount = await Note.countDocuments({ userId });

    if (user.document_limit !== -1 && noteCount >= user.document_limit) {
      return res.status(403).json({ 
        message: 'Document upload limit reached', 
        tier: user.subscription_tier,
        limit: user.document_limit
      });
    }

    next();
  } catch (error) {
    console.error('Document limit check error:', error);
    res.status(500).json({ message: 'Server error during limit check' });
  }
};

module.exports = { checkUsageLimit, checkDocumentLimit };
