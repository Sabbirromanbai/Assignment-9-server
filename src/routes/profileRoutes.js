import { Router } from 'express';
import express from 'express';
import { authenticate } from '../middlewares/auth.js';
import { profileImageUploadRateLimit } from '../middlewares/uploadRateLimit.js';
import { uploadProfileImage } from '../controllers/profileController.js';

const router = Router();

const rawImage = express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: '5mb',
});

// Public upload used during signup, before authentication.
router.post(
  '/images',
  profileImageUploadRateLimit,
  rawImage,
  uploadProfileImage,
);

// Authenticated upload used by signed-in profile management.
router.post(
  '/images/authenticated',
  authenticate,
  profileImageUploadRateLimit,
  rawImage,
  uploadProfileImage,
);

export default router;