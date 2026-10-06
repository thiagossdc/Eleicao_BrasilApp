import { createApp } from '../server/src/http/createApp.js';

/**
 * Entrypoint da Vercel Function: reexporta o app Express montado em /api/*.
 * O catch-all `[[...path]]` recebe o path original (ex.: /api/candidates?limit=10),
 * então os routers do Express funcionam sem ajuste.
 */
export default createApp();
