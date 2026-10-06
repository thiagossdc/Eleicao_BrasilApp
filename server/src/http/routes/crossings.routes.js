import { Router } from 'express';
import { getCrossingCandidates, getCrossingCatalog, getCrossingResults, getMunicipalMap, getPartyCrossingResults } from '../../services/crossing.service.js';
import { HttpError } from '../../errors/httpError.js';
import { parseOptionalInt, parseOptionalString } from '../validators/queryParsers.js';

export const crossingsRouter = Router();

function parseScope(query) {
  const ano = parseOptionalInt(query.ano, 'ano');
  const uf = parseOptionalString(query.uf)?.toUpperCase();
  if (ano == null || !uf) {
    throw new HttpError(400, 'Informe ano e uf para carregar dados eleitorais.');
  }
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
    if (!cargo || turno == null) {
      throw new HttpError(400, 'Informe cargo e turno para buscar candidatos.');
    }
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

  if (!cargo || turno == null || !target || !indicador) {
    const targetLabel = targetType === 'partido' ? 'partido' : 'candidato';
    throw new HttpError(400, `Informe cargo, turno, ${targetLabel} e indicador.`);
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