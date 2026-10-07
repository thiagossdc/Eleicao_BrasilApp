import { Router } from 'express';
import { syncFromTse } from '../../services/tseSync.service.js';
import { HttpError } from '../../errors/httpError.js';
import { env } from '../../config/env.js';

export const syncRouter = Router();

/**
 * Limite por IP/janela: a importação baixa pacotes inteiros do TSE no servidor,
 * então sem limite qualquer pessoa poderia disparar downloads pesados.
 * Janela curta e poucas tentativas porque a operação é manual e demorada.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_SYNC_PER_WINDOW = 5;
const syncCounts = new Map();

function checkSyncRateLimit(clientId) {
  const now = Date.now();
  const current = syncCounts.get(clientId);
  if (!current || current.resetAt <= now) {
    syncCounts.set(clientId, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  if (current.count >= MAX_SYNC_PER_WINDOW) {
    throw new HttpError(429, 'Limite de sincronizações atingido: aguarde 15 minutos.');
  }
  current.count += 1;
}

/** Exige o token quando SYNC_TOKEN está configurado. */
function assertAuthorized(req) {
  if (!env.syncToken) return;
  const header = String(req.get('authorization') || '');
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const token = bearer || String(req.get('x-sync-token') || '').trim();
  if (token !== env.syncToken) {
    throw new HttpError(401, 'Token de sincronização ausente ou inválido.');
  }
}

syncRouter.post('/', async (req, res, next) => {
  try {
    assertAuthorized(req);
    checkSyncRateLimit(req.ip || req.socket?.remoteAddress || 'desconhecido');
    const { ano, uf } = req.body || {};
    if (ano == null || uf == null) {
      throw new HttpError(400, 'Corpo JSON obrigatório: { "ano": number, "uf": string }.');
    }
    const result = await syncFromTse({ ano, uf });
    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
});
