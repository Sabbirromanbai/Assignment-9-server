import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { toNodeHandler } from 'better-auth/node';
import { connectDB } from './src/config/db.js';
import { createAuth } from './src/config/auth.js';
import pizzaRoutes from './src/routes/pizzaRoutes.js';

// Create an instance of the Express application
const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB first; auth needs the shared client.
// connectDB() exits the process (code 1) on failure.
await connectDB();

// Better Auth is initialized only after a successful DB connection
const auth = createAuth();

// Middleware
// CORS: concrete origin + credentials (never '*' with credentials)
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));

// Better Auth handler (parses request bodies itself, must run before express.json())
// Express 5 catch-all syntax: /*splat
app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json());

// Define routes
app.use('/api/pizzas', pizzaRoutes);

app.get('/', (req, res) => {
    res.send('Hello World!');
})

// Start Express only after a successful MongoDB connection
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})
