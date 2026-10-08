import { PassThrough, Readable } from 'node:stream';
import { parse } from 'csv-parse';
import unzipper from 'unzipper';
import { HttpError } from '../errors/httpError.js';
import { TSE_ELECTION_YEAR, votingCsvEntryName, zipUrlVotingCandidates } from '../constants/tse.js';

const IBGE_API = 'https://servicodados.ibge.gov.br/api';
const VALID_UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB',
  'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);
const VALID_YEARS = new Set([2016, 2018, 2020, 2022, 2024, 2026]);
const INDICATORS = {
  populacao: { nome: 'População residente', grupo: 'Demografia', agregado: 4714, variavel: 93, periodo: '2022', unidade: 'Pessoas' },
  densidade: { nome: 'Densidade demográfica', grupo: 'Demografia', agregado: 4714, variavel: 614, periodo: '2022', unidade: 'hab./km²' },
  pib: { nome: 'PIB municipal', grupo: 'Economia', agregado: 5938, variavel: 37, periodo: 'último disponível', unidade: 'Mil R$' },
  idadeMediana: { nome: 'Idade mediana', grupo: 'Demografia', agregado: 9515, variavel: 10613, periodo: '2022', unidade: 'Anos' },
  indiceEnvelhecimento: { nome: 'Índice de envelhecimento', grupo: 'Demografia', agregado: 9515, variavel: 10612, periodo: '2022', unidade: 'Razão' },
  razaoSexo: { nome: 'Razão de sexo', grupo: 'Demografia', agregado: 9515, variavel: 8845, periodo: '2022', unidade: 'Homens por 100 mulheres' },
  percentualUrbano: { nome: 'População em área urbana', grupo: 'Demografia', agregado: 9923, variavel: 1000093, periodo: '2022', unidade: '%' },
  alfabetizacao: { nome: 'Taxa de alfabetização (15 anos ou mais)', grupo: 'Educação', agregado: 10091, variavel: 2513, periodo: '2022', unidade: '%' },
  superiorCompleto: { nome: 'Superior completo (18 anos ou mais)', grupo: 'Educação', agregado: 10061, variavel: 2667, periodo: '2022', unidade: '%' },
  aguaRede: { nome: 'Domicílios com abastecimento pela rede geral', grupo: 'Infraestrutura', agregado: 6803, variavel: 1000381, periodo: '2022', unidade: '%' },
  esgotamentoAdequado: { nome: 'Domicílios com rede/fossa ligada à rede', grupo: 'Infraestrutura', agregado: 6805, variavel: 1000381, periodo: '2022', unidade: '%' },
  coletaLixo: { nome: 'Domicílios com lixo coletado', grupo: 'Infraestrutura', agregado: 6892, variavel: 1000381, periodo: '2022', unidade: '%' },
};
const INDICATOR_NOTES = {
  percentualUrbano: 'Percentual da população residente em situação urbana no Censo 2022.',
  superiorCompleto: 'Percentual calculado: pessoas de 18 anos ou mais com superior completo ÷ total de pessoas de 18 anos ou mais.',
  aguaRede: 'Percentual de domicílios ocupados que possuem ligação à rede geral e a utilizam como principal forma de abastecimento.',
  esgotamentoAdequado: 'Percentual de domicílios com rede geral/pluvial ou fossa séptica ligada à rede.',
  coletaLixo: 'Percentual de domicílios cujo lixo é coletado por serviço de limpeza ou depositado em caçamba.',
};
const IBGE_INDICATOR_REQUESTS = [
  { url: '/v3/agregados/4714/periodos/2022/variaveis/93|614?localidades=N6%5Ball%5D', keys: ['populacao', 'densidade'] },
  { url: '/v3/agregados/5938/periodos/-1/variaveis/37?localidades=N6%5Ball%5D', keys: ['pib'] },
  { url: '/v3/agregados/9515/periodos/2022/variaveis/10612|10613|8845?localidades=N6%5Ball%5D', keys: ['indiceEnvelhecimento', 'idadeMediana', 'razaoSexo'] },
  { url: '/v3/agregados/9923/periodos/2022/variaveis/1000093?localidades=N6%5Ball%5D&classificacao=1%5B1%5D', keys: ['percentualUrbano'] },
  { url: '/v3/agregados/10091/periodos/2022/variaveis/2513?localidades=N6%5Ball%5D&classificacao=2%5B6794%5D%7C58%5B95253%5D%7C2661%5B32776%5D%7C1%5B6795%5D', keys: ['alfabetizacao'] },
  { url: '/v3/agregados/10061/periodos/2022/variaveis/2667?localidades=N6%5Ball%5D&classificacao=1568%5B120704%2C99713%5D%7C58%5B95253%5D%7C2%5B6794%5D%7C86%5B95251%5D', keys: ['superiorCompleto'] },
  { url: '/v3/agregados/6803/periodos/2022/variaveis/1000381?localidades=N6%5Ball%5D&classificacao=1821%5B72144%5D', keys: ['aguaRede'] },
  { url: '/v3/agregados/6805/periodos/2022/variaveis/1000381?localidades=N6%5Ball%5D&classificacao=11558%5B46290%5D', keys: ['esgotamentoAdequado'] },
  { url: '/v3/agregados/6892/periodos/2022/variaveis/1000381?localidades=N6%5Ball%5D&classificacao=67%5B2520%5D', keys: ['coletaLixo'] },
];
const VOTING_COLUMNS = new Set([
  'SG_UF', 'DS_CARGO', 'NR_TURNO', 'SQ_CANDIDATO', 'NM_MUNICIPIO', 'QT_VOTOS_NOMINAIS',
  'NM_URNA_CANDIDATO', 'NM_CANDIDATO', 'SG_PARTIDO',
]);

