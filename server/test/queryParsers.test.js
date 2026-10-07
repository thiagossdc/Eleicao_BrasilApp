import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptionalInt, parseOptionalString, parseBooleanQuery, parsePagination } from '../src/http/validators/queryParsers.js';

test('parseOptionalInt: ausente ou vazio vira undefined (o chamador aplica o padrão)', () => {
  assert.equal(parseOptionalInt(undefined, 'ano'), undefined);
  assert.equal(parseOptionalInt(null, 'ano'), undefined);
  assert.equal(parseOptionalInt('', 'ano'), undefined);
  assert.equal(parseOptionalInt('   ', 'ano'), undefined);
});

test('parseOptionalInt: valores válidos são convertidos', () => {
  assert.equal(parseOptionalInt('2022', 'ano'), 2022);
  assert.equal(parseOptionalInt(' 2022 ', 'ano'), 2022);
  assert.equal(parseOptionalInt(0, 'turno'), 0);
  assert.equal(parseOptionalInt('-5', 'offset'), -5);
});

test('parseOptionalInt: valor inválido responde 400 em vez de ser descartado em silêncio', () => {
  // Regressão: antes, "ano=abc" era ignorado e a busca saía sem filtro de ano.
  assert.throws(() => parseOptionalInt('abc', 'ano'), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /Parâmetro ano inválido/);
    return true;
  });
  assert.throws(() => parseOptionalInt('2022abc', 'ano'), { status: 400 });
  assert.throws(() => parseOptionalInt('1.5', 'ano'), { status: 400 });
  assert.throws(() => parseOptionalInt('NaN', 'ano'), { status: 400 });
});

test('parseOptionalString: aplica trim e considera vazio como ausente', () => {
  assert.equal(parseOptionalString('  Silva '), 'Silva');
  assert.equal(parseOptionalString('   '), undefined);
  assert.equal(parseOptionalString(undefined), undefined);
});

test('parseBooleanQuery: só valores conhecidos ligam a flag', () => {
  assert.equal(parseBooleanQuery('true'), true);
  assert.equal(parseBooleanQuery('1'), true);
  assert.equal(parseBooleanQuery('sim'), true);
  assert.equal(parseBooleanQuery('false'), false);
  assert.equal(parseBooleanQuery('qualquercoisa'), false);
  assert.equal(parseBooleanQuery(undefined, true), true);
});

test('parsePagination: aplica limites (1..100) e offset negativo vira 0', () => {
  assert.deepEqual(parsePagination({}), { limit: 30, offset: 0 });
  assert.deepEqual(parsePagination({ limit: '50', offset: '100' }), { limit: 50, offset: 100 });
  assert.deepEqual(parsePagination({ limit: '999999' }), { limit: 100, offset: 0 });
  assert.deepEqual(parsePagination({ limit: '0', offset: '-10' }), { limit: 30, offset: 0 });
  assert.throws(() => parsePagination({ limit: 'abc' }), { status: 400 });
});
