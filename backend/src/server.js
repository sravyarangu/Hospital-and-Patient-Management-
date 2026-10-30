import app from './app.js';
import { env, getMissingRequiredEnv } from './config/env.js';
import { connectMongoDB, closeMongoDB } from './config/mongodb.js';
import { connectNeo4j, closeNeo4j } from './config/neo4j.js';

async function startServer() {
  const missing = getMissingRequiredEnv();

  if (missing.length > 0) {
    console.error('[backend] Startup failed. Missing required environment variables:');
    console.error(missing.join(', '));
    console.error('[backend] Copy backend/.env.example to backend/.env and fill in the required values before starting the service.');
    process.exit(1);
  }

  try {
    await connectMongoDB();
    try {
      await connectNeo4j();
    } catch (error) {
      console.warn('[backend] Neo4j is unavailable. Starting with degraded functionality.');
      console.error(error.message || 'Unknown Neo4j connection error.');
    }

    const server = app.listen(env.port, () => {
      console.log(`[backend] MediCare API is listening on http://localhost:${env.port}`);
    });

    const shutdown = async (signal) => {
      console.log(`[backend] Received ${signal}. Closing database connections...`);
      server.close(() => {
        console.log('[backend] HTTP server closed.');
      });

      await Promise.allSettled([closeMongoDB(), closeNeo4j()]);
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[backend] Startup failed.');
    console.error(error.message || 'Unknown startup error.');
    await Promise.allSettled([closeMongoDB(), closeNeo4j()]);
    process.exit(1);
  }
}

startServer();
