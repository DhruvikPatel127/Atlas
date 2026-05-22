const { Analytics } = require('analytics-node');
const dotenv = require('dotenv');

dotenv.config();

let analytics;
if (process.env.SEGMENT_WRITE_KEY) {
  analytics = new Analytics(process.env.SEGMENT_WRITE_KEY);
}

class AnalyticsTracker {
  // Track user action
  track(userId, event, properties = {}) {
    if (!analytics) {
      console.log(`[Analytics] ${userId} - ${event}:`, properties);
      return;
    }
    analytics.track({
      userId: userId.toString(),
      event: event,
      properties: properties,
      timestamp: new Date()
    });
  }

  // Key metrics to track
  trackSignup(userId, source) {
    this.track(userId, 'User Signed Up', { source });
  }

  trackDocumentUpload(userId, docSize) {
    this.track(userId, 'Document Uploaded', { size_mb: docSize });
  }

  trackAIQuestion(userId, feature, tokensUsed, costUSD) {
    this.track(userId, 'AI Feature Used', {
      feature,
      tokens_used: tokensUsed,
      cost_usd: costUSD
    });
  }

  trackQuizCompleted(userId, score, timeTaken) {
    this.track(userId, 'Quiz Completed', {
      score,
      time_taken_minutes: timeTaken
    });
  }

  trackSubscriptionPurchase(userId, planTier, amountUSD) {
    this.track(userId, 'Subscription Purchased', {
      plan: planTier,
      revenue: amountUSD
    });
  }

  trackFeatureUsage(userId, feature) {
    this.track(userId, feature + ' Opened');
  }
}

module.exports = new AnalyticsTracker();
