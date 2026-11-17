import { Router } from 'express';
import { authenticate, verifyRole } from '../middlewares/auth.js';
import { getCustomerDashboard } from '../controllers/dashboardController.js';

const router = Router();

router.get('/dashboard', authenticate, verifyRole('customer'), getCustomerDashboard);

export default router;
