import Stripe from 'stripe';
import { ObjectId } from 'mongodb';
import { getDB } from '../config/db.js';

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return null;
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function getVendorId(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    return null;
  }
  return new ObjectId(value);
}

function getSubscriptionExpiry(subscription) {
  const end = subscription.current_period_end
    ?? subscription.items?.data?.[0]?.current_period_end;
  return Number.isFinite(end) ? new Date(end * 1000) : null;
}

async function updateVendorSubscription(vendorId, subscription, isActive) {
  const db = getDB();
  const expiry = isActive ? getSubscriptionExpiry(subscription) : null;
  if (isActive && !expiry) {
    throw new Error('Stripe subscription expiry is unavailable');
  }

  await db.collection('user').updateOne(
    { _id: vendorId, role: 'vendor' },
    isActive
      ? { $set: { subscriptionPlan: 'premium', subscriptionExpiresAt: expiry } }
      : { $set: { subscriptionPlan: 'free' }, $unset: { subscriptionExpiresAt: '' } },
  );

  await db.collection('transactions').updateOne(
    { stripeSubscriptionId: subscription.id, vendorId },
    {
      $set: {
        status: isActive ? 'paid' : subscription.status,
      },
    },
  );
}

export async function createCheckoutSession(req, res) {
  const stripe = getStripe();
  const priceId = process.env.STRIPE_PREMIUM_PRICE_ID;
  const clientUrl = process.env.CLIENT_URL;
  if (!stripe || !priceId || !clientUrl) {
    return res.status(503).json({ message: 'Stripe checkout is not configured' });
  }

  try {
    const activePremium = req.user.subscriptionPlan === 'premium'
      && req.user.subscriptionExpiresAt
      && new Date(req.user.subscriptionExpiresAt) > new Date();
    if (activePremium) {
      return res.status(409).json({ message: 'Vendor already has an active Premium subscription' });
    }

    const price = await stripe.prices.retrieve(priceId);
    if (!price.active || price.type !== 'recurring' || price.unit_amount === null) {
      return res.status(503).json({ message: 'Configured Stripe price is not an active recurring price' });
    }

    const vendorId = req.user._id.toString();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: vendorId,
      metadata: { vendorId, plan: 'premium' },
      subscription_data: { metadata: { vendorId, plan: 'premium' } },
      success_url: `${clientUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/payment-cancel`,
    });

    await getDB().collection('transactions').updateOne(
      { stripeSessionId: session.id },
      {
        $setOnInsert: {
          vendorId: req.user._id,
          plan: 'premium',
          amount: price.unit_amount,
          currency: price.currency,
          stripeSessionId: session.id,
          stripeSubscriptionId: null,
          status: 'pending',
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    return res.status(201).json({
      message: 'Stripe Checkout session created',
      data: { url: session.url },
    });
  } catch (err) {
    console.error('createCheckoutSession error:', err.message);
    return res.status(502).json({ message: 'Unable to create Stripe Checkout session' });
  }
}

export async function cancelPremiumSubscription(req, res) {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ message: 'Stripe subscription management is not configured' });
  }

  try {
    const transaction = await getDB().collection('transactions').findOne(
      {
        vendorId: req.user._id,
        plan: 'premium',
        status: 'paid',
        stripeSubscriptionId: { $type: 'string' },
      },
      { sort: { createdAt: -1 } },
    );
    if (!transaction) {
      return res.status(404).json({ message: 'Active Premium subscription not found' });
    }

    const subscription = await stripe.subscriptions.update(
      transaction.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );
    return res.status(200).json({
      message: 'Premium subscription will end at the current billing period',
      data: { cancelAt: subscription.cancel_at },
    });
  } catch (err) {
    console.error('cancelPremiumSubscription error:', err.message);
    return res.status(502).json({ message: 'Unable to cancel Stripe subscription' });
  }
}

export async function handleStripeWebhook(req, res) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return res.status(503).json({ message: 'Stripe webhook is not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.get('stripe-signature'),
      webhookSecret,
    );
  } catch {
    return res.status(400).json({ message: 'Invalid Stripe webhook signature' });
  }

  try {
    const db = getDB();
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (
        session.mode !== 'subscription'
        || !['paid', 'no_payment_required'].includes(session.payment_status)
      ) {
        return res.status(200).json({ received: true });
      }

      const vendorId = getVendorId(session.metadata?.vendorId);
      if (!vendorId || session.client_reference_id !== vendorId.toString()) {
        return res.status(200).json({ received: true });
      }

      const transaction = await db.collection('transactions').findOne({
        stripeSessionId: session.id,
        vendorId,
      });
      if (!transaction) {
        return res.status(200).json({ received: true });
      }

      const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;
      if (!subscriptionId) {
        return res.status(200).json({ received: true });
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (!['active', 'trialing'].includes(subscription.status)) {
        return res.status(200).json({ received: true });
      }

      const expiry = getSubscriptionExpiry(subscription);
      if (!expiry) {
        return res.status(502).json({ message: 'Stripe subscription expiry is unavailable' });
      }

      await db.collection('transactions').updateOne(
        { stripeSessionId: session.id, vendorId },
        {
          $set: {
            plan: 'premium',
            amount: session.amount_total ?? transaction.amount,
            currency: session.currency ?? transaction.currency,
            stripeSubscriptionId: subscriptionId,
            status: 'paid',
          },
        },
      );
      await db.collection('user').updateOne(
        { _id: vendorId, role: 'vendor' },
        { $set: { subscriptionPlan: 'premium', subscriptionExpiresAt: expiry } },
      );
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const transaction = await db.collection('transactions').findOne({
        stripeSubscriptionId: subscription.id,
      });
      if (transaction?.vendorId) {
        await updateVendorSubscription(
          transaction.vendorId,
          subscription,
          ['active', 'trialing'].includes(subscription.status),
        );
      }
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object;
      await db.collection('transactions').updateOne(
        { stripeSessionId: session.id },
        { $set: { status: event.type === 'checkout.session.expired' ? 'expired' : 'failed' } },
      );
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('handleStripeWebhook error:', err.message);
    return res.status(500).json({ message: 'Unable to process Stripe event' });
  }
}
