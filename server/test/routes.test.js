import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createApp } from '../src/http/createApp.js';
import { db } from '../src/db.js';

/**
 * Testes de integração das rotas: sobem o app real num efêmero e exercitam a
 * API como o front faria (sucesso, validação 400, 404 JSON e CORS).
 * Consultas de leitura usam o banco semeado; nada de rede é chamado.
 */

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

async function get(path, init) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body };
}

test('GET /api/health responde ok', async () => {
  const { res, body } = await get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
});

test('GET /api/stats expõe totais numéricos', async () => {
  const { res, body } = await get('/api/stats');
  assert.equal(res.status, 200);
  assert.equal(typeof body.totalCandidatos, 'number');
  assert.equal(typeof body.totalRegistrosCassacao, 'number');
});

test('resposta não anuncia X-Powered-By', async () => {
  const { res } = await get('/api/health');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('CORS devolve o header para a origem configurada', async () => {
  const res = await fetch(`${base}/api/health`, {
    headers: { Origin: 'http://localhost:4200' },
  });
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:4200');
});

test('GET /api/candidates pagina e devolve total', async () => {
  const { res, body } = await get('/api/candidates?limit=5');
  assert.equal(res.status, 200);
  assert.ok(body.items.length <= 5);
  assert.equal(typeof body.total, 'number');
  assert.equal(body.limit, 5);
  assert.ok(body.items.length === 0 || 'sqCandidato' in body.items[0]);
});

test('GET /api/candidates aceita o alias nome (documentado no README)', async () => {
  const { res, body } = await get('/api/candidates?nome=a&limit=1');
  assert.equal(res.status, 200);
  assert.equal(typeof body.total, 'number');
});

test('GET /api/candidates rejeita ano não numérico com 400', async () => {
  const { res, body } = await get('/api/candidates?ano=abc');
  assert.equal(res.status, 400);
  assert.match(body.error, /ano/);
});

test('GET /api/candidates rejeita UF desconhecida com 400', async () => {
  const { res, body } = await get('/api/candidates?uf=XX');
  assert.equal(res.status, 400);
  assert.match(body.error, /UF/);
});

test('GET /api/candidates com paginação além do total devolve lista vazia', async () => {
  const { res, body } = await get('/api/candidates?limit=5&offset=1000000');
  assert.equal(res.status, 200);
  assert.deepEqual(body.items, []);
});

test('GET /api/candidates/options traz cargos e partidos', async () => {
  const { res, body } = await get('/api/candidates/options');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(body.cargos));
  assert.ok(Array.isArray(body.partidos));
});

test('detalhe do candidato exige uf e ano', async () => {
  const row = db
    .prepare('SELECT sq_candidato, sg_uf, ano_eleicao FROM candidates LIMIT 1')
    .get();
  assert.ok(row, 'banco semeado deve ter candidatos');

  const ok = await get(`/api/candidates/${row.sq_candidato}?uf=${row.sg_uf}&ano=${row.ano_eleicao}`);
  assert.equal(ok.res.status, 200);
  assert.ok(ok.body.candidate);
  assert.ok(Array.isArray(ok.body.cassacoes));

  const semParams = await get(`/api/candidates/${row.sq_candidato}`);
  assert.equal(semParams.res.status, 400);
});

test('rota desconhecida responde JSON 404 (não HTML)', async () => {
  const { res, body } = await get('/api/rota-inexistente');
  assert.equal(res.status, 404);
  assert.equal(typeof body.error, 'string');
});

test('POST /api/sync com JSON inválido responde 400 (não 500)', async () => {
  const { res, body } = await get('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  assert.equal(res.status, 400);
  assert.match(body.error, /JSON/);
});

test('POST /api/sync sem corpo obrigatório responde 400', async () => {
  const { res, body } = await get('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 400);
  assert.match(body.error, /ano/);
});

test('POST /api/sync com ano fora da faixa responde 400 sem rede', async () => {
  const { res, body } = await get('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ano: 1890, uf: 'SP' }),
  });
  assert.equal(res.status, 400);
  assert.match(body.error, /inválido/i);
});

test('GET /api/crossings sem alvo responde 400 com mensagem clara', async () => {
  const { res, body } = await get('/api/crossings?ano=2024&uf=SP&cargo=Prefeito&turno=1');
  assert.equal(res.status, 400);
  assert.match(body.error, /candidato/);
});

test('GET /api/crossings com UF desconhecida responde 400 antes de consultar fontes', async () => {
  const { res, body } = await get(
    '/api/crossings?ano=2024&uf=XX&cargo=Prefeito&turno=1&candidato=1&indicador=populacao',
  );
  assert.equal(res.status, 400);
  assert.match(body.error, /UF/);
});
