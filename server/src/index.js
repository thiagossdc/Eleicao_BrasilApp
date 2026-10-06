/** Inicializa SQLite e schema antes de qualquer repositório. */
import './db.js';

import { createApp } from './http/createApp.js';
import { env } from './config/env.js';

const app = createApp();

app.listen(env.port, () => {
  console.log(`API Eleição Limpa - Brasil ouvindo em http://localhost:${env.port}`);
});
