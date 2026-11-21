import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { toNodeHandler } from 'better-auth/node';
import { connectDB } from './src/config/db.js';
import { createAuth } from './src/config/auth.js';
import pizzaRoutes from './src/routes/pizzaRoutes.js';
import orderRoutes from './src/routes/orderRoutes.js';
import menuRoutes from './src/routes/menuRoutes.js';
import profileRoutes from './src/routes/profileRoutes.js';
import subscriptionRoutes from './src/routes/subscriptionRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import vendorRoutes from './src/routes/vendorRoutes.js';
import customerRoutes from './src/routes/customerRoutes.js';

// Create an instance of the Express application
const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB first; auth needs the shared client.
// connectDB() exits the process (code 1) on failure.
const db = await connectDB();
try {
    const orders = db.collection('orders');
    const indexes = await orders.listIndexes().toArray();
    if (indexes.some((index) => index.name === 'unique_active_item_delivery_date')) {
        await orders.dropIndex('unique_active_item_delivery_date');
    }
    await orders.createIndex(
        { customerId: 1, itemId: 1, deliveryDate: 1 },
        {
            unique: true,
            partialFilterExpression: { status: { $in: ['pending', 'accepted'] } },
            name: 'unique_active_customer_item_delivery_date',
        },
    );
} catch (err) {
    console.error('Failed to ensure the unique active-order index:', err.message);
    process.exit(1);
}

// One transaction per Stripe Checkout Session and per Stripe Subscription.
// The partial filters keep legacy records without those IDs from conflicting.
try {
    await db.collection('transactions').createIndex(
        { stripeSessionId: 1 },
        {
            unique: true,
            partialFilterExpression: { stripeSessionId: { $type: 'string' } },
            name: 'unique_transaction_stripe_session',
        },
    );
    await db.collection('transactions').createIndex(
        { stripeSubscriptionId: 1 },
        {
            unique: true,
            partialFilterExpression: { stripeSubscriptionId: { $type: 'string' } },
            name: 'unique_transaction_stripe_subscription',
        },
    );
} catch (err) {
    console.error('Failed to ensure transaction indexes:', err.message);
    process.exit(1);
}

// Better Auth is initialized only after a successful DB connection
const auth = createAuth();

// Middleware
// CORS: concrete origin + credentials (never '*' with credentials)
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));

// Better Auth handler (parses request bodies itself, must run before express.json())
// Express 5 catch-all syntax: /*splat
app.all('/api/auth/*splat', toNodeHandler(auth));

app.use('/api/subscriptions', subscriptionRoutes);

app.use(express.json());

// Define routes
app.use('/api/pizzas', pizzaRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/customers', customerRoutes);

app.get('/', (req, res) => {
    res.send('Hello World!');
})

// Start Express only after a successful MongoDB connection
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})
