import { MongoClient } from 'mongodb';

let client = null;
let db = null;

/**
 * Connect to MongoDB and verify the connection with a ping.
 * Exits the process on failure so Express never starts without a database.
 * @returns {Promise<import('mongodb').Db>} the connected database handle
 */
export async function connectDB() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not defined in the environment variables.');
    process.exit(1);
  }

  // Create a single shared Mongo client for the whole application
  client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    db = client.db(process.env.DB_NAME);
    await db.command({ ping: 1 });
    console.log(`Successfully connected to MongoDB (db: ${db.databaseName})`);
    return db;
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

/**
 * Returns the connected database handle for use in routes.
 * Throws if called before connectDB() has succeeded.
 */
export function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return db;
}

/**
 * Returns the existing shared MongoClient instance.
 * Throws if called before connectDB() has succeeded.
 */
export function getMongoClient() {
  if (!client) {
    throw new Error('MongoClient not initialized. Call connectDB() first.');
  }
  return client;
}
