import path from 'node:path';
import dotenv from 'dotenv';

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const getRequiredVars = () => [
  'PORT',
  'NODE_ENV',
  'FRONTEND_ORIGIN',
  'MONGODB_URI',
  'MONGODB_DATABASE',
  'NEO4J_URI',
  'NEO4J_USERNAME',
  'NEO4J_PASSWORD',
  'NEO4J_DATABASE',
  'JWT_SECRET_KEY',
  'SESSION_SECRET',
];

export const env = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  mongodbUri: process.env.MONGODB_URI || '',
  mongodbDatabase: process.env.MONGODB_DATABASE || 'medicare',
  neo4jUri: process.env.NEO4J_URI || '',
  neo4jUsername: process.env.NEO4J_USERNAME || 'neo4j',
  neo4jPassword: process.env.NEO4J_PASSWORD || '',
  neo4jDatabase: process.env.NEO4J_DATABASE || 'neo4j',
  jwtSecretKey: process.env.JWT_SECRET_KEY || '',
  sessionSecret: process.env.SESSION_SECRET || '',
};

export const getMissingRequiredEnv = () => {
  const missing = [];

  for (const key of getRequiredVars()) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      missing.push(key);
    }
  }

  return missing;
};
