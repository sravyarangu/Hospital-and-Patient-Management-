import { MongoClient } from 'mongodb';
import { env } from './env.js';

let client = null;
let database = null;

export const getMongoClient = () => client;
export const getMongoDatabase = () => {
  if (!database) {
    throw new Error('MongoDB database connection is not initialized.');
  }

  return database;
};

export async function connectMongoDB() {
  if (!env.mongodbUri || !env.mongodbDatabase) {
    throw new Error('Missing MongoDB environment variables. Fill in MONGODB_URI and MONGODB_DATABASE in backend/.env.');
  }

  if (!client) {
    client = new MongoClient(env.mongodbUri, {
      serverSelectionTimeoutMS: 15000,
      maxPoolSize: 10,
    });
  }

  await client.connect();
  database = client.db(env.mongodbDatabase);

  await database.command({ ping: 1 });
  return database;
}

export async function closeMongoDB() {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
}
