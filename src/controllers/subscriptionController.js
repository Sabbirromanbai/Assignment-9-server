import Stripe from 'stripe';
import { ObjectId } from 'mongodb';
import { getDB } from '../config/db.js';

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    return null;
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

const PAID_CHECKOUT_PAYMENT_STATUSES = ['paid', 'no_payment_required'];
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing'];

function getVendorId(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    return null;
  }
  return new ObjectId(value);
}

function getSubscriptionPeriod(subscription) {
  const item = subscription?.items?.data?.[0];
  const start = subscription?.current_period_start ?? item?.current_period_start;
  const end = subscription?.current_period_end ?? item?.current_period_end;

  return {
    start: Number.isFinite(start) ? new Date(start * 1000) : null,
    expiry: Number.isFinite(end) ? new Date(end * 1000) : null,
  };
}

function getSubscriptionId(session) {
  if (typeof session.subscription === 'string') {
    return session.subscription;
  }
  return session.subscription?.id ?? null;
}

function getCheckoutVendorId(session) {
  const metadataVendorId = getVendorId(session.metadata?.vendorId);
  const referenceVendorId = getVendorId(session.client_reference_id);

  if (
    metadataVendorId
    && referenceVendorId
    && !metadataVendorId.equals(referenceVendorId)
  ) {
    return null;
  }

  return metadataVendorId ?? referenceVendorId;
}

/**
 * Prevents a delayed Stripe event from undoing a newer state change.
 * Equal timestamps are allowed because repeated deliveries are idempotent.
 */
function canApplyStripeEvent(transaction, eventCreated) {
  if (!Number.isFinite(eventCreated)) {
    return true;
  }

  const lastEventCreated = Number(transaction.lastStripeEventCreated);
  return !Number.isFinite(lastEventCreated) || eventCreated >= lastEventCreated;
}

/**
 * Grants Premium to a verified vendor without moving the expiry backwards.
 * Repeated webhook deliveries and success-page checks therefore stay idempotent.
 */
async function grantPremiumAccess(db, vendorId, period) {
  const user = await db.collection('user').findOne(
    { _id: vendorId, role: 'vendor' },
    {
      projection: {
        subscriptionPlan: 1,
        subscriptionStartedAt: 1,
        subscriptionExpiresAt: 1,
      },
    },
  );
  if (!user) {
    return { matched: false, updated: false, expiresAt: null };
  }

  const currentExpiry = user.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt)
    : null;
  const hasValidCurrentExpiry = Boolean(currentExpiry)
    && Number.isFinite(currentExpiry.getTime());
  const hasFuturePremium = user.subscriptionPlan === 'premium'
    && hasValidCurrentExpiry
    && currentExpiry.getTime() > Date.now();

  const currentStart = user.subscriptionStartedAt
    ? new Date(user.subscriptionStartedAt)
    : null;
  const hasValidCurrentStart = Boolean(currentStart)
    && Number.isFinite(currentStart.getTime());

  const shouldSetExpiry = !hasFuturePremium
    || (
      Boolean(period.expiry)
      && (!hasValidCurrentExpiry || currentExpiry.getTime() < period.expiry.getTime())
    );
  const shouldSetStart = Boolean(period.start)
    && (!hasValidCurrentStart || period.start.getTime() > currentStart.getTime());
  const effectiveExpiry = shouldSetExpiry && period.expiry
    ? period.expiry
    : (hasValidCurrentExpiry ? currentExpiry : period.expiry);

  if (user.subscriptionPlan === 'premium' && !shouldSetExpiry && !shouldSetStart) {
    return { matched: true, updated: false, expiresAt: effectiveExpiry };
  }

  const result = await db.collection('user').updateOne(
    { _id: vendorId, role: 'vendor' },
    {
      $set: {
        subscriptionPlan: 'premium',
        ...(shouldSetExpiry && period.expiry ? { subscriptionExpiresAt: period.expiry } : {}),
        ...(shouldSetStart ? { subscriptionStartedAt: period.start } : {}),
      },
    },
  );

  return {
    matched: result.matchedCount > 0,
    updated: result.modifiedCount > 0,
    expiresAt: effectiveExpiry,
  };
}

