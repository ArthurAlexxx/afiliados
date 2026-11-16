import fs from "node:fs";
import path from "node:path";
import { db, log, MEDIA_DIR } from "./db.ts";
import { getSettings, getState, setState, type Settings } from "./settings.ts";
import { extractUrls, isMeliUrl, UA } from "./links.ts";
import { parsePromo, renderTemplate, formatPrice } from "./parser.ts";
import { perfumeInfo, samePerfume, type PerfumeInfo } from "./perfume.ts";
import { analyzeImage, hammingHex, toJpeg } from "./images.ts";
import { brandImage, standardImage } from "./branding.ts";
import { Evolution } from "./evolution.ts";

const BANK_DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, "bank");
const sqlNow = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/* ------------------------------------------------------------------ */
/* Registro de ofertas e fotos                                          */
/* ------------------------------------------------------------------ */

type ProductRow = { id: number; pkey: string; name: string; ml: number; conc: string | null; tokens: string; last_posted_at: string | null };

function findOrCreateProduct(info: PerfumeInfo, title: string): number {
  const rows = db().prepare("SELECT * FROM products WHERE ml = ?").all(info.ml) as ProductRow[];
  for (const r of rows) {
    if (r.pkey === info.key || samePerfume(info, { ml: r.ml, conc: r.conc, tokens: JSON.parse(r.tokens), key: r.pkey })) {
      // guarda o nome mais curto e limpo como nome de exibição
      const clean = displayName(title);
      if (clean.length >= 8 && clean.length < r.name.length) db().prepare("UPDATE products SET name = ? WHERE id = ?").run(clean, r.id);
      return r.id;
    }
  }
  const res = db()
    .prepare("INSERT INTO products (pkey, name, ml, conc, tokens) VALUES (?, ?, ?, ?, ?)")
    .run(info.key, displayName(title), info.ml, info.conc, JSON.stringify(info.tokens));
  return Number(res.lastInsertRowid);
}

