import { Router } from 'express';
import { authenticate, verifyRole } from '../middlewares/auth.js';
import { getCustomerDashboard } from '../controllers/dashboardController.js';
import { updateCustomerProfile } from '../controllers/profileController.js';

const router = Router();

router.get('/dashboard', authenticate, verifyRole('customer'), getCustomerDashboard);
router.patch('/profile', authenticate, verifyRole('customer'), updateCustomerProfile);

export default router;