/**
 * Applies a Stripe-verified, paid Checkout Session to the existing pending
 * transaction. Used by both the signed webhook and the authenticated success
 * page reconciliation endpoint so either path produces the same DB state.
 */
async function applyPaidCheckoutSession({
  db,
  stripe,
  session,
  expectedVendorId = null,
  stripeEventId = null,
  stripeEventCreated = null,
  observedAt = false,
}) {
  if (
    session.mode !== 'subscription'
    || session.status !== 'complete'
    || !PAID_CHECKOUT_PAYMENT_STATUSES.includes(session.payment_status)
  ) {
    return null;
  }

  const vendorId = getCheckoutVendorId(session);
  if (!vendorId) {
    return null;
  }
  if (expectedVendorId && !vendorId.equals(expectedVendorId)) {
    return null;
  }

  const transaction = await db.collection('transactions').findOne({
    stripeSessionId: session.id,
    vendorId,
  });
  if (!transaction || !canApplyStripeEvent(transaction, stripeEventCreated)) {
    return null;
  }

  const subscriptionId = getSubscriptionId(session);
  if (!subscriptionId) {
    return null;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (!ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
    return null;
  }

  const period = getSubscriptionPeriod(subscription);
  if (!period.expiry) {
    throw new Error('Stripe subscription expiry is unavailable');
  }

  const observedEventCreated = Number.isFinite(stripeEventCreated)
    ? stripeEventCreated
    : (observedAt ? Math.floor(Date.now() / 1000) : null);

  const transactionUpdate = {
    $set: {
      plan: session.metadata?.plan === 'premium' ? 'premium' : transaction.plan,
      amount: session.amount_total ?? transaction.amount,
      currency: session.currency ?? transaction.currency,
      stripeSubscriptionId: subscriptionId,
      paymentStatus: session.payment_status,
      subscriptionStatus: subscription.status,
      subscriptionStartAt: period.start ?? transaction.subscriptionStartAt ?? null,
      subscriptionExpiresAt: period.expiry,
      status: 'paid',
      updatedAt: new Date(),
      ...(stripeEventId ? { lastStripeEventId: stripeEventId } : {}),
      ...(observedEventCreated === null
        ? {}
        : { lastStripeEventCreated: observedEventCreated }),
    },
  };

  const transactionResult = await db.collection('transactions').updateOne(
    { _id: transaction._id, stripeSessionId: session.id, vendorId },
    transactionUpdate,
  );
  if (transactionResult.matchedCount === 0) {
    throw new Error('Pending transaction changed during Stripe verification');
  }

  const grant = await grantPremiumAccess(db, vendorId, period);
  if (!grant.matched) {
    throw new Error('Vendor account was not found for this checkout session');
  }

  return {
    vendorId,
    transactionId: transaction._id,
    subscriptionId,
    period,
    grant,
  };
}

async function applySubscriptionLifecycle(
  db,
  subscription,
  { eventCreated = null, eventId = null } = {},
) {
  const transaction = await db.collection('transactions').findOne({
    stripeSubscriptionId: subscription.id,
  });
  if (!transaction?.vendorId || !canApplyStripeEvent(transaction, eventCreated)) {
    return null;
  }

  const isActive = ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status);
  const period = getSubscriptionPeriod(subscription);
  const update = {
    $set: {
      subscriptionStatus: subscription.status,
      updatedAt: new Date(),
      ...(Number.isFinite(eventCreated) ? { lastStripeEventCreated: eventCreated } : {}),
      ...(eventId ? { lastStripeEventId: eventId } : {}),
    },
  };

  if (isActive) {
    update.$set.status = 'paid';
  }
  if (period.start) {
    update.$set.subscriptionStartAt = period.start;
  }
  if (period.expiry) {
    update.$set.subscriptionExpiresAt = period.expiry;
  }

  const transactionResult = await db.collection('transactions').updateOne(
    { _id: transaction._id },
    update,
  );
  if (transactionResult.matchedCount === 0) {
    return null;
  }

  if (isActive) {
    if (!period.expiry) {
      throw new Error('Stripe subscription expiry is unavailable');
    }
    return grantPremiumAccess(db, transaction.vendorId, period);
  }

  const otherActiveSubscriptions = await db.collection('transactions').countDocuments({
    vendorId: transaction.vendorId,
    _id: { $ne: transaction._id },
    status: 'paid',
    subscriptionStatus: { $in: ACTIVE_SUBSCRIPTION_STATUSES },
  });

  if (otherActiveSubscriptions === 0) {
    await db.collection('user').updateOne(
      { _id: transaction.vendorId, role: 'vendor' },
      {
        $set: { subscriptionPlan: 'free' },
        $unset: { subscriptionExpiresAt: '', subscriptionStartedAt: '' },
      },
    );
  }

  return { matched: true, updated: true };
}

