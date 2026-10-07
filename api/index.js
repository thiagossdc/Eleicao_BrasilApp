import { createApp } from '../server/src/http/createApp.js';

/**
 * Entrypoint da Vercel Function para /api/* (rota explícita).
 * Usado em conjunto com o rewrite `/api/(.*)` -> `/api/index` do vercel.json.
 * A URL original (ex.: /api/candidates?limit=10) é preservada para o Express,
 * então os routers montados em /api/* funcionam sem ajuste.
 */
export default createApp();

