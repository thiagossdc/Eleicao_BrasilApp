import { Router } from 'express';
import {
  countCandidates,
  findCandidateByKeys,
  listCandidates,
  listCandidateFilters,
  listCassacoesByCandidate,
} from '../../repositories/candidateRead.repository.js';
import { HttpError } from '../../errors/httpError.js';
import {
  parseBooleanQuery,
  parseOptionalInt,
  parseOptionalString,
  parsePagination,
} from '../validators/queryParsers.js';

/** Siglas aceitas em `sg_uf`: 27 UFs + BR (arquivo nacional do TSE). */
const VALID_UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
  'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO', 'BR', 'BRASIL',
]);

export const candidatesRouter = Router();

candidatesRouter.get('/', (req, res, next) => {
  try {
    // `q` é o nome oficial do parâmetro; `nome` é alias aceito para bater com a
    // documentação (README). Sem alias, o filtro era ignorado em silêncio e a
    // API devolvia a base inteira.
    const nomeOuUrna = parseOptionalString(req.query.q ?? req.query.nome);
    const uf = parseOptionalString(req.query.uf)?.toUpperCase();
    if (uf && !VALID_UFS.has(uf)) {
      // Antes: 200 com lista vazia, escondendo erro de digitação no filtro.
      throw new HttpError(400, 'UF inválida. Use uma sigla de UF (ex.: SP) ou BR.');
    }
    // No banco, o arquivo nacional grava 'BR'; aceita 'BRASIL' como alias.
    const ufFiltro = uf === 'BRASIL' ? 'BR' : uf;
    const cargo = parseOptionalString(req.query.cargo);
    const partido = parseOptionalString(req.query.partido);
    const ano = parseOptionalInt(req.query.ano, 'ano');
    const onlyRisk = parseBooleanQuery(req.query.onlyRisk, false);
    const { limit, offset } = parsePagination(req.query);

    const filters = { nomeOuUrna, uf: ufFiltro, cargo, partido, ano, onlyRisk, limit, offset };
    const items = listCandidates(filters);
    const total = countCandidates({ nomeOuUrna, uf: ufFiltro, cargo, partido, ano, onlyRisk });

    res.json({ items, total, limit, offset });
  } catch (e) {
    next(e);
  }
});

candidatesRouter.get('/options', (req, res, next) => {
  try {
    res.json(listCandidateFilters());
  } catch (e) {
    next(e);
  }
});

candidatesRouter.get('/:sqCandidato', (req, res, next) => {
  try {
    const sqCandidato = String(req.params.sqCandidato || '').trim();
    const uf = parseOptionalString(req.query.uf)?.toUpperCase();
    const ano = parseOptionalInt(req.query.ano, 'ano');

    if (!sqCandidato || !uf || ano == null) {
      throw new HttpError(400, 'Informe sqCandidato na URL e query params: uf e ano.');
    }

    const candidate = findCandidateByKeys({ sqCandidato, uf, ano });
    if (!candidate) {
      throw new HttpError(404, 'Candidato não encontrado para os parâmetros informados.');
    }

    const cassacoes = listCassacoesByCandidate({ sqCandidato, uf, ano });
    res.json({ candidate, cassacoes });
  } catch (e) {
    next(e);
  }
});
