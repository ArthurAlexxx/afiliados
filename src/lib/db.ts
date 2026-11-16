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

    -- curadoria: cada perfume identificado entre os grupos
    CREATE TABLE IF NOT EXISTS products (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      pkey           TEXT NOT NULL,
      name           TEXT NOT NULL,
      ml             INTEGER NOT NULL,
      conc           TEXT,
      tokens         TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      last_posted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_products_ml ON products(ml);

    -- cada promoção vista em um grupo de origem
    CREATE TABLE IF NOT EXISTS offers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id   TEXT UNIQUE,
      product_id   INTEGER NOT NULL,
      group_jid    TEXT NOT NULL,
      group_name   TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL DEFAULT '',
      price        REAL,
      old_price    REAL,
      pct          INTEGER,
      coupon       TEXT,
      url          TEXT,
      text         TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_offers_product ON offers(product_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_offers_created ON offers(created_at);

    -- banco de fotos por perfume (só de grupos sem marca d'água)
    CREATE TABLE IF NOT EXISTS images (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  INTEGER NOT NULL,
      message_id  TEXT,
      group_jid   TEXT,
      path        TEXT NOT NULL,
      width       INTEGER NOT NULL,
      height      INTEGER NOT NULL,
      hash        TEXT NOT NULL,
      score       INTEGER NOT NULL,
      disabled    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_images_product ON images(product_id, score);

    -- vendas do Mercado Livre (RadarHub): o que está vendendo e subindo agora
    CREATE TABLE IF NOT EXISTS sales (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT NOT NULL,            -- em_alta | mais_vendidos
      category    TEXT,
      name        TEXT NOT NULL,
      brand       TEXT,
      ml          INTEGER,
      tokens      TEXT NOT NULL,
      position    INTEGER,
      revenue     REAL,
      units       REAL,
      growth      REAL,                     -- % de crescimento (19 = +19%)
      period      TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_kind ON sales(kind, updated_at);

    CREATE TABLE IF NOT EXISTS logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      level      TEXT NOT NULL,
      message    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // colunas novas em tabelas antigas
  for (const sql of [
    "ALTER TABLE groups ADD COLUMN watermark INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE posts ADD COLUMN product_id INTEGER",
    "ALTER TABLE posts ADD COLUMN origin TEXT NOT NULL DEFAULT 'repost'",
  ]) {
    try {
      db.exec(sql);
    } catch {
      /* coluna já existe */
    }
  }
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
