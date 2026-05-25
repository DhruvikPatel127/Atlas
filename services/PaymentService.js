const Razorpay = require('razorpay');
const crypto = require('crypto');
const User = require('../models/User');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Transaction = require('../models/Transaction');
const Subscription = require('../models/Subscription');
const emailService = require('./EmailService');
const analyticsService = require('./AnalyticsService');

let stripe;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

let razorpay;
const initRazorpay = () => {
  if (razorpay) return razorpay;
  
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  if (keyId && keySecret) {
    razorpay = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });
    console.log('Razorpay initialized successfully');
    return razorpay;
  }
  return null;
};

// Initial attempt
initRazorpay();

class PaymentService {
  // ============ CREATE ORDER (INDIA) ============
  async createRazorpayOrder(userId, planTier) {
    try {
      const rzp = initRazorpay();
      if (!rzp) {
        const missing = [];
        if (!process.env.RAZORPAY_KEY_ID) missing.push('RAZORPAY_KEY_ID');
        if (!process.env.RAZORPAY_KEY_SECRET) missing.push('RAZORPAY_KEY_SECRET');
        throw new Error(`Razorpay not configured. Missing: ${missing.join(', ')}`);
      }

      const plan = await SubscriptionPlan.findOne({ tier: planTier });
      if (!plan) throw new Error('Plan not found');

      const order = await razorpay.orders.create({
        amount: Math.round(plan.price_inr * 100), // Convert to paise
        currency: 'INR',
        receipt: `user_${userId}_${Date.now()}`,
        notes: {
          user_id: userId.toString(),
          plan_tier: planTier,
          plan_name: plan.display_name
        }
      });

      return {
        order_id: order.id,
        razorpay_key: process.env.RAZORPAY_KEY_ID,
        amount: plan.price_inr * 100,
        currency: 'INR'
      };

    } catch (error) {
      console.error('Create order error:', error);
      throw error;
    }
  }

  // ============ VERIFY RAZORPAY PAYMENT ============
  async verifyRazorpayPayment(userId, orderId, paymentId, signature) {
    try {
      const rzp = initRazorpay();
      if (!rzp) throw new Error('Razorpay not configured');

      // Verify signature
      const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
      hmac.update(orderId + '|' + paymentId);
      const generatedSignature = hmac.digest('hex');

      if (generatedSignature !== signature) {
        throw new Error('Invalid payment signature');
      }

      // Get order details
      const order = await razorpay.orders.fetch(orderId);
      const notes = order.notes;

      // Find plan
      const plan = await SubscriptionPlan.findOne({ tier: notes.plan_tier });
      if (!plan) throw new Error('Plan not found');

      // Create transaction record
      const transaction = new Transaction({
        userId: userId,
        planId: plan._id,
        payment_method: 'razorpay',
        transaction_id: paymentId,
        order_id: orderId,
        amount: order.amount / 100,
        currency: 'INR',
        status: 'completed'
      });
      await transaction.save();

      // Update user subscription
      const expiresAt = new Date(Date.now() + plan.billing_period_days * 24 * 60 * 60 * 1000);

      await User.findByIdAndUpdate(userId, {
        subscription_tier: notes.plan_tier,
        subscription_id: orderId,
        subscription_expires_at: expiresAt,
        ai_questions_daily_limit: plan.ai_questions_daily,
        document_limit: plan.document_limit,
        storage_limit_mb: plan.storage_limit_mb
      });

      // Create or update subscription record
      await Subscription.findOneAndUpdate(
        { userId, status: 'active' },
        { status: 'expired' },
        { new: true }
      );

      const subscription = new Subscription({
        userId: userId,
        planId: plan._id,
        status: 'active',
        current_period_start: new Date(),
        current_period_end: expiresAt,
        payment_subscription_id: orderId
      });
      await subscription.save();

      // Send confirmation email and track analytics
      const user = await User.findById(userId);
      await emailService.sendSubscriptionConfirmation(user.email, notes.plan_tier);
      analyticsService.trackSubscriptionPurchase(userId, notes.plan_tier, (order.amount / 100) / 83); // Approx USD

      return {
        success: true,
        message: 'Subscription activated successfully',
        expires_at: expiresAt
      };

    } catch (error) {
      console.error('Payment verification error:', error);
      throw error;
    }
  }

  // ============ CREATE STRIPE PAYMENT (US/Global) ============
  async createStripeCheckout(userId, planTier) {
    try {
      if (!stripe) throw new Error('Stripe not configured');

      const plan = await SubscriptionPlan.findOne({ tier: planTier });
      if (!plan) throw new Error('Plan not found');

      const user = await User.findById(userId);

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer_email: user.email,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: plan.display_name,
                description: plan.description,
              },
              recurring: {
                interval: 'month',
                interval_count: 1,
              },
              unit_amount: Math.round(plan.price_usd * 100),
            },
            quantity: 1,
          },
        ],
        success_url: `${process.env.APP_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL}/subscription/cancel`,
        metadata: {
          user_id: userId.toString(),
          plan_tier: planTier,
        },
      });

      return {
        session_id: session.id,
        url: session.url
      };

    } catch (error) {
      console.error('Stripe checkout error:', error);
      throw error;
    }
  }

  // ============ WEBHOOK HANDLERS ============
  async handleStripeWebhook(signature, rawBody) {
    try {
      if (!stripe) throw new Error('Stripe not configured');
      const event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleStripeCheckoutCompleted(event.data.object);
          break;
        case 'customer.subscription.deleted':
          await this.handleStripeSubscriptionCancelled(event.data.object);
          break;
        default:
          console.log(`Unhandled event type: ${event.type}`);
      }
      return { received: true };
    } catch (error) {
      console.error('Webhook error:', error);
      throw error;
    }
  }

  async handleStripeCheckoutCompleted(session) {
    const { user_id, plan_tier } = session.metadata;

    const plan = await SubscriptionPlan.findOne({ tier: plan_tier });
    const expiresAt = new Date(Date.now() + plan.billing_period_days * 24 * 60 * 60 * 1000);

    await User.findByIdAndUpdate(user_id, {
      subscription_tier: plan_tier,
      subscription_id: session.subscription,
      subscription_expires_at: expiresAt,
      ai_questions_daily_limit: plan.ai_questions_daily,
      document_limit: plan.document_limit,
      storage_limit_mb: plan.storage_limit_mb
    });

    const subscription = new Subscription({
      userId: user_id,
      planId: plan._id,
      status: 'active',
      current_period_start: new Date(),
      current_period_end: expiresAt,
      payment_subscription_id: session.subscription
    });
    await subscription.save();
    
    analyticsService.trackSubscriptionPurchase(user_id, plan_tier, plan.price_usd);
  }

  // ============ SUBSCRIPTION RENEWAL/EXPIRY CHECK ============
  async checkAndRenewSubscriptions() {
    try {
      // Find expired subscriptions and downgrade
      const expiredUsers = await User.find({
        subscription_expires_at: { $lt: new Date() },
        subscription_tier: { $ne: 'free' }
      });

      for (const user of expiredUsers) {
        await User.findByIdAndUpdate(user._id, {
          subscription_tier: 'free',
          ai_questions_daily_limit: 5,
          document_limit: 3,
          storage_limit_mb: 100,
          subscription_id: null,
          subscription_expires_at: null
        });

        await Subscription.findOneAndUpdate(
          { userId: user._id, status: 'active' },
          { status: 'expired' }
        );
        
        // Could send email here
      }
    } catch (error) {
      console.error('Subscription renewal check error:', error);
    }
  }
}

module.exports = new PaymentService();
