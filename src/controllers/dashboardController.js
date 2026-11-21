import { getDB } from '../config/db.js';

function getLast30Days() {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  const dates = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  return { start, end, dates };
}

function fillDailyCounts(dates, rows) {
  const counts = new Map(rows.map((row) => [row.date, row.orders]));
  return dates.map((date) => ({ date, orders: counts.get(date) ?? 0 }));
}

export async function getVendorDashboard(req, res) {
  try {
    const db = getDB();
    const expiresAt = req.user.subscriptionExpiresAt ? new Date(req.user.subscriptionExpiresAt) : null;
    const hasActivePremium = req.user.subscriptionPlan === 'premium'
      && expiresAt
      && Number.isFinite(expiresAt.getTime())
      && expiresAt > new Date();
    const { start, end, dates } = getLast30Days();
    const vendorOrders = db.collection('orders');
    const [totalMenuItems, activeMenuItems, pendingOrders, acceptedOrders, dailyOrderRows, categoryBreakdown] = await Promise.all([
      db.collection('menuItems').countDocuments({ vendorId: req.user._id }),
      db.collection('menuItems').countDocuments({ vendorId: req.user._id, status: 'approved' }),
      db.collection('orders').countDocuments({ vendorId: req.user._id, status: 'pending' }),
      db.collection('orders').countDocuments({ vendorId: req.user._id, status: 'accepted' }),
      vendorOrders.aggregate([
        { $match: { vendorId: req.user._id, createdAt: { $gte: start, $lt: end } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, orders: { $sum: 1 } } },
        { $project: { _id: 0, date: '$_id', orders: 1 } },
      ]).toArray(),
      vendorOrders.aggregate([
        { $match: { vendorId: req.user._id } },
        { $lookup: { from: 'menuItems', localField: 'itemId', foreignField: '_id', as: 'menuItem' } },
        { $unwind: { path: '$menuItem', preserveNullAndEmptyArrays: true } },
        { $group: { _id: { $ifNull: ['$menuItem.category', 'Other'] }, orders: { $sum: 1 } } },
        { $project: { _id: 0, category: '$_id', orders: 1 } },
        { $sort: { orders: -1 } },
      ]).toArray(),
    ]);

    return res.status(200).json({
      message: 'Vendor dashboard retrieved',
      data: {
        totalMenuItems,
        activeMenuItems,
        pendingOrders,
        acceptedOrders,
        dailyOrders: fillDailyCounts(dates, dailyOrderRows),
        categoryBreakdown,
        subscriptionPlan: hasActivePremium ? 'premium' : 'free',
        subscriptionExpiresAt: hasActivePremium ? expiresAt : null,
      },
    });
  } catch (err) {
    console.error('getVendorDashboard error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export async function getCustomerDashboard(req, res) {
  try {
    const db = getDB();
    const orders = db.collection('orders');
    const filter = { customerId: req.user._id };
    const { start, end, dates } = getLast30Days();
    const [totalOrders, pendingOrders, acceptedOrders, rejectedOrders, dailyOrderRows] = await Promise.all([
      orders.countDocuments(filter),
      orders.countDocuments({ ...filter, status: 'pending' }),
      orders.countDocuments({ ...filter, status: 'accepted' }),
      orders.countDocuments({ ...filter, status: 'rejected' }),
      orders.aggregate([
        { $match: { ...filter, createdAt: { $gte: start, $lt: end } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, orders: { $sum: 1 } } },
        { $project: { _id: 0, date: '$_id', orders: 1 } },
      ]).toArray(),
    ]);

    return res.status(200).json({
      message: 'Customer dashboard retrieved',
      data: {
        totalOrders,
        pendingOrders,
        acceptedOrders,
        rejectedOrders,
        dailyOrders: fillDailyCounts(dates, dailyOrderRows),
      },
    });
  } catch (err) {
    console.error('getCustomerDashboard error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
