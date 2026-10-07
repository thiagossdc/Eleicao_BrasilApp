import { Router } from 'express';
import { getCrossingCandidates, getCrossingCatalog, getCrossingResults, getMunicipalMap, getPartyCrossingResults } from '../../services/crossing.service.js';
import { HttpError } from '../../errors/httpError.js';
import { parseOptionalInt, parseOptionalString } from '../validators/queryParsers.js';

export const crossingsRouter = Router();

function parseScope(query) {
  // Sem trava: ano/UF ausentes caem nos padrões (2022 / Brasil inteiro) em vez de barrar a requisição.
  const ano = parseOptionalInt(query.ano, 'ano') ?? 2022;
  const uf = (parseOptionalString(query.uf) ?? 'BRASIL').toUpperCase();
  return { ano, uf };
}

crossingsRouter.get('/options', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.json(await getCrossingCatalog(parseScope(req.query)));
  } catch (error) {
    next(error);
  }
});

crossingsRouter.get('/candidates', async (req, res, next) => {
  try {
    const scope = parseScope(req.query);
    const cargo = parseOptionalString(req.query.cargo);
    const turno = parseOptionalInt(req.query.turno, 'turno');
    const partido = parseOptionalString(req.query.partido);
    const busca = parseOptionalString(req.query.busca);
    // Cargo/turno são opcionais: o serviço aplica o primeiro disponível do catálogo.
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(await getCrossingCandidates({ ...scope, cargo, turno, partido, busca }));
  } catch (error) {
    next(error);
  }
});

crossingsRouter.get('/map/:uf', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.json(await getMunicipalMap(req.params.uf));
  } catch (error) {
    next(error);
  }
});

function parseAnalysisQuery(query, targetType) {
  const { ano, uf } = parseScope(query);
  const cargo = parseOptionalString(query.cargo);
  const turno = parseOptionalInt(query.turno, 'turno');
  const target = parseOptionalString(targetType === 'partido' ? query.partido : query.candidato);
  const indicador = parseOptionalString(query.indicador);

  // Único bloqueio real: a análise precisa de um alvo (candidato ou partido).
  // Cargo, turno e indicador são opcionais e recebem padrão no serviço.
  if (!target) {
    throw new HttpError(400, targetType === 'partido'
      ? 'Informe o partido para montar a análise.'
      : 'Informe o candidato para montar a análise.');
  }
  return {
    ano,
    uf,
    cargo,
    turno,
    indicador,
    ...(targetType === 'partido' ? { partido: target } : { sqCandidato: target }),
  };
}

crossingsRouter.get('/party', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.json(await getPartyCrossingResults(parseAnalysisQuery(req.query, 'partido')));
  } catch (error) {
    next(error);
  }
});

crossingsRouter.get('/', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
    res.json(await getCrossingResults(parseAnalysisQuery(req.query, 'candidato')));
  } catch (error) {
    next(error);
  }
});