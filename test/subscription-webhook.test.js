import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPaidCheckoutSession,
  processVerifiedWebhookEvent,
} from '../src/controllers/subscriptionController.js';

const validCheckoutSession = {
  id: 'cs_test_123',
  mode: 'subscription',
  status: 'complete',
  payment_status: 'paid',
  metadata: { vendorId: '507f1f77bcf86cd799439011', plan: 'free' },
  client_reference_id: '507f1f77bcf86cd799439011',
  subscription: 'sub_123',
};

for (const [description, metadata] of [
  ['missing plan metadata', { vendorId: validCheckoutSession.metadata.vendorId }],
  ['invalid plan metadata', { ...validCheckoutSession.metadata, plan: 'free' }],
]) {
  test(`checkout processing rejects ${description} before database access`, async () => {
    let databaseAccessed = false;
    const db = {
      collection() {
        databaseAccessed = true;
        throw new Error('Database should not be accessed for invalid plan metadata');
      },
    };

    const result = await applyPaidCheckoutSession({
      db,
      stripe: { subscriptions: { retrieve: async () => { throw new Error('Stripe should not be called'); } } },
      checkoutSession: { ...validCheckoutSession, metadata },
    });

    assert.equal(result, null);
    assert.equal(databaseAccessed, false);
  });
}

test('duplicate webhook event IDs are recorded and processed once', async () => {
  const storedEventIds = new Set();
  const db = {
    collection(name) {
      assert.equal(name, 'stripeWebhookEvents');
      return {
        async insertOne(document) {
          if (storedEventIds.has(document._id)) {
            const error = new Error('duplicate key');
            error.code = 11000;
            throw error;
          }
          storedEventIds.add(document._id);
        },
      };
    },
  };
  const client = {
    startSession() {
      return {
        async withTransaction(callback) { await callback(); },
        async endSession() {},
      };
    },
  };
  const event = {
    id: 'evt_test_duplicate',
    type: 'checkout.session.completed',
    created: 123,
    data: { object: { ...validCheckoutSession, metadata: { ...validCheckoutSession.metadata, plan: 'free' } } },
  };

  const first = await processVerifiedWebhookEvent({ db, client, stripe: {}, event });
  const second = await processVerifiedWebhookEvent({ db, client, stripe: {}, event });

  assert.deepEqual(first, { received: true, applied: false, duplicate: false });
  assert.deepEqual(second, { received: true, applied: false, duplicate: true });
  assert.equal(storedEventIds.size, 1);
});
