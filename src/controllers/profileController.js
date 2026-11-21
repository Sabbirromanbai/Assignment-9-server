import { getDB } from '../config/db.js';
import {
  getSafeImgBBErrorDetails,
  validateImageUpload,
  uploadImageToImgBB,
  MAX_PROFILE_IMAGE_SIZE,
} from '../utils/imageUpload.js';

export async function chooseRole(req, res) {
  try {
    const { role } = req.body ?? {};
    if (!['customer', 'vendor'].includes(role)) {
      return res.status(400).json({ message: 'Role must be "customer" or "vendor"' });
    }

    const users = getDB().collection('user');
    const user = await users.findOne(
      { _id: req.user._id },
      { projection: { roleSelectionPending: 1 } },
    );
    if (!user?.roleSelectionPending) {
      return res.status(403).json({ message: 'Role choice is not available' });
    }

    const result = await users.updateOne(
      { _id: user._id, roleSelectionPending: true },
      { $set: { role, roleSelectionPending: false } },
    );
    if (result.matchedCount === 0) {
      return res.status(403).json({ message: 'Role choice is not available' });
    }

    return res.status(200).json({ message: 'Role selected', data: { role } });
  } catch (err) {
    console.error('chooseRole error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function uploadProfileImage(req, res) {
  try {
    const contentType = req.get('content-type')?.split(';')[0].trim().toLowerCase();
    const validation = validateImageUpload(req.body, contentType, MAX_PROFILE_IMAGE_SIZE);
    if (!validation.ok) {
      return res.status(validation.status).json({ message: validation.message });
    }

    const suppliedName = req.get('x-file-name') ?? 'profile-image';
    const imageUrl = await uploadImageToImgBB(req.body, validation.contentType, suppliedName);

    return res.status(201).json({ message: 'Image uploaded', data: { url: imageUrl } });
  } catch (err) {
    console.error('ImgBB upload failed:', getSafeImgBBErrorDetails(err));
    if (err.code === 'IMGBB_NOT_CONFIGURED') {
      return res.status(503).json({ message: 'Image upload is not configured' });
    }
    return res.status(502).json({ message: 'Image upload failed' });
  }
}

export async function updateCustomerProfile(req, res) {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ message: 'Request body must be an object' });
    }

    const allowedFields = ['name', 'image'];
    const unknownField = Object.keys(req.body).find((field) => !allowedFields.includes(field));
    if (unknownField) {
      return res.status(400).json({ message: `${unknownField} cannot be updated here` });
    }

    const updates = {};

    if (req.body.name !== undefined) {
      if (typeof req.body.name !== 'string' || req.body.name.trim().length === 0 || req.body.name.trim().length > 100) {
        return res.status(400).json({ message: 'name must be a non-empty string of at most 100 characters' });
      }
      updates.name = req.body.name.trim();
    }

    if (req.body.image !== undefined) {
      if (typeof req.body.image !== 'string' || req.body.image.length > 2000) {
        return res.status(400).json({ message: 'image must be a string of at most 2000 characters' });
      }
      if (req.body.image && !/^https:\/\//i.test(req.body.image)) {
        return res.status(400).json({ message: 'image must be an HTTPS URL' });
      }
      updates.image = req.body.image;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'At least one profile field is required' });
    }

    const updated = await getDB().collection('user').findOneAndUpdate(
      { _id: req.user._id, role: 'customer' },
      { $set: updates },
      { returnDocument: 'after', projection: { name: 1, image: 1, email: 1 } },
    );
    if (!updated) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }
    return res.status(200).json({ message: 'Customer profile updated', data: updated });
  } catch (err) {
    console.error('updateCustomerProfile error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
