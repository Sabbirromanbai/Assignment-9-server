import { ObjectId } from 'mongodb';
import { getDB } from '../config/db.js';

const MENU_ITEMS = 'menuItems';
const ACTIVE_STATUSES = ['approved'];
const ALLOWED_STATUSES = ['pending', 'approved', 'rejected', 'inactive'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const PROTECTED_FIELDS = ['_id', 'vendorId', 'status', 'createdAt'];

function isValidObjectId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function menuFilter(query, publicOnly) {
  const allowedParams = publicOnly
    ? ['search', 'category', 'location', 'sort']
    : ['search', 'category', 'location', 'sort', 'status'];
  const unknownParam = Object.keys(query).find((key) => !allowedParams.includes(key));
  if (unknownParam) {
    return { error: `Unknown query parameter: ${unknownParam}` };
  }

  const filter = publicOnly ? { status: 'approved' } : {};
  for (const field of ['search', 'category', 'location']) {
    const value = query[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 100) {
      return { error: `${field} must be a non-empty string of 100 characters or fewer` };
    }
    if (field === 'search') {
      filter.itemName = { $regex: escapeRegex(value.trim()), $options: 'i' };
    } else {
      filter[field] = { $regex: `^${escapeRegex(value.trim())}$`, $options: 'i' };
    }
  }

  if (!publicOnly && query.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(query.status)) {
      return { error: 'status must be pending, approved, rejected, or inactive' };
    }
    filter.status = query.status;
  }

  const sortBy = query.sort ?? 'newest';
  if (!['newest', 'price_asc', 'price_desc'].includes(sortBy)) {
    return { error: 'sort must be newest, price_asc, or price_desc' };
  }
  const sort = sortBy === 'price_asc'
    ? { price: 1 }
    : sortBy === 'price_desc'
      ? { price: -1 }
      : { createdAt: -1 };

  return { filter, sort };
}

function isImgBBUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'i.ibb.co' && url.pathname.length > 1;
  } catch {
    return false;
  }
}

function validateMenuItem(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }

  const protectedField = PROTECTED_FIELDS.find((field) => field in body);
  if (protectedField) {
    return { error: `${protectedField} cannot be set by the client` };
  }

  const value = {};
  const requiredFields = ['itemName', 'category', 'description', 'price', 'location', 'images'];

  for (const field of requiredFields) {
    if (partial && body[field] === undefined) {
      continue;
    }

    if (field === 'price') {
      if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price <= 0) {
        return { error: 'price must be a positive number' };
      }
      value.price = body.price;
      continue;
    }

    if (field === 'images') {
      if (!Array.isArray(body.images) || body.images.length === 0 || !body.images.every(isImgBBUrl)) {
        return { error: 'images must be a non-empty array of ImgBB image URLs' };
      }
      value.images = [...body.images];
      continue;
    }

    const limits = { itemName: 100, category: 80, description: 2000, location: 200 };
    if (!isNonEmptyString(body[field], limits[field])) {
      return { error: `${field} is required and must be a string of 1-${limits[field]} characters` };
    }
    value[field] = body[field].trim();
  }

  const unknownField = Object.keys(body).find((field) => !requiredFields.includes(field) && !PROTECTED_FIELDS.includes(field));
  if (unknownField) {
    return { error: `Unknown field: ${unknownField}` };
  }

  return { value };
}

function hasActivePremiumSubscription(user) {
  if (typeof user.subscriptionPlan !== 'string' || user.subscriptionPlan.toLowerCase() !== 'premium') {
    return false;
  }
  if (!user.subscriptionExpiresAt) {
    return false;
  }
  const expiry = new Date(user.subscriptionExpiresAt);
  return Number.isFinite(expiry.getTime()) && expiry > new Date();
}

async function exceedsFreePlanLimit(db, user, currentlyActive = false) {
  if (hasActivePremiumSubscription(user)) {
    return false;
  }
  const activeCount = await db.collection(MENU_ITEMS).countDocuments({
    vendorId: user._id,
    status: { $in: ACTIVE_STATUSES },
  });
  return activeCount >= 3 && !currentlyActive;
}

