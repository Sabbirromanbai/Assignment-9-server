import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { connectDB } from './src/config/db.js';

// Create an instance of the Express application
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));

// Define routes
app.get('/', (req, res) => {
    res.send('Hello World!');
})

// Start Express only after a successful MongoDB connection
await connectDB();

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
})
