import { ObjectId } from 'mongodb';
import { getDB } from '../config/db.js';

function isValidObjectId(id) {
  return typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function getAdminDashboard(req, res) {
  try {
    const db = getDB();
    const [totalUsers, vendors, customers, totalMenuItems, pendingMenuItems, totalTransactions] = await Promise.all([
      db.collection('user').countDocuments({}),
      db.collection('user').countDocuments({ role: 'vendor' }),
      db.collection('user').countDocuments({ role: 'customer' }),
      db.collection('menuItems').countDocuments({}),
      db.collection('menuItems').countDocuments({ status: 'pending' }),
      db.collection('transactions').countDocuments({}),
    ]);

    return res.status(200).json({
      message: 'Admin dashboard retrieved',
      data: { totalUsers, vendors, customers, totalMenuItems, pendingMenuItems, totalTransactions },
    });
  } catch (err) {
    console.error('getAdminDashboard error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function listUsers(req, res) {
  try {
    const { role, search } = req.query;
    if (role !== undefined && !['vendor', 'customer'].includes(role)) {
      return res.status(400).json({ message: 'role must be vendor or customer' });
    }
    if (search !== undefined && (typeof search !== 'string' || search.trim().length === 0 || search.length > 100)) {
      return res.status(400).json({ message: 'search must be a non-empty string of 100 characters or fewer' });
    }

    const filter = { role: role ? role : { $in: ['vendor', 'customer'] } };
    if (search) {
      const regex = { $regex: escapeRegex(search.trim()), $options: 'i' };
      filter.$or = [{ name: regex }, { email: regex }];
    }

    const users = await getDB().collection('user')
      .find(filter, {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          role: 1,
          isBlocked: 1,
          businessName: 1,
          subscriptionPlan: 1,
          subscriptionExpiresAt: 1,
          createdAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .toArray();
    return res.status(200).json({ message: 'Users retrieved', data: users });
  } catch (err) {
    console.error('listUsers error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function setUserBlocked(req, res) {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    if (
      !req.body
      || typeof req.body !== 'object'
      || Array.isArray(req.body)
      || typeof req.body.blocked !== 'boolean'
      || Object.keys(req.body).some((key) => key !== 'blocked')
    ) {
      return res.status(400).json({ message: 'blocked must be a boolean' });
    }

    const result = await getDB().collection('user').updateOne(
      { _id: new ObjectId(id), role: { $in: ['vendor', 'customer'] } },
      { $set: { isBlocked: req.body.blocked } },
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.status(200).json({
      message: req.body.blocked ? 'User blocked' : 'User unblocked',
      data: { _id: id, isBlocked: req.body.blocked },
    });
  } catch (err) {
    console.error('setUserBlocked error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function listTransactions(req, res) {
  try {
    const allowedParams = ['status', 'plan', 'vendorId'];
    const unknownParam = Object.keys(req.query).find((key) => !allowedParams.includes(key));
    if (unknownParam) {
      return res.status(400).json({ message: `Unknown query parameter: ${unknownParam}` });
    }
    if (req.query.vendorId !== undefined && !isValidObjectId(req.query.vendorId)) {
      return res.status(400).json({ message: 'Invalid vendorId' });
    }

    const filter = {};
    for (const field of ['status', 'plan']) {
      if (req.query[field] !== undefined) {
        if (typeof req.query[field] !== 'string' || req.query[field].length > 50) {
          return res.status(400).json({ message: `Invalid ${field}` });
        }
        filter[field] = req.query[field];
      }
    }
    if (req.query.vendorId) {
      filter.vendorId = new ObjectId(req.query.vendorId);
    }

    const db = getDB();
    const transactions = await db.collection('transactions')
      .find(filter, {
        projection: {
          vendorId: 1,
          plan: 1,
          amount: 1,
          currency: 1,
          stripeSessionId: 1,
          stripeSubscriptionId: 1,
          status: 1,
          createdAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .toArray();
    const vendorIds = [...new Map(
      transactions
        .filter((transaction) => transaction.vendorId)
        .map((transaction) => [transaction.vendorId.toString(), transaction.vendorId]),
    ).values()];
    const vendors = vendorIds.length === 0
      ? []
      : await db.collection('user')
        .find({ _id: { $in: vendorIds } }, { projection: { name: 1, email: 1 } })
        .toArray();
    const vendorsById = new Map(vendors.map((vendor) => [vendor._id.toString(), vendor]));
    const enrichedTransactions = transactions.map((transaction) => {
      const vendor = vendorsById.get(transaction.vendorId?.toString());
      return {
        ...transaction,
        vendorName: vendor?.name ?? null,
        vendorEmail: vendor?.email ?? null,
      };
    });
    return res.status(200).json({ message: 'Transactions retrieved', data: enrichedTransactions });
  } catch (err) {
    console.error('listTransactions error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
