import { ObjectId } from 'mongodb';
import { getDB } from '../config/db.js';

const ORDERS = 'orders';
const MENU_ITEMS = 'menuItems';

function isValidObjectId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}

function readDeliveryDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function bodyIsObject(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

function asObjectId(value) {
  if (value instanceof ObjectId) {
    return value;
  }
  if (typeof value === 'string' && isValidObjectId(value)) {
    return new ObjectId(value);
  }
  return null;
}

export async function createOrder(req, res) {
  try {
    const body = req.body;
    if (!bodyIsObject(body)) {
      return res.status(400).json({ message: 'Request body must be an object' });
    }
    const allowedFields = ['itemId', 'deliveryDate', 'deliveryAddress', 'message'];
    const unknownField = Object.keys(body).find((field) => !allowedFields.includes(field));
    if (unknownField) {
      return res.status(400).json({ message: `${unknownField} is not allowed` });
    }

    if (!isValidObjectId(body.itemId)) {
      return res.status(400).json({ message: 'A valid itemId is required' });
    }
    if (typeof body.deliveryAddress !== 'string' || body.deliveryAddress.trim().length === 0) {
      return res.status(400).json({ message: 'A deliveryAddress is required' });
    }
    if (body.deliveryAddress.trim().length > 1000) {
      return res.status(400).json({ message: 'deliveryAddress must be 1000 characters or fewer' });
    }
    if (body.message !== undefined && (typeof body.message !== 'string' || body.message.length > 1000)) {
      return res.status(400).json({ message: 'message must be a string of 1000 characters or fewer' });
    }

    const deliveryDate = readDeliveryDate(body.deliveryDate);
    if (!deliveryDate) {
      return res.status(400).json({ message: 'deliveryDate must be a valid YYYY-MM-DD date' });
    }

    const db = getDB();
    const item = await db.collection(MENU_ITEMS).findOne({ _id: new ObjectId(body.itemId) });
    if (!item) {
      return res.status(404).json({ message: 'Item not found' });
    }

    if (item.status !== 'approved') {
      return res.status(409).json({ message: 'Only approved and active items can be ordered' });
    }

    const vendorId = asObjectId(item.vendorId);
    if (!vendorId) {
      return res.status(409).json({ message: 'Item vendor is not configured correctly' });
    }
    if (vendorId.equals(req.user._id)) {
      return res.status(403).json({ message: 'Vendors cannot order their own items' });
    }

    const itemId = asObjectId(item._id);
    if (!itemId) {
      return res.status(409).json({ message: 'Item ID is not configured correctly' });
    }

    const duplicate = await db.collection(ORDERS).findOne({
      customerId: req.user._id,
      itemId,
      deliveryDate,
      status: { $in: ['pending', 'accepted'] },
    });
    if (duplicate) {
      return res.status(409).json({ message: 'An active order already exists for this item and delivery date' });
    }

    const order = {
      itemId,
      vendorId,
      customerId: req.user._id,
      deliveryDate,
      deliveryAddress: body.deliveryAddress.trim(),
      message: body.message?.trim() ?? '',
      status: 'pending',
      createdAt: new Date(),
    };

    const result = await db.collection(ORDERS).insertOne(order);
    return res.status(201).json({
      message: 'Order created',
      data: { _id: result.insertedId, ...order },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'An active order already exists for this item and delivery date' });
    }
    console.error('createOrder error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function listMyOrders(req, res) {
  try {
    const filter = req.user.role === 'customer'
      ? { customerId: req.user._id }
      : { vendorId: req.user._id };
    const db = getDB();
    const orders = await db
      .collection(ORDERS)
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    if (req.user.role === 'vendor') {
      const customerIds = [...new Map(
        orders
          .filter((order) => order.customerId)
          .map((order) => [order.customerId.toString(), order.customerId]),
      ).values()];
      const customers = customerIds.length === 0
        ? []
        : await db.collection('user')
          .find({ _id: { $in: customerIds } }, { projection: { name: 1, email: 1 } })
          .toArray();
      const customersById = new Map(customers.map((customer) => [customer._id.toString(), customer]));
      const enrichedOrders = orders.map((order) => {
        const customer = customersById.get(order.customerId?.toString());
        return {
          ...order,
          customerName: customer?.name ?? null,
          customerEmail: customer?.email ?? null,
        };
      });

      return res.status(200).json({ message: 'Orders retrieved', data: enrichedOrders });
    }

    return res.status(200).json({ message: 'Orders retrieved', data: orders });
  } catch (err) {
    console.error('listMyOrders error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function cancelOrder(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid order ID' });
    }

    const db = getDB();
    const orders = db.collection(ORDERS);
    const filter = { _id: new ObjectId(id), customerId: req.user._id, status: 'pending' };
    const result = await orders.updateOne(filter, { $set: { status: 'cancelled' } });

    if (result.matchedCount === 0) {
      const ownOrder = await orders.findOne({ _id: filter._id, customerId: req.user._id });
      if (!ownOrder) {
        return res.status(404).json({ message: 'Order not found' });
      }
      return res.status(409).json({ message: 'Only pending orders can be cancelled' });
    }

    const order = await orders.findOne({ _id: filter._id, customerId: req.user._id });
    return res.status(200).json({ message: 'Order cancelled', data: order });
  } catch (err) {
    console.error('cancelOrder error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function updateOrderStatus(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid order ID' });
    }
    if (!bodyIsObject(req.body) || !['accepted', 'rejected'].includes(req.body.status)) {
      return res.status(400).json({ message: 'status must be either accepted or rejected' });
    }

    const db = getDB();
    const orders = db.collection(ORDERS);
    const filter = { _id: new ObjectId(id), vendorId: req.user._id, status: 'pending' };
    const result = await orders.updateOne(filter, { $set: { status: req.body.status } });

    if (result.matchedCount === 0) {
      const vendorOrder = await orders.findOne({ _id: filter._id, vendorId: req.user._id });
      if (!vendorOrder) {
        return res.status(404).json({ message: 'Order not found' });
      }
      return res.status(409).json({ message: 'Only pending orders can be updated' });
    }

    const order = await orders.findOne({ _id: filter._id, vendorId: req.user._id });
    return res.status(200).json({ message: `Order ${req.body.status}`, data: order });
  } catch (err) {
    console.error('updateOrderStatus error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