export async function browseMenu(req, res) {
  try {
    const { error, filter, sort } = menuFilter(req.query, true);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const items = await getDB()
      .collection(MENU_ITEMS)
      .find(filter)
      .sort(sort)
      .toArray();
    return res.status(200).json({ message: 'Approved menu items', data: items });
  } catch (err) {
    console.error('browseMenu error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function listAdminMenuItems(req, res) {
  try {
    const { error, filter, sort } = menuFilter(req.query, false);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const items = await getDB()
      .collection(MENU_ITEMS)
      .find(filter)
      .sort(sort)
      .toArray();
    return res.status(200).json({ message: 'Menu items retrieved', data: items });
  } catch (err) {
    console.error('listAdminMenuItems error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function listPendingMenuItems(req, res) {
  try {
    const items = await getDB()
      .collection(MENU_ITEMS)
      .find({ status: 'pending' })
      .sort({ createdAt: 1 })
      .toArray();
    return res.status(200).json({ message: 'Pending menu items retrieved', data: items });
  } catch (err) {
    console.error('listPendingMenuItems error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function changeMenuItemStatus(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid menu item ID' });
    }
    if (
      !req.body
      || typeof req.body !== 'object'
      || Array.isArray(req.body)
      || typeof req.body.status !== 'string'
      || !ALLOWED_STATUSES.includes(req.body.status)
      || Object.keys(req.body).some((key) => key !== 'status')
    ) {
      return res.status(400).json({ message: 'status must be pending, approved, rejected, or inactive' });
    }

    const db = getDB();
    const itemFilter = { _id: new ObjectId(id) };
    const item = await db.collection(MENU_ITEMS).findOne(itemFilter);
    if (!item) {
      return res.status(404).json({ message: 'Menu item not found' });
    }

    const isCurrentlyActive = ACTIVE_STATUSES.includes(item.status);
    const willBeActive = ACTIVE_STATUSES.includes(req.body.status);
    if (willBeActive && !isCurrentlyActive) {
      const vendor = await db.collection('user').findOne({ _id: item.vendorId });
      if (!vendor) {
        return res.status(409).json({ message: 'Menu item vendor account was not found' });
      }
      if (await exceedsFreePlanLimit(db, vendor, false)) {
        return res.status(409).json({ message: 'Vendor has reached the free-plan limit of 3 active menu items' });
      }
    }

    const updated = await db.collection(MENU_ITEMS).findOneAndUpdate(
      itemFilter,
      { $set: { status: req.body.status } },
      { returnDocument: 'after' },
    );
    return res.status(200).json({
      message: `Menu item status changed to ${req.body.status}`,
      data: updated,
    });
  } catch (err) {
    console.error('changeMenuItemStatus error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function listMyMenuItems(req, res) {
  try {
    const items = await getDB()
      .collection(MENU_ITEMS)
      .find({ vendorId: req.user._id })
      .sort({ createdAt: -1 })
      .toArray();
    return res.status(200).json({ message: 'Menu items retrieved', data: items });
  } catch (err) {
    console.error('listMyMenuItems error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function createMenuItem(req, res) {
  try {
    const { error, value } = validateMenuItem(req.body);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const item = {
      vendorId: req.user._id,
      ...value,
      status: 'pending',
      createdAt: new Date(),
    };
    const result = await getDB().collection(MENU_ITEMS).insertOne(item);
    return res.status(201).json({
      message: 'Menu item created and submitted for approval',
      data: { _id: result.insertedId, ...item },
    });
  } catch (err) {
    console.error('createMenuItem error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function updateMenuItem(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid menu item ID' });
    }

    const { error, value } = validateMenuItem(req.body, true);
    if (error) {
      return res.status(400).json({ message: error });
    }
    if (Object.keys(value).length === 0) {
      return res.status(400).json({ message: 'At least one editable field is required' });
    }

    const db = getDB();
    const filter = { _id: new ObjectId(id), vendorId: req.user._id };
    const currentItem = await db.collection(MENU_ITEMS).findOne(filter);
    if (!currentItem) {
      return res.status(404).json({ message: 'Menu item not found' });
    }

    const updated = await db.collection(MENU_ITEMS).findOneAndUpdate(
      filter,
      { $set: { ...value, status: 'pending' } },
      { returnDocument: 'after' },
    );
    return res.status(200).json({ message: 'Menu item updated and submitted for approval', data: updated });
  } catch (err) {
    console.error('updateMenuItem error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function setMenuItemAvailability(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid menu item ID' });
    }
    if (!req.body || typeof req.body.active !== 'boolean' || Object.keys(req.body).some((key) => key !== 'active')) {
      return res.status(400).json({ message: 'active must be a boolean' });
    }

    const db = getDB();
    const filter = { _id: new ObjectId(id), vendorId: req.user._id };
    const currentItem = await db.collection(MENU_ITEMS).findOne(filter);
    if (!currentItem) {
      return res.status(404).json({ message: 'Menu item not found' });
    }

    let status;
    if (!req.body.active) {
      status = 'inactive';
    } else if (currentItem.status === 'approved' || currentItem.status === 'pending') {
      status = currentItem.status;
    } else {
      status = 'pending';
    }

    const updated = await db.collection(MENU_ITEMS).findOneAndUpdate(
      filter,
      { $set: { status } },
      { returnDocument: 'after' },
    );
    return res.status(200).json({
      message: status === 'inactive' ? 'Menu item deactivated' : 'Menu item submitted for approval',
      data: updated,
    });
  } catch (err) {
    console.error('setMenuItemAvailability error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function deleteMenuItem(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid menu item ID' });
    }

    const result = await getDB().collection(MENU_ITEMS).deleteOne({
      _id: new ObjectId(id),
      vendorId: req.user._id,
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Menu item not found' });
    }
    return res.status(200).json({ message: 'Menu item deleted' });
  } catch (err) {
    console.error('deleteMenuItem error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function deleteAdminMenuItem(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid menu item ID' });
    }

    const result = await getDB().collection(MENU_ITEMS).deleteOne({
      _id: new ObjectId(id),
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Menu item not found' });
    }
    return res.status(200).json({ message: 'Menu item deleted' });
  } catch (err) {
    console.error('deleteAdminMenuItem error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function uploadMenuImage(req, res) {
  if (!process.env.IMGBB_API_KEY) {
    return res.status(503).json({ message: 'Image uploads are not configured; IMGBB_API_KEY is required' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ message: 'Send one image file as the request body' });
  }

  const contentType = req.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(contentType)) {
    return res.status(415).json({ message: 'Only JPEG, PNG, and WebP images are supported' });
  }
  if (req.body.length > MAX_IMAGE_SIZE) {
    return res.status(413).json({ message: 'Image must be 10 MB or smaller' });
  }

  const suppliedName = req.get('x-file-name') ?? 'menu-item';
  const fileName = suppliedName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'menu-item';

  try {
    const form = new FormData();
    form.append('image', new Blob([req.body], { type: contentType }), fileName);
    form.append('name', fileName);

    const response = await fetch(
      `https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`,
      { method: 'POST', body: form },
    );
    const result = await response.json();
    const imageUrl = result?.data?.image?.url;
    if (!response.ok || result?.success !== true || !isImgBBUrl(imageUrl)) {
      console.error('uploadMenuImage error: ImgBB rejected the upload');
      return res.status(502).json({ message: 'Image upload provider rejected the image' });
    }

    return res.status(201).json({ message: 'Image uploaded', data: { url: imageUrl } });
  } catch (err) {
    console.error('uploadMenuImage error:', err.message);
    return res.status(502).json({ message: 'Image upload failed' });
  }
}
