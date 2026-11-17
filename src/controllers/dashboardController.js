import { getDB } from '../config/db.js';

export async function getVendorDashboard(req, res) {
  try {
    const db = getDB();
    const expiresAt = req.user.subscriptionExpiresAt ? new Date(req.user.subscriptionExpiresAt) : null;
    const hasActivePremium = req.user.subscriptionPlan === 'premium'
      && expiresAt
      && Number.isFinite(expiresAt.getTime())
      && expiresAt > new Date();
    const [totalMenuItems, activeMenuItems, pendingOrders, acceptedOrders] = await Promise.all([
      db.collection('menuItems').countDocuments({ vendorId: req.user._id }),
      db.collection('menuItems').countDocuments({ vendorId: req.user._id, status: 'approved' }),
      db.collection('orders').countDocuments({ vendorId: req.user._id, status: 'pending' }),
      db.collection('orders').countDocuments({ vendorId: req.user._id, status: 'accepted' }),
    ]);

    return res.status(200).json({
      message: 'Vendor dashboard retrieved',
      data: {
        totalMenuItems,
        activeMenuItems,
        pendingOrders,
        acceptedOrders,
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
    const orders = getDB().collection('orders');
    const filter = { customerId: req.user._id };
    const [totalOrders, pendingOrders, acceptedOrders, rejectedOrders] = await Promise.all([
      orders.countDocuments(filter),
      orders.countDocuments({ ...filter, status: 'pending' }),
      orders.countDocuments({ ...filter, status: 'accepted' }),
      orders.countDocuments({ ...filter, status: 'rejected' }),
    ]);

    return res.status(200).json({
      message: 'Customer dashboard retrieved',
      data: { totalOrders, pendingOrders, acceptedOrders, rejectedOrders },
    });
  } catch (err) {
    console.error('getCustomerDashboard error:', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