function displayName(title: string) {
  return title
    .replace(/^perfume\s+(árabe\s+)?/i, "")
    .replace(/\s+(masculino|feminino|unissex)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type OfferInput = {
  messageId: string;
  groupJid: string;
  groupName: string;
  text: string;
  /** foto da mensagem (só é guardada se o grupo não usa marca d'água) */
  image?: Buffer | null;
  watermark?: boolean;
  createdAt?: Date;
};

/** Registra a promoção (e a foto, se servir) no banco da curadoria. */
export async function recordOffer(o: OfferInput): Promise<string> {
  const p = parsePromo(o.text);
  if (p.cupomOnly || !p.titulo) return "sem produto (post de cupom/aviso)";
  const info = perfumeInfo(p.titulo);
  if (!info) return "não identifiquei o perfume (sem ml no título)";
  const url = extractUrls(o.text).find((u) => isMeliUrl(u) && !/\/sec\//.test(u)) || null;
  if (!url) return "sem link de produto do Mercado Livre";

  const productId = findOrCreateProduct(info, p.titulo);
  const created = sqlNow(o.createdAt || new Date());
  const r = db()
    .prepare(
      `INSERT OR IGNORE INTO offers (message_id, product_id, group_jid, group_name, title, price, old_price, pct, coupon, url, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      o.messageId || null,
      productId,
      o.groupJid,
      o.groupName,
      p.titulo,
      Number.isNaN(p.precoNum) ? null : p.precoNum,
      Number.isNaN(p.precoAntigoNum) ? null : p.precoAntigoNum,
      p.descontoPct,
      p.cupom || null,
      url,
      o.text,
      created,
    );
  if (!r.changes) return "oferta já registrada";

  let img = "";
  if (o.image && !o.watermark) img = await addImage(productId, o.image, o.messageId, o.groupJid).catch((e) => `foto falhou: ${e.message}`);
  return `oferta #${r.lastInsertRowid} (produto #${productId})${img ? `, ${img}` : ""}`;
}

/** Guarda a foto no banco do perfume. Fotos repetidas (mesmo hash) ficam só com a melhor versão. */
export async function addImage(productId: number, buf: Buffer, messageId?: string, groupJid?: string): Promise<string> {
  const a = await analyzeImage(buf);
  if (Math.min(a.width, a.height) < 500) return "foto pequena, ignorada";
  const same = (db().prepare("SELECT id, hash, score, path FROM images WHERE product_id = ?").all(productId) as {
    id: number; hash: string; score: number; path: string;
  }[]).find((i) => hammingHex(i.hash, a.hash) <= 8);
  if (same && same.score >= a.score) return "foto repetida";

  fs.mkdirSync(BANK_DIR, { recursive: true });
  const file = path.join(/*turbopackIgnore: true*/ BANK_DIR, `${productId}_${a.hash}.jpg`);
  fs.writeFileSync(file, await toJpeg(buf));
  if (same) {
    db().prepare("UPDATE images SET path=?, width=?, height=?, hash=?, score=?, message_id=?, group_jid=? WHERE id=?")
      .run(file, a.width, a.height, a.hash, a.score, messageId || null, groupJid || null, same.id);
    if (same.path !== file) fs.rmSync(same.path, { force: true });
    return `foto melhor substituiu a repetida (nota ${a.score})`;
  }
  db().prepare("INSERT INTO images (product_id, message_id, group_jid, path, width, height, hash, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(productId, messageId || null, groupJid || null, file, a.width, a.height, a.hash, a.score);
  return `foto guardada (nota ${a.score})`;
}

/* ------------------------------------------------------------------ */
/* Ranking                                                              */
/* ------------------------------------------------------------------ */

type OfferRow = {
  id: number; product_id: number; group_jid: string; group_name: string; title: string;
  price: number | null; old_price: number | null; pct: number | null; coupon: string | null; url: string | null; text: string; created_at: string;
};

export type RankItem = {
  productId: number;
  name: string;
  ml: number;
  posts: number;
  groups: number;
  recentGroups: number;
  minPrice: number | null;
  medianPrice: number | null;
  best: OfferRow | null;
  bestPrice: number | null;
  pctVsMedian: number | null;
  declaredPct: number | null;
  image: { id: number; score: number; width: number; height: number } | null;
  images: number;
  lastPostedAt: string | null;
  coolingDown: boolean;
  eligible: boolean;
  why: string;
  score: number;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export function ranking(s: Settings = getSettings(), opts: { days?: number } = {}): RankItem[] {
  const days = opts.days || 7;
  const offers = db()
    .prepare("SELECT * FROM offers WHERE created_at >= datetime('now', ?) ORDER BY created_at DESC")
    .all(`-${days} days`) as OfferRow[];
  const byProduct = new Map<number, OfferRow[]>();
  for (const o of offers) {
    const l = byProduct.get(o.product_id) || [];
    l.push(o);
    byProduct.set(o.product_id, l);
  }
  if (!byProduct.size) return [];

  const ids = [...byProduct.keys()];
  const products = new Map(
    (db().prepare(`SELECT * FROM products WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as ProductRow[]).map((p) => [p.id, p]),
  );
  const imgs = db()
    .prepare(`SELECT id, product_id, score, width, height FROM images WHERE disabled = 0 AND product_id IN (${ids.map(() => "?").join(",")}) ORDER BY score DESC`)
    .all(...ids) as { id: number; product_id: number; score: number; width: number; height: number }[];
  const imgBy = new Map<number, typeof imgs>();
  for (const i of imgs) imgBy.set(i.product_id, [...(imgBy.get(i.product_id) || []), i]);

  const lookbackMs = Math.max(5, s.curationLookbackMinutes) * 60e3;
  const recentSince = Date.now() - lookbackMs;
  const coolSince = Date.now() - s.curationCooldownHours * 3600e3;
  const ts = (d: string) => new Date(d.replace(" ", "T") + "Z").getTime();

  const out: RankItem[] = [];
  for (const [pid, list] of byProduct) {
    const p = products.get(pid);
    if (!p) continue;
    const prices = list.map((o) => o.price).filter((x): x is number => typeof x === "number" && x > 0);
    const med = median(prices);
    const recent = list.filter((o) => ts(o.created_at) >= recentSince && o.price && o.url);
    const best = recent.sort((a, b) => (a.price! - b.price!) || (ts(b.created_at) - ts(a.created_at)))[0] || null;
    const groups = new Set(list.map((o) => o.group_jid)).size;
    const recentGroups = new Set(recent.map((o) => o.group_jid)).size;
    const pctVsMedian = best && med ? (med - best.price!) / med : null;
    const declaredPct = best?.pct ?? (best?.old_price && best.price ? Math.round((1 - best.price / best.old_price) * 100) : null);
    const pimgs = imgBy.get(pid) || [];
    const coolingDown = Boolean(p.last_posted_at && ts(p.last_posted_at) >= coolSince);

    // nota: popularidade (quantos grupos postam), preço contra o histórico e se está bombando agora
    let score =
      30 * Math.min(1, groups / 6) +
      10 * Math.min(1, list.length / 20) +
      20 * Math.min(1, recentGroups / 3) +
      30 * Math.max(0, Math.min(1, (pctVsMedian ?? 0) / 0.2)) +
      10 * Math.min(1, Math.max(0, (declaredPct ?? 0) - 20) / 30) +
      // quanto mais nova a oferta, melhor (preço ainda deve estar valendo)
      (best ? 15 * Math.max(0, 1 - (Date.now() - ts(best.created_at)) / lookbackMs) : 0);
    if (!pimgs.length) score -= 20;
    score = Math.round(Math.max(0, score));

    let why = "";
    if (!best) why = `sem oferta nos últimos ${s.curationLookbackMinutes} min`;
    else if (coolingDown) why = `já postado nas últimas ${s.curationCooldownHours}h`;
    else if (s.curationRequireImage && !pimgs.length) why = "sem foto boa no banco";
    out.push({
      productId: pid,
      name: p.name,
      ml: p.ml,
      posts: list.length,
      groups,
      recentGroups,
      minPrice: prices.length ? Math.min(...prices) : null,
      medianPrice: med,
      best,
      bestPrice: best?.price ?? null,
      pctVsMedian,
      declaredPct,
      image: pimgs[0] ? { id: pimgs[0].id, score: pimgs[0].score, width: pimgs[0].width, height: pimgs[0].height } : null,
      images: pimgs.length,
      lastPostedAt: p.last_posted_at,
      coolingDown,
      eligible: !why,
      why,
      score,
    });
  }
  return out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}

/* ------------------------------------------------------------------ */
/* Montagem do post                                                     */
/* ------------------------------------------------------------------ */

function destination() {
  return db().prepare("SELECT jid, name FROM groups WHERE role = 'destination' ORDER BY name LIMIT 1").get() as
    | { jid: string; name: string }
    | undefined;
}

export function brandName(s: Settings = getSettings()) {
  if (s.brandName) return s.brandName;
  const d = destination();
  return (d?.name || "Ofertas").replace(/\s*\((teste|test)\)\s*/i, " ").trim();
}

/** Foto do grupo de destino (cache de 1 dia). */
export async function brandAvatar(s: Settings = getSettings()): Promise<Buffer | null> {
  const file = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, "brand-avatar.jpg");
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < 24 * 3600e3) return fs.readFileSync(file);
  } catch {
    /* sem cache */
  }
  const d = destination();
  if (!d) return null;
  try {
    const url = await new Evolution(s).profilePictureUrl(d.jid);
    if (!url) return null;
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(file, buf);
    return buf;
  } catch (e) {
    log("warn", `Foto do grupo indisponível: ${(e as Error).message}`);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }
}

/** Aplica as etiquetas (desconto + grupo/@) numa foto. */
export async function brand(buf: Buffer, discountPct: number | null, s: Settings = getSettings()) {
  if (!s.brandEnabled) return standardImage(buf);
  return brandImage(buf, {
    discountPct,
    groupName: brandName(s),
    instagram: s.brandInstagram,
    avatar: await brandAvatar(s),
  });
}

export function bestImagePath(productId: number): string | null {
  const r = db().prepare("SELECT path FROM images WHERE product_id = ? AND disabled = 0 ORDER BY score DESC LIMIT 1").get(productId) as
    | { path: string }
    | undefined;
  return r && fs.existsSync(r.path) ? r.path : null;
}

/**
 * Cria o post do perfume escolhido: converte o link da melhor oferta para o seu link de afiliado,
 * monta o texto no seu template e prepara a melhor foto com as etiquetas.
 */
export async function createCuratedPost(item: RankItem, s: Settings = getSettings()): Promise<{ id: number; status: string; reason: string | null }> {
  if (!item.best) throw new Error("Esse perfume não tem oferta recente");
  // import tardio para evitar ciclo pipeline ↔ curation
  const { buildPost } = await import("./pipeline.ts");
  const bankPath = bestImagePath(item.productId);
  const built = await buildPost(item.best.text, s, { groupName: item.best.group_name, wantImage: !bankPath });
  const parsed = parsePromo(item.best.text);
  const discount = item.declaredPct && item.declaredPct > 0 ? item.declaredPct : item.pctVsMedian && item.pctVsMedian > 0.05 ? Math.round(item.pctVsMedian * 100) : null;
  const data = {
    ...built.data,
    titulo: item.name,
    desconto: discount ? `(-${discount}%)` : built.data.desconto,
    desconto_pct: discount ? String(discount) : built.data.desconto_pct,
    grupo_origem: item.best.group_name,
  };
  const formatted = renderTemplate(s.template, data);

  let mediaPath: string | null = null;
  try {
    let raw: Buffer | null = bankPath ? fs.readFileSync(bankPath) : null;
    if (!raw && built.productImage) {
      const r = await fetch(built.productImage, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
      if (r.ok) raw = Buffer.from(await r.arrayBuffer());
    }
    if (raw) {
      const out = await brand(raw, discount, s);
      mediaPath = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, `curadoria_${item.productId}_${Date.now()}.jpg`);
      fs.writeFileSync(mediaPath, out);
    }
  } catch (e) {
    log("warn", `Foto da curadoria falhou: ${(e as Error).message}`);
  }

  let status = built.status === "skipped" || built.status === "duplicate" ? "skipped" : built.status;
  let reason = built.reason;
  if (!mediaPath && s.curationRequireImage) {
    status = "pending";
    reason = "Sem foto boa para esse perfume";
  }

  const info = db()
    .prepare(
      `INSERT INTO posts (message_id, source_jid, source_name, original_text, formatted_text, data_json,
        media_path, media_mime, product_key, product_id, origin, status, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'curated', ?, ?)`,
    )
    .run(
      `cur-${item.productId}-${Date.now()}`,
      item.best.group_jid,
      `Curadoria · ${item.groups} grupo(s)`,
      item.best.text,
      formatted,
      JSON.stringify({
        data,
        conversions: built.conversions,
        curation: {
          score: item.score, groups: item.groups, posts: item.posts, bestPrice: item.bestPrice,
          medianPrice: item.medianPrice, discount, image: bankPath ? "banco" : mediaPath ? "anúncio" : "sem foto",
        },
      }),
      mediaPath,
      mediaPath ? "image/jpeg" : null,
      built.productKey,
      item.productId,
      status,
      reason,
    );
  db().prepare("UPDATE products SET last_posted_at = datetime('now') WHERE id = ?").run(item.productId);
  const id = Number(info.lastInsertRowid);
  log(
    "info",
    `Curadoria escolheu "${item.name}" por R$ ${item.bestPrice != null ? formatPrice(item.bestPrice) : "?"} (${item.groups} grupos, nota ${item.score}) → post #${id} ${status}${reason ? ` (${reason})` : ""}`,
  );
  return { id, status, reason };
}

/** Escolhe o melhor perfume do momento e coloca na fila. */
export async function pickAndQueue(opts: { productId?: number; force?: boolean } = {}): Promise<string> {
  const s = getSettings();
  if (!opts.force) {
    const open = db().prepare("SELECT id FROM posts WHERE origin = 'curated' AND status IN ('queued','sending') LIMIT 1").get();
    if (open) return "já tem post da curadoria na fila";
  }
  const list = ranking(s);
  const item = opts.productId ? list.find((i) => i.productId === opts.productId) : list.find((i) => i.eligible);
  if (!item) return opts.productId ? "perfume sem oferta recente" : "nenhum perfume elegível agora";
  setState("lastCurationAt", String(Date.now()));
  const r = await createCuratedPost(item, s);
  if (r.status === "queued") {
    const { processQueue } = await import("./pipeline.ts");
    void processQueue();
  }
  return `post #${r.id} (${item.name}) → ${r.status}`;
}

/**
 * Avaliação imediata: chamada a cada promoção que chega. Se o perfume dela está entre os melhores
 * agora (nota >= curationInstantScore) e não foi postado recentemente, posta na hora.
 */
/** Respeita o ritmo médio: no máximo curationPerHour posts por hora, espaçados. */
function sinceLastCuratedMs() {
  const last = db().prepare("SELECT MAX(created_at) t FROM posts WHERE origin = 'curated' AND status IN ('queued','sending','sent','pending')").get() as { t: string | null };
  return last.t ? Date.now() - new Date(last.t.replace(" ", "T") + "Z").getTime() : Infinity;
}
const gapMs = (s: Settings) => (s.curationPerHour > 0 ? (60 / s.curationPerHour) * 60e3 : 0);

export function slotOpen(s: Settings) {
  return sinceLastCuratedMs() >= gapMs(s);
}

export async function evaluateInstant(productId: number): Promise<string> {
  const s = getSettings();
  if (s.mode !== "curated" || !s.curationInstantScore) return "";
  const { inActiveWindow } = await import("./pipeline.ts");
  if (!inActiveWindow(s)) return "fora do horário";
  const item = ranking(s).find((r) => r.productId === productId);
  if (!item || !item.eligible) return item?.why || "";
  if (item.score < s.curationInstantScore) return `nota ${item.score} < ${s.curationInstantScore}`;
  if (!slotOpen(s)) return `nota ${item.score}, aguardando o ritmo de ${s.curationPerHour}/h`;
  // evita duas escolhas simultâneas do mesmo perfume (várias mensagens chegando juntas)
  const busy = db().prepare("SELECT 1 FROM posts WHERE product_id = ? AND created_at >= datetime('now','-10 minutes')").get(productId);
  if (busy) return "já escolhido";
  setState("lastCurationAt", String(Date.now()));
  const r = await createCuratedPost(item, s);
  if (r.status === "queued") {
    const { processQueue } = await import("./pipeline.ts");
    void processQueue();
  }
  return `postado na hora: #${r.id} ${item.name} (nota ${item.score}) → ${r.status}`;
}

/* ------------------------------------------------------------------ */
/* Histórico                                                            */
/* ------------------------------------------------------------------ */

type StoredMsg = {
  key?: { id?: string; remoteJid?: string; fromMe?: boolean };
  message?: Record<string, unknown> & { imageMessage?: { caption?: string } };
  messageTimestamp?: number | string;
};

/** Importa as últimas mensagens dos grupos de origem (ofertas + fotos) para começar com o banco cheio. */
export async function importHistory(perGroup = 200, maxImagesPerGroup = 80): Promise<string> {
  const s = getSettings();
  const evo = new Evolution(s);
  const { extractText } = await import("./pipeline.ts");
  const groups = db().prepare("SELECT jid, name, watermark FROM groups WHERE role = 'source'").all() as {
    jid: string; name: string; watermark: number;
  }[];
  let offers = 0, photos = 0;
  for (const g of groups) {
    let msgs: StoredMsg[] = [];
    try {
      msgs = (await evo.findMessages(g.jid, perGroup)) as StoredMsg[];
    } catch (e) {
      log("warn", `Histórico de "${g.name}": ${(e as Error).message}`);
      continue;
    }
    let imgCount = 0;
    for (const m of msgs) {
      const id = m.key?.id || "";
      const text = extractText(m.message as never);
      if (!id || !text) continue;
      if (db().prepare("SELECT 1 FROM offers WHERE message_id = ?").get(id)) continue;
      const tsNum = Number(m.messageTimestamp || 0);
      let image: Buffer | null = null;
      if (m.message?.imageMessage && !g.watermark && imgCount < maxImagesPerGroup) {
        const p = parsePromo(text);
        if (!p.cupomOnly && p.titulo && perfumeInfo(p.titulo)) {
          try {
            const r = await evo.getBase64FromMediaMessage(id);
            if (r.base64) {
              image = Buffer.from(r.base64.replace(/^data:[^,]+,/, ""), "base64");
              imgCount++;
            }
          } catch {
            /* mídia expirada */
          }
        }
      }
      const res = await recordOffer({
        messageId: id,
        groupJid: g.jid,
        groupName: g.name,
        text,
        image,
        watermark: Boolean(g.watermark),
        createdAt: tsNum ? new Date(tsNum * 1000) : undefined,
      });
      if (res.startsWith("oferta #")) offers++;
      if (res.includes("foto guardada") || res.includes("substituiu")) photos++;
    }
  }
  const msg = `Histórico importado: ${offers} ofertas e ${photos} fotos de ${groups.length} grupos`;
  log("info", msg);
  return msg;
}

/* ------------------------------------------------------------------ */
/* Worker                                                               */
/* ------------------------------------------------------------------ */

type W = typeof globalThis & { __afiliadosCuration?: NodeJS.Timeout; __afiliadosCurationBusy?: boolean };
export function startCuration() {
  const w = globalThis as W;
  if (w.__afiliadosCuration) return;
  w.__afiliadosCuration = setInterval(async () => {
    if (w.__afiliadosCurationBusy) return;
    w.__afiliadosCurationBusy = true;
    try {
      const s = getSettings();
      if (s.mode !== "curated") return;
      // espera o histórico ser importado na primeira vez, para não escolher com o banco vazio
      if (process.env.AUTO_SOURCE_GROUPS && !getState("historyImported")) return;
      const { inActiveWindow } = await import("./pipeline.ts");
      if (!inActiveWindow(s)) return;
      // quando abre a vaga do ritmo, posta a melhor promoção boa que estiver valendo
      // garante o ritmo mínimo: se a vaga abriu e em 2 min não chegou nada com nota alta,
      // posta a melhor promoção que estiver valendo
      const since = sinceLastCuratedMs();
      if (s.curationPerHour > 0 && since >= gapMs(s)) {
        const top = ranking(s).find((i) => i.eligible);
        if (top && (top.score >= s.curationInstantScore || since >= gapMs(s) + 2 * 60e3)) {
          await pickAndQueue({ productId: top.productId });
          return;
        }
      }
      // rodada fixa opcional (0 = desligada): só serve para não ficar parado quando nada bom chega
      if (!s.curationIntervalMinutes) return;
      const last = Number(getState("lastCurationAt") || 0);
      if (Date.now() - last < s.curationIntervalMinutes * 60e3) return;
      const r = await pickAndQueue();
      if (!/já tem post/.test(r)) setState("lastCurationAt", String(Date.now()));
    } catch (e) {
      log("error", `Curadoria: ${(e as Error).message}`);
    } finally {
      w.__afiliadosCurationBusy = false;
    }
  }, 60e3);
}
