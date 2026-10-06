import express from 'express';
import cors from 'cors';
import { env } from '../config/env.js';
import { healthRouter } from './routes/health.routes.js';
import { candidatesRouter } from './routes/candidates.routes.js';
import { crossingsRouter } from './routes/crossings.routes.js';
import { assistantRouter } from './routes/assistant.routes.js';
import { syncRouter } from './routes/sync.routes.js';
import { errorMiddleware } from './middleware/errorMiddleware.js';

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.corsOrigins.length ? env.corsOrigins : true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', healthRouter);
  app.use('/api/candidates', candidatesRouter);
  app.use('/api/crossings', crossingsRouter);
  app.use('/api/assistant', assistantRouter);
  app.use('/api/sync', syncRouter);

  app.use(errorMiddleware);

  return app;
}
