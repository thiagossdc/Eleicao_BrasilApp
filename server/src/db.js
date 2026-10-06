import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';

/** Seed versionado (server/data/eleicao.db) — único caminho estável no bundle da Vercel. */
const seedDbPath = fileURLToPath(new URL('../data/eleicao.db', import.meta.url));

/** true quando roda como Vercel Function (inclusive `vercel dev`). */
const isServerless = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

function resolveDbPath() {
  if (env.sqlitePath) return env.sqlitePath;

  if (!isServerless) {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return path.join(dataDir, 'eleicao.db');
  }

  // Na Vercel o filesystem da function é somente leitura; usa /tmp (gravável,
  // mas efêmero por instância). Copia o seed na primeira abertura do cold start.
  const dataDir = path.join(os.tmpdir(), 'eleicao-limpa');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'eleicao.db');
  if (!fs.existsSync(dbPath)) {
    if (!fs.existsSync(seedDbPath)) {
      console.warn('[db] Seed não encontrado no bundle:', seedDbPath);
    } else {
      fs.copyFileSync(seedDbPath, dbPath);
    }
  }
  return dbPath;
}

export const db = new Database(resolveDbPath());

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano_eleicao INTEGER NOT NULL,
    sg_uf TEXT NOT NULL,
    sq_candidato TEXT NOT NULL,
    nm_candidato TEXT NOT NULL,
    nm_urna TEXT,
    nr_cpf TEXT,
    ds_cargo TEXT,
    sg_partido TEXT,
    nm_partido TEXT,
    ds_situacao TEXT,
    ds_eleicao TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (ano_eleicao, sg_uf, sq_candidato)
  );

  CREATE TABLE IF NOT EXISTS cassacoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ano_eleicao INTEGER NOT NULL,
    sg_uf TEXT NOT NULL,
    sq_candidato TEXT NOT NULL,
    nr_processo TEXT,
    ds_tp_motivo TEXT,
    ds_motivo TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (ano_eleicao, sg_uf, sq_candidato, nr_processo, ds_motivo)
  );

  CREATE INDEX IF NOT EXISTS idx_candidates_search
    ON candidates (ano_eleicao, sg_uf, nm_candidato);
  CREATE INDEX IF NOT EXISTS idx_cassacoes_sq
    ON cassacoes (ano_eleicao, sg_uf, sq_candidato);
`);