/**
 * Nomes dos CSVs de votação a ler no pacote oficial do TSE.
 * UF única -> 1 arquivo; BRASIL -> arquivo nacional único (_BR.csv), que traz
 * a apuração presidencial consolidada. Ler os 27 CSVs por UF estourava o heap
 * (~4GB) e o timeout da serverless, então o modo nacional fica restrito a
 * Presidente. Exportada para teste unitário.
 */
export function votingCsvEntryNames(ano, uf) {
  if (uf === 'BRASIL') return [votingCsvEntryName(ano, 'BR')];
  return [votingCsvEntryName(ano, uf)];
}
const CACHE_TTL = 6 * 60 * 60 * 1000;
const TSE_RANGE_TIMEOUT_MS = 10 * 60 * 1000;
const catalogCache = new Map();
const catalogRequests = new Map();
const mapCache = new Map();
let municipalitiesCache;
let indicatorsCache;
let indicatorsRequest;

const normalizeName = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

function assertScope({ ano, uf }) {
  const year = Number(ano);
  const requestedUf = String(uf ?? '').trim().toUpperCase();
  const state = ['BR', 'BRASIL'].includes(requestedUf) ? 'BRASIL' : requestedUf;
  if (!VALID_YEARS.has(year) || year < TSE_ELECTION_YEAR.min || year > TSE_ELECTION_YEAR.max) {
    throw new HttpError(400, 'Ano inválido. Selecione uma eleição disponível entre 2016 e 2026.');
  }
  if (state !== 'BRASIL' && !VALID_UFS.has(state)) throw new HttpError(400, 'Informe uma UF brasileira ou BRASIL.');
  return { ano: year, uf: state };
}

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new HttpError(502, 'Não foi possível consultar uma fonte pública de dados.', { url, cause: error.message });
  }
  if (!response.ok) {
    throw new HttpError(502, 'A fonte pública retornou erro ao consultar os dados.', { url, status: response.status });
  }
  return response.json();
}

