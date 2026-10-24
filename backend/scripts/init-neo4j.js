import { createNeo4jDriver, closeNeo4j } from '../src/config/neo4j.js';
import { getMissingRequiredEnv } from '../src/config/env.js';

const uniquenessConstraints = [
  'CREATE CONSTRAINT patient_id_unique IF NOT EXISTS FOR (p:Patient) REQUIRE p.patient_id IS UNIQUE',
  'CREATE CONSTRAINT doctor_id_unique IF NOT EXISTS FOR (d:Doctor) REQUIRE d.doctor_id IS UNIQUE',
  'CREATE CONSTRAINT appointment_id_unique IF NOT EXISTS FOR (a:Appointment) REQUIRE a.appointment_id IS UNIQUE',
];

async function main() {
  const missing = getMissingRequiredEnv();

  if (missing.length > 0) {
    console.error('[init:neo4j] Missing required environment variables:');
    console.error(missing.join(', '));
    console.error('[init:neo4j] Copy backend/.env.example to backend/.env and fill in the required values before initializing Neo4j.');
    process.exit(1);
  }

  const driver = createNeo4jDriver();

  const session = driver.session({ database: process.env.NEO4J_DATABASE || 'neo4j' });

  try {
    for (const query of uniquenessConstraints) {
      await session.run(query);
      console.log(`[init:neo4j] Applied constraint: ${query}`);
    }

    console.log('[init:neo4j] Neo4j schema initialization complete.');
  } catch (error) {
    console.error('[init:neo4j] Neo4j initialization failed.');
    console.error(error.message || 'Unknown Neo4j error.');
    process.exit(1);
  } finally {
    await session.close();
    await closeNeo4j();
  }
}

main();
