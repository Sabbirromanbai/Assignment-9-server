import { Router } from 'express';
import express from 'express';
import { profileImageUploadRateLimit } from '../middlewares/uploadRateLimit.js';
import { uploadProfileImage } from '../controllers/profileController.js';

const router = Router();

router.post(
  '/images',
  profileImageUploadRateLimit,
  express.raw({
    type: ['image/jpeg', 'image/png', 'image/webp'],
    limit: '5mb',
  }),
  uploadProfileImage,
);

export default router;