async function openVotingArchive(url) {
  let response;
  try {
    response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new HttpError(502, 'Não foi possível consultar o pacote oficial do TSE.', { url, cause: error.message });
  }
  if (!response.ok) {
    throw new HttpError(502, 'O TSE não disponibilizou o arquivo de votação para esta eleição.', {
      url,
      status: response.status,
    });
  }
  const size = Number(response.headers.get('content-length'));
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new HttpError(502, 'O TSE não informou o tamanho do arquivo de votação.', { url });
  }

  const source = {
    size: async () => size,
    stream: (offset, length) => {
      const output = new PassThrough();
      const end = length ? offset + length - 1 : '';
      fetch(url, {
        headers: { Range: `bytes=${offset}-${end}` },
        signal: AbortSignal.timeout(TSE_RANGE_TIMEOUT_MS),
      })
        .then((rangeResponse) => {
          if (rangeResponse.status !== 206 || !rangeResponse.body) {
            throw new Error(`A fonte TSE não aceitou a faixa solicitada (${rangeResponse.status}).`);
          }
          Readable.fromWeb(rangeResponse.body).pipe(output);
        })
        .catch(() => output.end());
      return output;
    },
  };
  try {
    return await unzipper.Open.custom(source);
  } catch (error) {
    throw new HttpError(502, 'Não foi possível abrir o pacote oficial de votação do TSE.', { url, cause: error.message });
  }
}

async function streamVotingCsv(url, entryNames, onRow) {
  const archive = await openVotingArchive(url);
  const names = Array.isArray(entryNames) ? entryNames : [entryNames];
  const entries = names.map((name) => archive.files.find((file) => file.path === name)).filter(Boolean);

  if (!entries.length) {
    // Pedido de arquivo único nacional (_BR.csv): só existe quando o TSE publica
    // apuração presidencial consolidada (ex.: 2022). Anos sem esse arquivo caem aqui.
    if (names.length === 1 && names[0].endsWith('_BR.csv')) {
      throw new HttpError(404, 'O TSE ainda não publicou resultados presidenciais nacionais para esta eleição.', { url });
    }
    // Pedido agregado (BRASIL = 27 arquivos por UF): nenhum CSV de votação no pacote.
    if (names.length > 1) {
      throw new HttpError(404, 'O TSE ainda não publicou dados de votação para esta eleição.', { url });
    }
    throw new HttpError(502, 'Nenhum arquivo de votação foi encontrado no pacote do TSE.', { url });
  }

  for (const entry of entries) {
    const csvStream = entry.stream();
    const parser = parse({
      columns: (header) => header.map((name) => VOTING_COLUMNS.has(name) ? name : false),
      delimiter: ';',
      encoding: 'latin1',
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
    });
    csvStream.on('error', (error) => parser.destroy(error));
    const rows = csvStream.pipe(parser);
    try {
      for await (const row of rows) onRow(row);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Não foi possível ler o arquivo oficial de votação do TSE.', { cause: error.message });
    }
  }
}

