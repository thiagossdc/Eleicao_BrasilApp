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

export const candidatesRouter = Router();

candidatesRouter.get('/', (req, res, next) => {
  try {
    const nomeOuUrna = parseOptionalString(req.query.q);
    const uf = parseOptionalString(req.query.uf);
    const cargo = parseOptionalString(req.query.cargo);
    const partido = parseOptionalString(req.query.partido);
    const ano = parseOptionalInt(req.query.ano, 'ano');
    const onlyRisk = parseBooleanQuery(req.query.onlyRisk, false);
    const { limit, offset } = parsePagination(req.query);

    const filters = { nomeOuUrna, uf, cargo, partido, ano, onlyRisk, limit, offset };
    const items = listCandidates(filters);
    const total = countCandidates({ nomeOuUrna, uf, cargo, partido, ano, onlyRisk });

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
    const uf = parseOptionalString(req.query.uf);
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
