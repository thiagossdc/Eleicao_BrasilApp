import { HttpError } from '../../errors/httpError.js';

function logServerError(err, req) {
  console.error('[api]', req.method, req.path, err);
}

/**
 * Middleware Express: captura erros e devolve JSON consistente.
 */
export function errorMiddleware(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      ...(err.details && process.env.NODE_ENV !== 'production' ? { details: err.details } : {}),
    });
    return;
  }

  // Erros do body-parser (express.json): sem este tratamento, um POST com JSON
  // malformado virava 500 com a mensagem crua do parser exposta ao cliente.
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Corpo JSON inválido. Envie um JSON válido.' });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Corpo da requisição excede o limite de 1 MB.' });
    return;
  }

  logServerError(err, req);
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Erro interno no servidor.'
      : err.message || 'Erro interno no servidor.';
  res.status(500).json({ error: message });
}