function municipalityUf(municipality) {
  return (
    municipality.microrregiao?.mesorregiao?.UF?.sigla ??
    municipality['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla ??
    ''
  );
}

async function getMunicipalityIndex() {
  if (municipalitiesCache && municipalitiesCache.expiresAt > Date.now()) return municipalitiesCache.value;
  const data = await fetchJson(`${IBGE_API}/v1/localidades/municipios`);
  const index = new Map();
  for (const municipality of data) {
    const uf = municipalityUf(municipality);
    if (uf) index.set(`${uf}|${normalizeName(municipality.nome)}`, { id: String(municipality.id), nome: municipality.nome, uf });
  }
  municipalitiesCache = { value: index, expiresAt: Date.now() + CACHE_TTL };
  return index;
}

async function getIndicators() {
  if (indicatorsCache && indicatorsCache.expiresAt > Date.now()) return indicatorsCache.value;
  if (indicatorsRequest) return indicatorsRequest;
  indicatorsRequest = loadIndicators();
  try {
    return await indicatorsRequest;
  } finally {
    indicatorsRequest = undefined;
  }
}

async function loadIndicators() {
  const payloads = await Promise.all(
    IBGE_INDICATOR_REQUESTS.map(({ url }) => fetchJson(`${IBGE_API}${url}`)),
  );
  const values = {};
  const metadata = {};

  const addSeries = (key, result, seriesResult = result?.resultados?.[0]) => {
    const definition = INDICATORS[key];
    const series = seriesResult?.series;
    if (!series) throw new HttpError(502, `O IBGE não retornou o indicador ${definition.nome}.`);
    const period = Object.keys(series[0]?.serie ?? {}).at(-1) ?? definition.periodo;
    values[key] = {};
    for (const row of series) {
      const value = Number(String(row.serie[period] ?? '').replace(',', '.'));
      if (Number.isFinite(value)) values[key][row.localidade.id] = value;
    }
    metadata[key] = {
      nome: definition.nome,
      grupo: definition.grupo,
      variavel: result.variavel,
      periodo: period,
      unidade: definition.unidade ?? result.unidade,
      agregado: definition.agregado,
      ...(INDICATOR_NOTES[key] ? { nota: INDICATOR_NOTES[key] } : {}),
    };
  };

  for (const [index, request] of IBGE_INDICATOR_REQUESTS.entries()) {
    const payload = payloads[index];
    if (!Array.isArray(payload) || !payload.length) {
      throw new HttpError(502, 'O IBGE retornou um catálogo de indicadores inesperado.');
    }
    for (const [resultIndex, key] of request.keys.entries()) {
      if (key === 'superiorCompleto') {
        const educationResults = payload[0]?.resultados ?? [];
        const categoryResult = (categoryId) => educationResults.find((item) =>
          item.classificacoes?.some((classification) =>
            classification.id === '1568' && Object.hasOwn(classification.categoria ?? {}, categoryId),
          ),
        );
        const total = categoryResult('120704');
        const complete = categoryResult('99713');
        if (!total?.series || !complete?.series) {
          throw new HttpError(502, 'O IBGE não retornou a composição municipal por nível de instrução.');
        }
        const totalByMunicipality = new Map(total.series.map((row) => [row.localidade.id, Number(row.serie['2022'])]));
        const series = complete.series.flatMap((row) => {
          const denominator = totalByMunicipality.get(row.localidade.id);
          const numerator = Number(row.serie['2022']);
          return denominator > 0 && Number.isFinite(numerator)
            ? [{ ...row, serie: { 2022: String((100 * numerator) / denominator) } }]
            : [];
        });
        addSeries(key, payload[0], { series });
        continue;
      }
      const result = payload[resultIndex];
      if (!result) throw new HttpError(502, `O IBGE não retornou o indicador ${INDICATORS[key].nome}.`);
      addSeries(key, result);
    }
  }

  values.pibPerCapita = {};
  for (const [municipalityId, pib] of Object.entries(values.pib)) {
    const population = values.populacao[municipalityId];
    if (population > 0) values.pibPerCapita[municipalityId] = (pib * 1000) / population;
  }
  metadata.pibPerCapita = {
    nome: 'PIB per capita (calculado)',
    grupo: 'Economia',
    variavel: 'PIB municipal × 1.000 ÷ população residente',
    periodo: `${metadata.pib.periodo} / 2022`,
    unidade: 'R$',
    agregado: 'calculado',
    nota: 'PIB do último período disponível dividido pela população do Censo 2022.',
  };

  indicatorsCache = { value: { values, metadata }, expiresAt: Date.now() + CACHE_TTL };
  return indicatorsCache.value;
}

async function getVoteCatalog(scope) {
  const { ano, uf } = assertScope(scope);
  const key = `${ano}|${uf}`;
  const cached = catalogCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = catalogRequests.get(key);
  if (pending) return pending;

  const request = loadVoteCatalog({ ano, uf }, key);
  catalogRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (catalogRequests.get(key) === request) catalogRequests.delete(key);
  }
}

