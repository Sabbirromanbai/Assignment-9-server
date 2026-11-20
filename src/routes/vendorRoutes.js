import { Router } from 'express';
import { authenticate, verifyRole } from '../middlewares/auth.js';
import {
  getVendorProfile,
  updateVendorProfile,
  getPublicVendorProfile,
} from '../controllers/vendorController.js';
import { getVendorDashboard } from '../controllers/dashboardController.js';

const router = Router();

router.get('/dashboard', authenticate, verifyRole('vendor'), getVendorDashboard);
router.get('/profile', authenticate, verifyRole('vendor'), getVendorProfile);
router.patch('/profile', authenticate, verifyRole('vendor'), updateVendorProfile);
router.get('/:id', getPublicVendorProfile);

export default router;