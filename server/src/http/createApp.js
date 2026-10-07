import express from 'express';
import cors from 'cors';
import { env } from '../config/env.js';
import { healthRouter } from './routes/health.routes.js';
import { candidatesRouter } from './routes/candidates.routes.js';
import { crossingsRouter } from './routes/crossings.routes.js';
import { assistantRouter } from './routes/assistant.routes.js';
import { syncRouter } from './routes/sync.routes.js';
import { errorMiddleware } from './middleware/errorMiddleware.js';
import { jsonGzip } from './middleware/jsonGzip.js';

export function createApp() {
  const app = express();

  // Não anunciar o framework em headers de resposta.
  app.disable('x-powered-by');

  // Atrás do proxy da Vercel, req.ip só é confiável com trust proxy habilitado
  // (usado no rate limit do tira-dúvidas e da sincronização).
  if (process.env.VERCEL) app.set('trust proxy', 1);

  app.use(
    cors({
      origin: env.corsOrigins.length ? env.corsOrigins : true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Sync-Token'],
    }),
  );
  app.use(jsonGzip);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', healthRouter);
  app.use('/api/candidates', candidatesRouter);
  app.use('/api/crossings', crossingsRouter);
  app.use('/api/assistant', assistantRouter);
  app.use('/api/sync', syncRouter);

  // Rota inexistente responde JSON (o padrão do Express devolve HTML).
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
  });

  app.use(errorMiddleware);

  return app;
}