async function loadVoteCatalog({ ano, uf }, key) {
  const source = zipUrlVotingCandidates(ano);
  // Modo BRASIL: lê o arquivo nacional único (_BR.csv) com a apuração
  // presidencial consolidada. Agregar os 27 CSVs por UF estourava o heap e o
  // timeout da serverless, então o modo nacional fica restrito a Presidente.
  const entryNames = votingCsvEntryNames(ano, uf);

  const aggregates = new Map();
  const candidates = new Map();
  const cargos = new Set();
  const turnos = new Set();

  await streamVotingCsv(source, entryNames, (row) => {
    const cargo = String(row.DS_CARGO ?? '').trim();
    if (uf === 'BRASIL' && !cargo.toLocaleLowerCase('pt-BR').includes('presidente')) return;
    const turno = Number(row.NR_TURNO);
    const sqCandidato = String(row.SQ_CANDIDATO ?? '').trim();
    const municipio = String(row.NM_MUNICIPIO ?? '').trim();
    const votos = Number(String(row.QT_VOTOS_NOMINAIS ?? '').replace(',', '.'));
    if (!cargo || !Number.isInteger(turno) || !sqCandidato || !municipio || !Number.isFinite(votos)) return;

    const rowUf = String(row.SG_UF ?? uf).trim().toUpperCase();
    if (!VALID_UFS.has(rowUf)) return;
    const municipioKey = `${rowUf}|${normalizeName(municipio)}`;
    const aggregateKey = `${cargo}|${turno}|${municipioKey}|${sqCandidato}`;
    const existing = aggregates.get(aggregateKey);
    if (existing) existing.votos += votos;
    else {
      aggregates.set(aggregateKey, {
        cargo,
        turno,
        municipioKey,
        municipio,
        sqCandidato,
        nome: String(row.NM_URNA_CANDIDATO ?? row.NM_CANDIDATO ?? '').trim(),
        partido: String(row.SG_PARTIDO ?? '').trim(),
        votos,
      });
    }

    const candidateKey = `${cargo}|${turno}|${sqCandidato}`;
    if (!candidates.has(candidateKey)) {
      candidates.set(candidateKey, {
        cargo,
        turno,
        sqCandidato,
        nome: String(row.NM_URNA_CANDIDATO ?? row.NM_CANDIDATO ?? '').trim(),
        partido: String(row.SG_PARTIDO ?? '').trim(),
      });
    }
    cargos.add(cargo);
    turnos.add(turno);
  });

  if (!aggregates.size) {
    if (uf === 'BRASIL') {
      throw new HttpError(404, `O pacote do TSE para ${ano} ainda não contém resultados presidenciais nacionais.`);
    }
    throw new HttpError(502, 'O arquivo do TSE não contém resultados de votação reconhecíveis.');
  }
  const candidateVotes = new Map();
  for (const row of aggregates.values()) {
    const key = `${row.cargo}|${row.turno}|${row.sqCandidato}`;
    candidateVotes.set(key, (candidateVotes.get(key) ?? 0) + row.votos);
  }
  const rankedCandidates = [...candidates.entries()]
    .sort(([leftKey, left], [rightKey, right]) =>
      (candidateVotes.get(rightKey) ?? 0) - (candidateVotes.get(leftKey) ?? 0) ||
      left.nome.localeCompare(right.nome, 'pt-BR'),
    )
    .map(([candidateKey, candidate]) => ({
      ...candidate,
      votos: candidateVotes.get(candidateKey) ?? 0,
    }));
  const parties = new Map();
  for (const candidate of rankedCandidates) {
    if (!candidate.partido) continue;
    const partyKey = `${candidate.cargo}|${candidate.turno}|${candidate.partido}`;
    const party = parties.get(partyKey) ?? {
      sigla: candidate.partido,
      cargo: candidate.cargo,
      turno: candidate.turno,
      candidatos: 0,
      votos: 0,
    };
    party.candidatos += 1;
    party.votos += candidate.votos;
    parties.set(partyKey, party);
  }
  const value = {
    rows: [...aggregates.values()],
    candidatos: rankedCandidates,
    partidos: [...parties.values()].sort(
      (left, right) => right.votos - left.votos || left.sigla.localeCompare(right.sigla, 'pt-BR'),
    ),
    cargos: [...cargos].sort((left, right) => left.localeCompare(right, 'pt-BR')),
    turnos: [...turnos].sort((left, right) => left - right),
    fonte: source,
  };
  catalogCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL });
  return value;
}

