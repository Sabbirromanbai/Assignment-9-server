import { Router } from 'express';
import express from 'express';
import { authenticate, verifyRole } from '../middlewares/auth.js';
import {
  cancelPremiumSubscription,
  createCheckoutSession,
  handleStripeWebhook,
  verifyCheckoutSession,
} from '../controllers/subscriptionController.js';

const router = Router();

router.post('/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);
router.post('/checkout', authenticate, verifyRole('vendor'), createCheckoutSession);
router.post(
  '/verify-session',
  express.json(),
  authenticate,
  verifyRole('vendor'),
  verifyCheckoutSession,
);
router.post('/cancel', authenticate, verifyRole('vendor'), cancelPremiumSubscription);

export default router;
