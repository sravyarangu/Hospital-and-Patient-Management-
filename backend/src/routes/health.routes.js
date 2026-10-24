import express from 'express';
import { checkDatabaseHealth } from '../services/databaseHealth.service.js';

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    app: 'medicare-backend',
    version: '1.0.0',
  });
});

router.get('/health/databases', async (req, res, next) => {
  try {
    const result = await checkDatabaseHealth();
    const statusCode = result.status === 'healthy' ? 200 : 503;

    res.status(statusCode).json({
      status: result.status,
      databases: {
        mongodb: result.mongodb,
        neo4j: result.neo4j,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
