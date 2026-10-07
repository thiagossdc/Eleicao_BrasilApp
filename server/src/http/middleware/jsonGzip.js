import zlib from 'node:zlib';

/**
 * Comprime respostas JSON grandes em gzip.
 *
 * Sem isso, payloads como /api/crossings/map/BRASIL (3,2 MB) saem inteiros.
 * Só comprime quando o cliente aceita gzip e o corpo passa do limite, evitando
 * overhead em respostas pequenas (health, erros, options).
 */
const MIN_BYTES_TO_COMPRESS = 1024;

export function jsonGzip(req, res, next) {
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  if (!/\bgzip\b/i.test(acceptEncoding) || res.getHeader('Content-Encoding')) {
    next();
    return;
  }



  res.json = (payload) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    if (body.length < MIN_BYTES_TO_COMPRESS || res.getHeader('Content-Encoding')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', String(body.length));
      res.end(body);
      return res;
    }

    const compressed = zlib.gzipSync(body, { level: zlib.constants.Z_BEST_COMPRESSION });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('Content-Length', String(compressed.length));
    res.end(compressed);
    return res;
  };

  next();
}
