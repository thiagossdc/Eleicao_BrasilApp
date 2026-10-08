import assert from 'node:assert/strict';
import test from 'node:test';
import { votingCsvEntryNames } from '../src/services/crossing.service.js';

/**
 * Modo BRASIL do cruzamento: lê o arquivo nacional único (_BR.csv) com a
 * apuração presidencial consolidada. Agregar os 27 CSVs por UF estourava o
 * heap (~4GB, validado em ambiente local), então o modo nacional fica
 * restrito a Presidente.
 */
test('BRASIL resolve para o arquivo nacional único _BR.csv', () => {
  assert.deepEqual(votingCsvEntryNames(2022, 'BRASIL'), ['votacao_candidato_munzona_2022_BR.csv']);
});

test('UF única resolve para um único CSV', () => {
  assert.deepEqual(votingCsvEntryNames(2024, 'SP'), ['votacao_candidato_munzona_2024_SP.csv']);
});
