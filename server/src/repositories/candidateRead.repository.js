import { db } from '../db.js';

const EXISTS_CASSACAO = `EXISTS (
  SELECT 1 FROM cassacoes ca
  WHERE ca.ano_eleicao = c.ano_eleicao
    AND ca.sg_uf = c.sg_uf
    AND ca.sq_candidato = c.sq_candidato
)`;

/**
 * Monta cláusula WHERE e parâmetros para busca de candidatos.
 * @param {{ nomeOuUrna?: string, uf?: string, ano?: number, onlyRisk?: boolean }} filters
 */
function buildSearchFilters(filters) {
  const parts = [];
  const params = [];

  if (filters.ano != null && Number.isFinite(filters.ano)) {
    parts.push('c.ano_eleicao = ?');
    params.push(filters.ano);
  }

  if (filters.uf) {
    parts.push('c.sg_uf = ?');
    params.push(filters.uf.toUpperCase());
  }

  if (filters.cargo) {
    parts.push('c.ds_cargo = ?');
    params.push(filters.cargo.toUpperCase());
  }

  if (filters.partido) {
    parts.push('c.sg_partido = ?');
    params.push(filters.partido.toUpperCase());
  }

  const term = filters.nomeOuUrna?.trim();
  if (term) {
    const pattern = `%${term.toLowerCase()}%`;
    parts.push(
      '(LOWER(c.nm_candidato) LIKE ? OR LOWER(IFNULL(c.nm_urna, \'\')) LIKE ?)',
    );
    params.push(pattern, pattern);
  }

  if (filters.onlyRisk) {
    parts.push(
      `(${EXISTS_CASSACAO} OR UPPER(IFNULL(c.ds_situacao, '')) LIKE '%CASS%')`,
    );
  }

  const whereClause = parts.length ? parts.join(' AND ') : '1=1';
  return { whereClause, params };
}

const baseSelect = `
  SELECT
    c.id,
    c.ano_eleicao AS anoEleicao,
    c.sg_uf AS uf,
    c.sq_candidato AS sqCandidato,
    c.nm_candidato AS nome,
    c.nm_urna AS nomeUrna,
    c.ds_cargo AS cargo,
    c.sg_partido AS partido,
    c.nm_partido AS nomePartido,
    c.ds_situacao AS situacao,
    c.ds_eleicao AS eleicao,
    (${EXISTS_CASSACAO}) AS temCassacao
  FROM candidates c
`;

/**
 * @param {{ nomeOuUrna?: string, uf?: string, ano?: number, onlyRisk?: boolean, limit: number, offset: number }} opts
 */
export function listCandidates(opts) {
  const { whereClause, params } = buildSearchFilters(opts);
  const sql = `${baseSelect} WHERE ${whereClause} ORDER BY c.nm_candidato COLLATE NOCASE LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(...params, opts.limit, opts.offset);
}

/**
 * @param {{ nomeOuUrna?: string, uf?: string, ano?: number, onlyRisk?: boolean }} filters
 */
export function listCandidateFilters() {
  const cargosRows = db
    .prepare(`SELECT DISTINCT ds_cargo AS cargo FROM candidates WHERE ds_cargo IS NOT NULL AND ds_cargo <> '' ORDER BY cargo`)
    .all();
  const cargos = cargosRows.map((row) => row.cargo);

  const partidosRows = db
    .prepare(`SELECT DISTINCT sg_partido AS sigla, nm_partido AS nome FROM candidates WHERE sg_partido IS NOT NULL AND sg_partido <> '' ORDER BY nm_partido, sigla`)
    .all();
  const partidos = partidosRows.map((row) => ({ sigla: row.sigla, nome: row.nome }));

  return { cargos, partidos };
}

export function countCandidates(filters) {
  const { whereClause, params } = buildSearchFilters(filters);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM candidates c WHERE ${whereClause}`).get(...params);
  return row?.n ?? 0;
}

/**
 * @param {{ sqCandidato: string, ano: number, uf: string }} keys
 */
export function findCandidateByKeys({ sqCandidato, ano, uf }) {
  const sql = `${baseSelect} WHERE c.sq_candidato = ? AND c.ano_eleicao = ? AND c.sg_uf = ?`;
  return db.prepare(sql).get(sqCandidato, ano, uf.toUpperCase());
}

/**
 * @param {{ sqCandidato: string, ano: number, uf: string }} keys
 */
export function listCassacoesByCandidate(keys) {
  return db
    .prepare(
      `SELECT nr_processo AS nrProcesso, ds_tp_motivo AS tipoMotivo, ds_motivo AS motivo
       FROM cassacoes
       WHERE sq_candidato = ? AND ano_eleicao = ? AND sg_uf = ?
       ORDER BY nr_processo`,
    )
    .all(keys.sqCandidato, keys.ano, keys.uf.toUpperCase());
}

export function getDatasetStats() {
  const c = db.prepare('SELECT COUNT(*) AS n FROM candidates').get();
  const k = db.prepare('SELECT COUNT(*) AS n FROM cassacoes').get();
  return {
    totalCandidatos: c?.n ?? 0,
    totalRegistrosCassacao: k?.n ?? 0,
  };
}
