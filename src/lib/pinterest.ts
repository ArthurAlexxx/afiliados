/**
 * Fotos de perfume achadas no Pinterest (busca pelo site, sem API oficial).
 * - Busca "nome do perfume" e pega as fotos originais (maior resolução) dos pins.
 * - Confere se o título do pin bate com o perfume (sem misturar Salvo com Salvo Intense).
 * - Guarda como candidata: só entra no banco de fotos do perfume quando o Arthur aprova na tela Fotos.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, log, MEDIA_DIR } from "./db.ts";
import { FLANKERS, nameTokens, norm } from "./perfume.ts";
import { analyzeImage } from "./images.ts";

const DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, "pinterest");
const UA_ = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MIN_SIDE = 800;

type Pin = { url: string; title: string };

/**
 * Busca pins pelo Apify (robô "thescrappa/pinterest-search-scraper", ~US$0,0002 por pin).
 * Precisa de APIFY_TOKEN nas variáveis do Railway.
 */
export async function searchPins(query: string, limit = 40): Promise<Pin[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("falta APIFY_TOKEN nas variáveis do Railway");
  const r = await fetch(
    `https://api.apify.com/v2/acts/thescrappa~pinterest-search-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=120`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: [query], limit }), signal: AbortSignal.timeout(150000) },
  );
  if (!r.ok) throw new Error(`Apify respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const items = (await r.json()) as { title?: string; description?: string; image_url?: string; images?: Record<string, { url?: string }> }[];
  return items
    .map((x) => ({ url: x.images?.orig?.url || x.image_url || "", title: [x.title, x.description].filter(Boolean).join(" · ") }))
    .filter((x) => x.url);
}

/** O título do pin fala do mesmo perfume? (com título vazio, deixa para o Arthur decidir) */
function titleMatches(product: string, title: string) {
  if (!title) return true;
  const want = nameTokens(product);
  const t = new Set(norm(title).split(" "));
  if (!want.length) return true;
  const hit = want.filter((w) => t.has(w)).length;
  if (hit / want.length < 0.6) return false;
  for (const f of FLANKERS) if (want.includes(f) !== t.has(f)) return false;
  return true;
}

/** Busca no Pinterest e guarda até `max` fotos candidatas do perfume. Devolve quantas novas. */
export async function findPinPhotos(productId: number, max = 10): Promise<number> {
  const p = db().prepare("SELECT name FROM products WHERE id = ?").get(productId) as { name: string } | undefined;
  if (!p) return 0;
  const query = `${p.name.replace(/\b\d{2,4}\s*ml\b/gi, "").replace(/\s+/g, " ").trim()} perfume`;
  const pins = (await searchPins(query)).filter((x) => titleMatches(p.name, x.title));
  fs.mkdirSync(DIR, { recursive: true });
  let n = 0;
  for (const pin of pins) {
    if (n >= max) break;
    if (db().prepare("SELECT 1 FROM pin_photos WHERE product_id = ? AND url = ?").get(productId, pin.url)) continue;
    try {
      const r = await fetch(pin.url, { headers: { "user-agent": UA_ }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const meta = await sharp(buf).metadata();
      const w = meta.width || 0, h = meta.height || 0;
      if (Math.min(w, h) < MIN_SIDE) continue;
      // muito comprida (montagem, story com texto): fora
      if (Math.max(w, h) / Math.min(w, h) > 1.6) continue;
      const file = path.join(DIR, `${productId}_${Date.now()}_${n}.jpg`);
      const jpg = await sharp(buf).rotate().jpeg({ quality: 92 }).toBuffer();
      fs.writeFileSync(file, jpg);
      // nota: a mesma da escolha automática (fundo, nitidez, enquadramento), quadrada vale mais
      const a = await analyzeImage(jpg).catch(() => null);
      const score = Math.round((a?.score || 0) - 70 * Math.abs(Math.log(w / h)) + (Math.min(w, h) >= 1000 ? 10 : 0));
      db().prepare("INSERT INTO pin_photos (product_id, url, path, width, height, title, score) VALUES (?, ?, ?, ?, ?, ?, ?)").run(productId, pin.url, file, w, h, pin.title.slice(0, 300), score);
      n++;
    } catch {
      /* foto que não baixa: pula */
    }
  }
  log("info", `Pinterest: "${query}" → ${pins.length} pin(s) do mesmo perfume, ${n} foto(s) boas para você aprovar`);
  return n;
}

/** Teste: perfumes das promoções com menos de 2 fotos no banco. */
export async function pinTestBatch(limit = 10) {
  const { ranking } = await import("./curation.ts");
  const items = ranking()
    .filter((i) => i.best && i.images < 2)
    .slice(0, limit);
  let total = 0;
  for (const it of items) total += await findPinPhotos(it.productId).catch((e) => (log("warn", `Pinterest (${it.name}): ${(e as Error).message}`), 0));
  log("info", `Pinterest (teste): ${total} foto(s) de ${items.length} perfume(s) esperando aprovação na tela Fotos`);
}

export function listPins(status = "pending") {
  return db()
    .prepare(
      `SELECT f.id, f.product_id, p.name, f.width, f.height, f.title, f.status, f.created_at, f.score,
        f.id = (SELECT x.id FROM pin_photos x WHERE x.product_id = f.product_id AND x.status = 'pending' ORDER BY x.score DESC LIMIT 1) pick,
        (SELECT COUNT(*) FROM images i WHERE i.product_id = f.product_id AND i.disabled = 0) bank
       FROM pin_photos f JOIN products p ON p.id = f.product_id WHERE f.status = ? ORDER BY f.product_id, f.score DESC LIMIT 300`,
    )
    .all(status);
}

export function pinFile(id: number): string | null {
  const r = db().prepare("SELECT path FROM pin_photos WHERE id = ?").get(id) as { path: string } | undefined;
  return r && fs.existsSync(r.path) ? r.path : null;
}

/**
 * Automático (só depois do Arthur autorizar, state pinAuto = "1"): perfume das promoções sem foto principal
 * ganha a melhor foto do Pinterest como principal, para sempre (ele pode trocar na tela Fotos).
 * Um perfume por vez, cada um buscado uma vez só.
 */
export async function pinAutoStep() {
  const { getState } = await import("./settings.ts");
  if (getState("pinAuto") !== "1") return;
  const g = globalThis as { __pinBusy?: boolean };
  if (g.__pinBusy) return;
  g.__pinBusy = true;
  try {
    await pinAutoOne();
  } finally {
    g.__pinBusy = false;
  }
}

async function pinAutoOne() {
  const { ranking } = await import("./curation.ts");
  const item = ranking().find(
    (i) =>
      i.best &&
      !db().prepare("SELECT main_image_id m FROM products WHERE id = ?").get(i.productId)?.m &&
      !db().prepare("SELECT 1 FROM pin_photos WHERE product_id = ?").get(i.productId),
  );
  if (!item) return;
  const n = await findPinPhotos(item.productId);
  if (!n) {
    // marca como buscado, para não repetir
    db().prepare("INSERT OR IGNORE INTO pin_photos (product_id, url, path, width, height, status) VALUES (?, 'none', '', 0, 0, 'rejected')").run(item.productId);
    return;
  }
  const cands = db().prepare("SELECT id, path, score, width, height FROM pin_photos WHERE product_id = ? AND status = 'pending'").all(item.productId) as {
    id: number; path: string; score: number; width: number; height: number;
  }[];
  const { autoPhotoScore, featuresOf } = await import("./photoprefs.ts");
  let best = cands[0], bestScore = -Infinity;
  for (const c of cands) {
    const a = await analyzeImage(fs.readFileSync(c.path)).catch(() => null);
    const v = autoPhotoScore({ path: c.path, score: c.score, width: c.width, height: c.height, feat: a ? JSON.stringify(featuresOf(a)) : null });
    if (v > bestScore) { bestScore = v; best = c; }
  }
  await chooseMain(best.id);
  log("info", `Pinterest: foto principal escolhida para ${item.name}`);
}

/**
 * O Arthur escolheu a melhor do perfume: ela vira a principal (para sempre, até ele trocar).
 * As outras do perfume entram no banco desligadas: não vão para posts, mas ensinam o gosto dele.
 */
export async function chooseMain(id: number): Promise<string> {
  const r = db().prepare("SELECT product_id FROM pin_photos WHERE id = ?").get(id) as { product_id: number } | undefined;
  if (!r) throw new Error("foto não encontrada");
  const msg = await decidePin(id, true, true);
  const { addImage } = await import("./curation.ts");
  const others = db().prepare("SELECT id, path FROM pin_photos WHERE product_id = ? AND status = 'pending'").all(r.product_id) as { id: number; path: string }[];
  for (const o of others) {
    await addImage(r.product_id, fs.readFileSync(o.path), `pin:${o.id}`).catch(() => "");
    db().prepare("UPDATE images SET disabled = 1 WHERE product_id = ? AND message_id = ?").run(r.product_id, `pin:${o.id}`);
    db().prepare("UPDATE pin_photos SET status = 'rejected' WHERE id = ?").run(o.id);
  }
  const { learnPrefs } = await import("./photoprefs.ts");
  learnPrefs();
  return msg;
}

export async function decidePin(id: number, ok: boolean, asMain = false): Promise<string> {
  const r = db().prepare("SELECT product_id, path FROM pin_photos WHERE id = ? AND status = 'pending'").get(id) as { product_id: number; path: string } | undefined;
  if (!r) throw new Error("foto não encontrada");
  if (!ok) {
    db().prepare("UPDATE pin_photos SET status = 'rejected' WHERE id = ?").run(id);
    return "recusada";
  }
  const { addImage } = await import("./curation.ts");
  const msg = await addImage(r.product_id, fs.readFileSync(r.path), `pin:${id}`);
  db().prepare("UPDATE pin_photos SET status = 'approved' WHERE id = ?").run(id);
  if (asMain) {
    const img = db().prepare("SELECT id FROM images WHERE product_id = ? AND message_id = ?").get(r.product_id, `pin:${id}`) as { id: number } | undefined;
    if (img) db().prepare("UPDATE products SET main_image_id = ? WHERE id = ?").run(img.id, r.product_id);
  }
  return msg;
}