export async function getCrossingCatalog(scope) {
  const normalized = assertScope(scope);
  const catalog = await getVoteCatalog(normalized);
  return {
    ano: normalized.ano,
    uf: normalized.uf,
    cargos: catalog.cargos,
    turnos: catalog.turnos,
    partidos: catalog.partidos,
    fontes: { tse: catalog.fonte, ibge: 'https://servicodados.ibge.gov.br/api' },
  };
}

export async function getCrossingCandidates({ ano, uf, cargo, turno, partido, busca }) {
  const scope = assertScope({ ano, uf });
  const catalog = await getVoteCatalog(scope);
  // Sem trava: cargo/turno ausentes usam o primeiro disponível do catálogo em vez de barrar (400).
  const office = cargo || catalog.cargos[0] || '';
  const round = turno == null || !Number.isFinite(Number(turno))
    ? (catalog.turnos[0] ?? null)
    : Number(turno);
  const normalizedQuery = normalizeName(busca);
  const candidates = catalog.candidatos.filter((candidate) =>
    candidate.cargo === office &&
    (round == null || candidate.turno === round) &&
    (!partido || candidate.partido === partido) &&
    (!normalizedQuery || normalizeName(`${candidate.nome} ${candidate.partido}`).includes(normalizedQuery)),
  );
  const limit = 100;
  return {
    items: candidates.slice(0, limit),
    total: candidates.length,
    limit,
  };
}

export async function getMunicipalMap(uf) {
  const requestedUf = String(uf ?? '').trim().toUpperCase();
  const national = ['BR', 'BRASIL'].includes(requestedUf);
  const state = national ? 'BRASIL' : requestedUf;
  if (!national && !VALID_UFS.has(state)) throw new HttpError(400, 'Informe uma UF brasileira ou BRASIL.');
  const cached = mapCache.get(state);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const params = new URLSearchParams({
    formato: 'application/vnd.geo+json',
    qualidade: 'minima',
    intrarregiao: 'municipio',
  });
  const endpoint = national ? `${IBGE_API}/v3/malhas/paises/BR` : `${IBGE_API}/v3/malhas/estados/${state}`;
  const featureCollection = await fetchJson(`${endpoint}?${params}`);
  if (featureCollection?.type !== 'FeatureCollection' || !Array.isArray(featureCollection.features)) {
    throw new HttpError(502, 'A malha municipal do IBGE retornou um formato inesperado.');
  }
  mapCache.set(state, { value: featureCollection, expiresAt: Date.now() + 24 * CACHE_TTL });
  return featureCollection;
}

