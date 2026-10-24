import { connectMongoDB, closeMongoDB, getMongoDatabase } from '../src/config/mongodb.js';
import { getMissingRequiredEnv } from '../src/config/env.js';

const collectionDefinitions = {
  users: [{ key: { user_id: 1 }, options: { unique: true, sparse: true } }],
  patients: [{ key: { patient_id: 1 }, options: { unique: true, sparse: true } }],
  doctors: [{ key: { doctor_id: 1 }, options: { unique: true, sparse: true } }],
  appointments: [
    { key: { appointment_id: 1 }, options: { unique: true, sparse: true } },
    { key: { appointment_date: 1 }, options: {} },
    { key: { patient_id: 1 }, options: {} },
    { key: { doctor_id: 1 }, options: {} },
    { key: { status: 1 }, options: {} },
  ],
  medical_records: [
    { key: { record_id: 1 }, options: { unique: true, sparse: true } },
    { key: { patient_id: 1 }, options: {} },
    { key: { doctor_id: 1 }, options: {} },
  ],
  audit_logs: [
    { key: { audit_id: 1 }, options: { unique: true, sparse: true } },
    { key: { created_at: 1 }, options: {} },
  ],
};

async function ensureIndexesForCollection(collectionName, indexes) {
  const db = getMongoDatabase();
  const collection = db.collection(collectionName);

  for (const index of indexes) {
    await collection.createIndex(index.key, index.options);
  }

  console.log(`[init:mongodb] Verified indexes for collection: ${collectionName}`);
}

async function main() {
  const missing = getMissingRequiredEnv();

  if (missing.length > 0) {
    console.error('[init:mongodb] Missing required environment variables:');
    console.error(missing.join(', '));
    console.error('[init:mongodb] Copy backend/.env.example to backend/.env and fill in the required values before initializing MongoDB.');
    process.exit(1);
  }

  try {
    await connectMongoDB();

    const db = getMongoDatabase();
    const existingCollections = await db.listCollections().toArray();
    const existingNames = new Set(existingCollections.map((entry) => entry.name));

    for (const collectionName of Object.keys(collectionDefinitions)) {
      if (!existingNames.has(collectionName)) {
        await db.createCollection(collectionName);
        console.log(`[init:mongodb] Created collection: ${collectionName}`);
      }

      await ensureIndexesForCollection(collectionName, collectionDefinitions[collectionName]);
    }

    console.log('[init:mongodb] MongoDB initialization complete.');
  } catch (error) {
    console.error('[init:mongodb] MongoDB initialization failed.');
    console.error(error.message || 'Unknown MongoDB error.');
    process.exit(1);
  } finally {
    await closeMongoDB();
  }
}

main();
