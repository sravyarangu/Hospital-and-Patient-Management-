import { connectMongoDB, getMongoDatabase } from '../config/mongodb.js';
import { connectNeo4j, getNeo4jDriver } from '../config/neo4j.js';

export async function checkDatabaseHealth() {
  const health = {
    status: 'degraded',
    mongodb: 'disconnected',
    neo4j: 'disconnected',
  };

  try {
    await connectMongoDB();
    const db = getMongoDatabase();
    if (db) {
      health.mongodb = 'connected';
    }
  } catch (error) {
    health.mongodb = 'disconnected';
    console.error('[backend:db:mongodb]', 'MongoDB connectivity check failed.');
  }

  try {
    await connectNeo4j();
    if (getNeo4jDriver()) {
      health.neo4j = 'connected';
    }
  } catch (error) {
    health.neo4j = 'disconnected';
    console.error('[backend:db:neo4j]', 'Neo4j connectivity check failed.');
  }

  if (health.mongodb === 'connected' && health.neo4j === 'connected') {
    health.status = 'healthy';
  } else if (health.mongodb === 'connected' || health.neo4j === 'connected') {
    health.status = 'degraded';
  } else {
    health.status = 'down';
  }

  return health;
}