async function markCheckoutSessionFailed(
  db,
  session,
  { status = 'failed', eventCreated = null, eventId = null } = {},
) {
  const transaction = await db.collection('transactions').findOne({
    stripeSessionId: session.id,
  });
  if (!transaction || !canApplyStripeEvent(transaction, eventCreated)) {
    return null;
  }

  const result = await db.collection('transactions').updateOne(
    { _id: transaction._id },
    {
      $set: {
        status,
        paymentStatus: session.payment_status ?? 'unpaid',
        updatedAt: new Date(),
        ...(Number.isFinite(eventCreated) ? { lastStripeEventCreated: eventCreated } : {}),
        ...(eventId ? { lastStripeEventId: eventId } : {}),
      },
    },
  );

  return result.matchedCount > 0;
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

export async function verifyCheckoutSession(req, res) {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ message: 'Stripe checkout is not configured' });
  }

  const sessionId = req.body?.sessionId ?? req.body?.session_id;
  if (typeof sessionId !== 'string' || !/^cs_(test|live)_/.test(sessionId)) {
    return res.status(400).json({ message: 'A valid Stripe checkout session ID is required' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const result = await applyPaidCheckoutSession({
      db: getDB(),
      stripe,
      session,
      expectedVendorId: req.user._id,
      observedAt: true,
    });

    if (!result) {
      return res.status(409).json({
        message: 'Checkout session is not a paid Premium purchase for this vendor',
      });
    }

    return res.status(200).json({
      message: 'Premium subscription verified',
      data: {
        activated: result.grant.matched,
        subscriptionPlan: 'premium',
        subscriptionExpiresAt: result.grant.expiresAt?.toISOString() ?? null,
        transactionId: String(result.transactionId),
      },
    });
  } catch (err) {
    console.error('verifyCheckoutSession error:', err.message);
    if (err.code === 'resource_missing' || err.statusCode === 404) {
      return res.status(404).json({ message: 'Stripe checkout session was not found' });
    }
    return res.status(502).json({ message: 'Unable to verify Stripe checkout session' });
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
    const eventContext = {
      stripeEventId: event.id,
      eventId: event.id,
      stripeEventCreated: event.created,
      eventCreated: event.created,
    };
    let applied = false;
    if (event.type === 'checkout.session.completed') {
      const result = await applyPaidCheckoutSession({
        db,
        stripe,
        session: event.data.object,
        ...eventContext,
      });
      applied = Boolean(result);
    } else if (
      event.type === 'customer.subscription.created'
      || event.type === 'customer.subscription.updated'
      || event.type === 'customer.subscription.deleted'
    ) {
      applied = Boolean(await applySubscriptionLifecycle(db, event.data.object, eventContext));
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      applied = Boolean(await markCheckoutSessionFailed(
        db,
        event.data.object,
        {
          ...eventContext,
          status: event.type === 'checkout.session.expired' ? 'expired' : 'failed',
        },
      ));
    }

    return res.status(200).json({ received: true, applied });
  } catch (err) {
    console.error('handleStripeWebhook error:', err.message);
    return res.status(500).json({ message: 'Unable to process Stripe event' });
  }
}
