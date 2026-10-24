import { getMissingRequiredEnv } from '../src/config/env.js';
import { connectMongoDB, closeMongoDB } from '../src/config/mongodb.js';
import { connectNeo4j, closeNeo4j } from '../src/config/neo4j.js';

const results = {
  mongodb: 'FAIL',
  neo4j: 'FAIL',
};

async function main() {
  const missing = getMissingRequiredEnv();

  if (missing.length > 0) {
    console.error('[check:db] Missing required environment variables:');
    console.error(missing.join(', '));
    console.error('[check:db] Copy backend/.env.example to backend/.env and fill in the required values before running database checks.');
    process.exit(1);
  }

  try {
    await connectMongoDB();
    results.mongodb = 'PASS';
    console.log('[check:db] PASS MongoDB ping and database access check.');
  } catch (error) {
    console.error('[check:db] FAIL MongoDB:');
    console.error(error.message || 'Unknown MongoDB error.');
  } finally {
    await closeMongoDB();
  }

  try {
    await connectNeo4j();
    results.neo4j = 'PASS';
    console.log('[check:db] PASS Neo4j connectivity and query check.');
  } catch (error) {
    console.error('[check:db] FAIL Neo4j:');
    console.error(error.message || 'Unknown Neo4j error.');
  } finally {
    await closeNeo4j();
  }

  const didAllPass = results.mongodb === 'PASS' && results.neo4j === 'PASS';

  if (!didAllPass) {
    process.exit(1);
  }
}

main();
