const sgMail = require('@sendgrid/mail');
const dotenv = require('dotenv');

dotenv.config();

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

class EmailService {
  // Welcome email
  async sendWelcomeEmail(email, firstName) {
    try {
      if (!process.env.SENDGRID_API_KEY) return;
      await sgMail.send({
        to: email,
        from: process.env.EMAIL_FROM || 'hello@atlasai.app',
        subject: 'Welcome to Atlas AI!',
        text: `Hi ${firstName}, welcome to Atlas AI! We're excited to help you with your studies.`,
        html: `<strong>Hi ${firstName},</strong><p>Welcome to Atlas AI! We're excited to help you with your studies.</p>`
        // In production, use templateId
        // templateId: 'd-welcome_template_id',
        // dynamicTemplateData: {
        //   first_name: firstName,
        //   cta_link: `${process.env.APP_URL}/onboarding`
        // }
      });
    } catch (error) {
      console.error('Email error (Welcome):', error);
    }
  }

  // Subscription confirmation
  async sendSubscriptionConfirmation(email, planTier) {
    try {
      if (!process.env.SENDGRID_API_KEY) return;
      await sgMail.send({
        to: email,
        from: process.env.EMAIL_FROM || 'support@atlasai.app',
        subject: 'Subscription Activated',
        text: `Your ${planTier.toUpperCase()} subscription is now active!`,
        html: `<p>Your <strong>${planTier.toUpperCase()}</strong> subscription is now active!</p>`
        // templateId: 'd-subscription_confirm_template',
        // dynamicTemplateData: {
        //   plan_tier: planTier.toUpperCase(),
        //   renewal_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toDateString()
        // }
      });
    } catch (error) {
      console.error('Email error (Subscription):', error);
    }
  }

  // Engagement emails
  async sendStreakNotification(email, streakCount) {
    try {
      if (!process.env.SENDGRID_API_KEY) return;
      if (streakCount % 7 === 0) { // Every 7 days
        await sgMail.send({
          to: email,
          from: process.env.EMAIL_FROM || 'team@atlasai.app',
          subject: `${streakCount} Day Streak!`,
          text: `Congratulations on your ${streakCount} day study streak!`,
          html: `<h3>Congratulations!</h3><p>You've reached a ${streakCount} day study streak on Atlas AI.</p>`
          // templateId: 'd-streak_milestone_template',
          // dynamicTemplateData: {
          //   streak_days: streakCount
          // }
        });
      }
    } catch (error) {
      console.error('Email error (Streak):', error);
    }
  }

  // Churn prevention
  async sendWinBackOffer(email, inactiveDays) {
    try {
      if (!process.env.SENDGRID_API_KEY) return;
      await sgMail.send({
        to: email,
        from: process.env.EMAIL_FROM || 'hello@atlasai.app',
        subject: 'We miss you!',
        text: `It's been ${inactiveDays} days since your last visit. Here is a special offer to come back.`,
        html: `<p>We haven't seen you in ${inactiveDays} days. Use code <strong>COMEBACK20</strong> for 20% off your next month!</p>`
        // templateId: 'd-winback_offer_template',
        // dynamicTemplateData: {
        //   inactive_days: inactiveDays,
        //   offer_code: 'COMEBACK20',
        //   expiry_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toDateString()
        // }
      });
    } catch (error) {
      console.error('Email error (WinBack):', error);
    }
  }
}

module.exports = new EmailService();
