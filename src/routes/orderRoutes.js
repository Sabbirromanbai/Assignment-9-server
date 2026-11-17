import { Router } from 'express';
import { authenticate, verifyRole } from '../middlewares/auth.js';
import {
  cancelOrder,
  createOrder,
  listMyOrders,
  updateOrderStatus,
} from '../controllers/orderController.js';

const router = Router();

router.post('/', authenticate, verifyRole('customer'), createOrder);
router.get('/mine', authenticate, verifyRole('customer', 'vendor'), listMyOrders);
router.patch('/:id/cancel', authenticate, verifyRole('customer'), cancelOrder);
router.patch('/:id', authenticate, verifyRole('vendor'), updateOrderStatus);

export default router;
