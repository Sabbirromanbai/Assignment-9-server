import { Router } from 'express';
import { authenticate, verifyRole } from '../middlewares/auth.js';
import {
  getAdminDashboard,
  listTransactions,
  listUsers,
  setUserBlocked,
} from '../controllers/adminController.js';

const router = Router();

router.use(authenticate, verifyRole('admin'));
router.get('/dashboard', getAdminDashboard);
router.get('/users', listUsers);
router.patch('/users/:id/block', setUserBlocked);
router.get('/transactions', listTransactions);

export default router;
