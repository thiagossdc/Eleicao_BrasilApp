import { Router } from 'express';
import { syncFromTse } from '../../services/tseSync.service.js';
import { HttpError } from '../../errors/httpError.js';

export const syncRouter = Router();

syncRouter.post('/', async (req, res, next) => {
  try {
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
