import { HttpError } from '../../errors/httpError.js';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'sim']);

/**
 * Converte parâmetro de query opcional em inteiro.
 *
 * Regras:
 * - ausente ou vazio → `undefined` (o chamador aplica o padrão dele);
 * - presente mas inválido → 400. Antes o valor era descartado em silêncio e a
 *   requisição seguia com filtro errado (ex.: `?ano=abc` listava todos os anos).
 */
export function parseOptionalInt(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim();
  if (text === '') return undefined;
  if (!/^-?\d+$/.test(text)) {
    throw new HttpError(400, `Parâmetro ${label || 'numérico'} inválido: envie um número inteiro.`);
  }
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n)) {
    throw new HttpError(400, `Parâmetro ${label || 'numérico'} inválido: envie um número inteiro.`);
  }
  return n;
}

export function parseOptionalString(value) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

export function parseBooleanQuery(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return TRUE_VALUES.has(String(value).trim().toLowerCase());
}

export function parsePagination(query, defaults = { limit: 30, max: 100 }) {
  const limitRaw = parseOptionalInt(query.limit, 'limit');
  const offsetRaw = parseOptionalInt(query.offset, 'offset');

  let limit = limitRaw ?? defaults.limit;
  if (limit < 1) limit = defaults.limit;
  if (limit > defaults.max) limit = defaults.max;

  let offset = offsetRaw ?? 0;
  if (offset < 0) offset = 0;

  return { limit, offset };
}
