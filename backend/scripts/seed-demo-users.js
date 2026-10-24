import bcrypt from 'bcryptjs';
import { closeMongoDB, connectMongoDB, getMongoDatabase } from '../src/config/mongodb.js';
import { env } from '../src/config/env.js';

const demoUsers = [
  { email: 'admin@medicare.demo', name: 'MediCare Administrator', role: 'admin', passwordEnv: 'DEMO_ADMIN_PASSWORD' },
  { email: 'doctor@medicare.demo', name: 'Dr. Demo', role: 'doctor', passwordEnv: 'DEMO_DOCTOR_PASSWORD' },
  { email: 'patient@medicare.demo', name: 'Demo Patient', role: 'patient', passwordEnv: 'DEMO_PATIENT_PASSWORD' },
];

async function seedDemoUsers() {
  if (!env.mongodbUri || !env.mongodbDatabase) {
    throw new Error('Set MONGODB_URI and MONGODB_DATABASE in backend/.env before seeding.');
  }

  const missingPasswords = demoUsers
    .filter(({ passwordEnv }) => !process.env[passwordEnv] || process.env[passwordEnv].length < 10)
    .map(({ passwordEnv }) => passwordEnv);

  if (missingPasswords.length) {
    throw new Error(`Set unique demo passwords of at least 10 characters: ${missingPasswords.join(', ')}.`);
  }

  await connectMongoDB();
  const db = getMongoDatabase();
  const users = db.collection('users');
  await users.createIndex({ email: 1 }, { unique: true });
  await db.collection('patients').createIndex({ userId: 1 }, { unique: true });
  await db.collection('doctors').createIndex({ userId: 1 }, { unique: true });

  for (const demoUser of demoUsers) {
    const now = new Date();
    const passwordHash = await bcrypt.hash(process.env[demoUser.passwordEnv], 12);
    const result = await users.updateOne(
      { email: demoUser.email },
      {
        $setOnInsert: {
          name: demoUser.name,
          email: demoUser.email,
          role: demoUser.role,
          passwordHash,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    const account = await users.findOne({ email: demoUser.email });

    if (account.role !== demoUser.role) {
      throw new Error(`Existing ${demoUser.email} account has a different role; refusing to change its privileges.`);
    }

    if (demoUser.role === 'patient') {
      await db.collection('patients').updateOne(
        { userId: account._id },
        { $setOnInsert: { userId: account._id, name: account.name, email: account.email, createdAt: now, updatedAt: now } },
        { upsert: true },
      );
    } else if (demoUser.role === 'doctor') {
      await db.collection('doctors').updateOne(
        { userId: account._id },
        { $setOnInsert: { userId: account._id, name: account.name, email: account.email, createdAt: now, updatedAt: now } },
        { upsert: true },
      );
    }

    console.log(`[seed] ${result.upsertedCount ? 'Created' : 'Verified'} ${demoUser.role} demo account.`);
  }
}

seedDemoUsers()
  .catch((error) => {
    console.error('[seed] Demo user seeding failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongoDB();
  });
