import neo4j from 'neo4j-driver';
import { env } from './env.js';

let driver = null;

export const getNeo4jDriver = () => driver;

export function createNeo4jDriver() {
  if (!env.neo4jUri) {
    throw new Error('Missing Neo4j environment variables. Fill in NEO4J_URI and NEO4J_PASSWORD in backend/.env.');
  }

  if (!driver) {
    driver = neo4j.driver(
      env.neo4jUri,
      neo4j.auth.basic(env.neo4jUsername, env.neo4jPassword),
      {
        disableLosslessIntegers: true,
        maxConnectionPoolSize: 25,
      },
    );
  }

  return driver;
}

export async function connectNeo4j() {
  const neo4jDriver = createNeo4jDriver();
  const session = neo4jDriver.session({ database: env.neo4jDatabase || 'neo4j' });

  try {
    await session.run('RETURN 1 AS result');
    return neo4jDriver;
  } finally {
    await session.close();
  }
}

export async function closeNeo4j() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
