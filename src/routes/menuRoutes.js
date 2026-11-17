import { Router } from 'express';
import express from 'express';
import { authenticate, verifyRole } from '../middlewares/auth.js';
import {
  browseMenu,
  changeMenuItemStatus,
  createMenuItem,
  deleteAdminMenuItem,
  deleteMenuItem,
  listAdminMenuItems,
  listPendingMenuItems,
  listMyMenuItems,
  setMenuItemAvailability,
  updateMenuItem,
  uploadMenuImage,
} from '../controllers/menuController.js';

const router = Router();

router.get('/', browseMenu);
router.get('/admin', authenticate, verifyRole('admin'), listAdminMenuItems);
router.get('/admin/pending', authenticate, verifyRole('admin'), listPendingMenuItems);
router.patch('/admin/:id/status', authenticate, verifyRole('admin'), changeMenuItemStatus);
router.delete('/admin/:id', authenticate, verifyRole('admin'), deleteAdminMenuItem);
router.post('/images', authenticate, verifyRole('vendor'), express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: '10mb',
}), uploadMenuImage);
router.get('/mine', authenticate, verifyRole('vendor'), listMyMenuItems);
router.post('/', authenticate, verifyRole('vendor'), createMenuItem);
router.put('/:id', authenticate, verifyRole('vendor'), updateMenuItem);
router.patch('/:id/availability', authenticate, verifyRole('vendor'), setMenuItemAvailability);
router.delete('/:id', authenticate, verifyRole('vendor'), deleteMenuItem);

export default router;
