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

    -- "me avisa quando baixar": pedidos dos membros do nosso grupo
    CREATE TABLE IF NOT EXISTS wishes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      member_jid   TEXT NOT NULL,
      member_name  TEXT,
      text         TEXT NOT NULL,
      query        TEXT NOT NULL,
      tokens       TEXT NOT NULL,
      product_id   INTEGER,
      active       INTEGER NOT NULL DEFAULT 1,
      notified_at  TEXT,
      notify_count INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wishes_active ON wishes(active, created_at);
    CREATE TABLE IF NOT EXISTS wish_calls (
      message_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- fotos de grupos com marca d'água refeitas pela IA (só entram no banco depois da aprovação)
    CREATE TABLE IF NOT EXISTS image_fixes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  INTEGER NOT NULL,
      group_jid   TEXT,
      group_name  TEXT,
      message_id  TEXT,
      corner      TEXT NOT NULL DEFAULT 'top-right',
      src_path    TEXT NOT NULL,
      out_path    TEXT,
      status      TEXT NOT NULL DEFAULT 'queued',   -- queued | ready | approved | rejected | failed
      error       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_image_fixes_status ON image_fixes(status, created_at);

    -- fotos achadas no Pinterest: só entram no banco do perfume depois da aprovação do Arthur
    CREATE TABLE IF NOT EXISTS pin_photos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  INTEGER NOT NULL,
      url         TEXT NOT NULL,
      path        TEXT NOT NULL,
      width       INTEGER NOT NULL,
      height      INTEGER NOT NULL,
      title       TEXT,
      score       INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(product_id, url)
    );
    CREATE INDEX IF NOT EXISTS idx_pin_photos_status ON pin_photos(status, product_id);

    -- fotos da seção "Fragram Photos" do Fragrantica (só a URL; baixa quando o Arthur usa)
    CREATE TABLE IF NOT EXISTS api_calls (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      at          TEXT NOT NULL DEFAULT (datetime('now')),
      kind        TEXT NOT NULL,
      product_id  INTEGER,
      label       TEXT,
      items       INTEGER,
      cost_usd    REAL NOT NULL DEFAULT 0,
      ok          INTEGER NOT NULL DEFAULT 1,
      ms          INTEGER,
      result      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_calls_at ON api_calls(at);

    CREATE TABLE IF NOT EXISTS frag_photos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      frag_url    TEXT NOT NULL,
      url         TEXT NOT NULL,
      thumb       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(frag_url, url)
    );

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
    "ALTER TABLE groups ADD COLUMN wm_corner TEXT NOT NULL DEFAULT 'top-right'",
    "ALTER TABLE groups ADD COLUMN wm_ref TEXT",
    "ALTER TABLE products ADD COLUMN main_image_id INTEGER",
    "ALTER TABLE images ADD COLUMN feat TEXT",
    "ALTER TABLE groups ADD COLUMN photo_priority INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE groups ADD COLUMN wm_remove INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE groups ADD COLUMN wm_mask TEXT",
    "ALTER TABLE groups ADD COLUMN promo INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE image_fixes ADD COLUMN box TEXT",
    "ALTER TABLE image_fixes ADD COLUMN usage TEXT",
    "ALTER TABLE pin_photos ADD COLUMN ref_sim REAL",
    "ALTER TABLE pin_photos ADD COLUMN flags TEXT",
    "ALTER TABLE pin_photos ADD COLUMN feat TEXT",
    "ALTER TABLE groups ADD COLUMN follow INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE posts ADD COLUMN wa_ids TEXT",
    "ALTER TABLE products ADD COLUMN frag_name TEXT",
    "ALTER TABLE products ADD COLUMN frag_brand TEXT",
    "ALTER TABLE products ADD COLUMN frag_url TEXT",
    "ALTER TABLE products ADD COLUMN frag_checked_at TEXT",
    "ALTER TABLE products ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE products ADD COLUMN frag_data TEXT",
    "ALTER TABLE products ADD COLUMN fragram_at TEXT",
    "ALTER TABLE products ADD COLUMN frag_searched INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE images ADD COLUMN crop TEXT",
    "ALTER TABLE products ADD COLUMN approved INTEGER",
    "ALTER TABLE pin_photos ADD COLUMN chosen_by TEXT",
    "ALTER TABLE products ADD COLUMN frag_accords TEXT",
    // grupo de ofertas boas (teste 2): post com destino próprio, fora da fila do grupo principal
    "ALTER TABLE posts ADD COLUMN dest TEXT",
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
