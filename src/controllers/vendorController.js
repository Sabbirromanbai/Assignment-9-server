import { ObjectId } from 'mongodb';
import { getDB } from '../config/db.js';

function isValidObjectId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}

function publicProfile(user) {
  const expiry = user.subscriptionExpiresAt ? new Date(user.subscriptionExpiresAt) : null;
  const hasActivePremium = user.subscriptionPlan === 'premium'
    && expiry
    && Number.isFinite(expiry.getTime())
    && expiry > new Date();
  return {
    _id: user._id,
    name: user.name,
    image: user.image ?? null,
    businessName: user.businessName ?? null,
    subscriptionPlan: hasActivePremium ? 'premium' : 'free',
  };
}

export async function getVendorProfile(req, res) {
  try {
    const user = await getDB().collection('user').findOne(
      { _id: req.user._id, role: 'vendor' },
      { projection: { name: 1, image: 1, businessName: 1, email: 1, subscriptionPlan: 1, subscriptionExpiresAt: 1 } },
    );
    if (!user) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }
    return res.status(200).json({ message: 'Vendor profile retrieved', data: user });
  } catch (err) {
    console.error('getVendorProfile error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function updateVendorProfile(req, res) {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ message: 'Request body must be an object' });
    }

    const allowedFields = ['name', 'businessName', 'image'];
    const unknownField = Object.keys(req.body).find((field) => !allowedFields.includes(field));
    if (unknownField) {
      return res.status(400).json({ message: `${unknownField} cannot be updated here` });
    }

    const updates = {};
    for (const field of ['name', 'businessName']) {
      if (req.body[field] !== undefined) {
        const value = req.body[field];
        const maxLength = field === 'name' ? 100 : 150;
        if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
          return res.status(400).json({ message: `${field} must be a non-empty string of at most ${maxLength} characters` });
        }
        updates[field] = value.trim();
      }
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
      { _id: req.user._id, role: 'vendor' },
      { $set: updates },
      { returnDocument: 'after', projection: { name: 1, image: 1, businessName: 1, email: 1 } },
    );
    if (!updated) {
      return res.status(404).json({ message: 'Vendor profile not found' });
    }
    return res.status(200).json({ message: 'Vendor profile updated', data: updated });
  } catch (err) {
    console.error('updateVendorProfile error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getPublicVendorProfile(req, res) {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid vendor ID' });
    }
    const user = await getDB().collection('user').findOne(
      { _id: new ObjectId(req.params.id), role: 'vendor' },
      { projection: { name: 1, image: 1, businessName: 1, subscriptionPlan: 1, subscriptionExpiresAt: 1 } },
    );
    if (!user) {
      return res.status(404).json({ message: 'Vendor not found' });
    }
    return res.status(200).json({ message: 'Vendor retrieved', data: publicProfile(user) });
  } catch (err) {
    console.error('getPublicVendorProfile error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