async function buildCrossingResults(input, targetType) {
  const scope = assertScope(input);
  const catalog = await getVoteCatalog(scope);
  // Sem trava: cargo, turno e indicador ausentes/inválidos caem no padrão em vez de barrar (400).
  const office = input.cargo || catalog.cargos[0] || '';
  const round = input.turno == null || !Number.isFinite(Number(input.turno))
    ? (catalog.turnos[0] ?? null)
    : Number(input.turno);
  const indicator = INDICATORS[input.indicador] || input.indicador === 'pibPerCapita'
    ? input.indicador
    : 'populacao';
  const indicatorKeys = [...Object.keys(INDICATORS), 'pibPerCapita'];
  if (!indicatorKeys.includes(indicator)) {
    throw new HttpError(400, 'Indicador IBGE inválido.');
  }
  const municipalitiesPromise = getMunicipalityIndex();
  const indicatorsPromise = getIndicators();
  const [municipalities, indicators] = await Promise.all([municipalitiesPromise, indicatorsPromise]);
  const municipalityById = new Map([...municipalities.values()].map((municipality) => [municipality.id, municipality]));
  const candidateRows = catalog.rows.filter(
    (row) => row.cargo === office && (round == null || row.turno === round),
  );
  const municipalTotals = new Map();
  const matchedMunicipalities = new Set();
  const targetCandidates = catalog.candidatos.filter(
    (row) =>
      row.cargo === office &&
      (round == null || row.turno === round) &&
      (targetType === 'candidato'
        ? row.sqCandidato === String(input.sqCandidato)
        : row.partido === String(input.partido)),
  );
  if (!targetCandidates.length) {
    throw new HttpError(404, targetType === 'partido'
      ? 'Partido não encontrado para o cargo e turno selecionados.'
      : 'Candidato não encontrado para o cargo e turno selecionados.');
  }
  const targetCandidateIds = new Set(targetCandidates.map((candidate) => candidate.sqCandidato));

  const selectedVotes = new Map();
  const candidateMunicipalities = new Set();
  for (const row of candidateRows) {
    const municipality = municipalities.get(row.municipioKey);
    if (!municipality) continue;
    matchedMunicipalities.add(municipality.id);
    municipalTotals.set(municipality.id, (municipalTotals.get(municipality.id) ?? 0) + row.votos);
    if (!targetCandidateIds.has(row.sqCandidato)) continue;
    candidateMunicipalities.add(municipality.id);
    selectedVotes.set(municipality.id, (selectedVotes.get(municipality.id) ?? 0) + row.votos);
  }

  const points = [];
  for (const [municipalityId, votos] of selectedVotes) {
    const totalVotosNominais = municipalTotals.get(municipalityId) ?? 0;
    if (totalVotosNominais <= 0) continue;
    const municipality = municipalityById.get(municipalityId);
    if (!municipality) continue;
    const indicatorValues = Object.fromEntries(
      indicatorKeys.flatMap((key) => {
        const value = indicators.values[key][municipalityId];
        return value == null ? [] : [[key, value]];
      }),
    );
    if (!Object.keys(indicatorValues).length) continue;
    points.push({
      codigoIbge: municipalityId,
      municipio: municipality.nome,
      uf: municipality.uf,
      votos,
      totalVotosNominais,
      percentualVotos: (100 * votos) / totalVotosNominais,
      indicador: indicatorValues[indicator],
      indicadores: indicatorValues,
    });
  }

  const alvo = targetType === 'partido'
    ? { tipo: 'partido', nome: String(input.partido), partido: String(input.partido) }
    : {
        tipo: 'candidato',
        nome: targetCandidates[0].nome,
        partido: targetCandidates[0].partido,
      };
  return {
    ano: scope.ano,
    uf: scope.uf,
    cargo: office,
    turno: round,
    alvo,
    indicador: indicators.metadata[indicator],
    indicadores: indicators.metadata,
    pontos: points,
    cobertura: {
      municipiosComCorrespondencia: matchedMunicipalities.size,
      municipiosComDados: points.filter((point) => point.indicador != null).length,
      municipiosComDadosPorIndicador: Object.fromEntries(
        indicatorKeys.map((key) => [key, points.filter((point) => point.indicadores[key] != null).length]),
      ),
      municipiosSemCorrespondencia: Math.max(0, new Set(candidateRows.map((row) => row.municipioKey)).size - matchedMunicipalities.size),
      municipiosDoAlvo: candidateMunicipalities.size,
    },
    fontes: { tse: catalog.fonte, ibge: 'https://servicodados.ibge.gov.br/api' },
  };
}

export function getCrossingResults(input) {
  return buildCrossingResults(input, 'candidato');
}

export function getPartyCrossingResults(input) {
  return buildCrossingResults(input, 'partido');
}