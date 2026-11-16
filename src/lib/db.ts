import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Banco SQLite embutido (node:sqlite, sem dependências nativas).
 * O arquivo fica em DATA_DIR (padrão ./data). Em produção, monte um volume nesse caminho.
 */

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "./data");
export const MEDIA_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, "media");

type G = typeof globalThis & { __afiliadosDb?: DatabaseSync };
const g = globalThis as G;

function migrate(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS groups (
      jid        TEXT PRIMARY KEY,
      name       TEXT NOT NULL DEFAULT '',
      size       INTEGER NOT NULL DEFAULT 0,
      role       TEXT NOT NULL DEFAULT 'none',  -- none | source | destination
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id     TEXT UNIQUE,
      source_jid     TEXT,
      source_name    TEXT,
      original_text  TEXT NOT NULL DEFAULT '',
      formatted_text TEXT NOT NULL DEFAULT '',
      data_json      TEXT NOT NULL DEFAULT '{}',
      media_path     TEXT,
      media_mime     TEXT,
      product_key    TEXT,
      status         TEXT NOT NULL DEFAULT 'queued', -- pending | queued | sending | sent | failed | skipped | duplicate
      reason         TEXT,
      attempts       INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, id);
    CREATE INDEX IF NOT EXISTS idx_posts_product ON posts(product_key, created_at);

    CREATE TABLE IF NOT EXISTS logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      level      TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function db(): DatabaseSync {
  if (!g.__afiliadosDb) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const file = process.env.DATABASE_FILE || path.join(/*turbopackIgnore: true*/ DATA_DIR, "afiliados.db");
    const instance = new DatabaseSync(file);
    migrate(instance);
    g.__afiliadosDb = instance;
  }
  return g.__afiliadosDb;
}

export function log(level: "info" | "warn" | "error", message: string) {
  try {
    db().prepare("INSERT INTO logs (level, message) VALUES (?, ?)").run(level, message.slice(0, 4000));
    db().exec("DELETE FROM logs WHERE id < (SELECT MAX(id) - 2000 FROM logs)");
  } catch {
    /* ignora erros de log */
  }
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[afiliados] ${message}`);
}
