import fs from "node:fs";
import path from "node:path";
import { db, log, MEDIA_DIR } from "./db.ts";
import { getSettings, getState, setState, type Settings } from "./settings.ts";
import { extractUrls, isMeliUrl, UA } from "./links.ts";
import { manchete, parsePromo, renderTemplate, formatPrice } from "./parser.ts";
import { nameQuality, notPerfume, perfumeInfo, perfumeOrigin, samePerfume, type Origin, type PerfumeInfo } from "./perfume.ts";
import { analyzeImage, hammingHex, toJpeg } from "./images.ts";
import { autoPhotoScore, featuresOf, type PhotoRow } from "./photoprefs.ts";
import { brandImage, standardImage } from "./branding.ts";
import { Evolution } from "./evolution.ts";
import { pullRadarHub, salesBoostFor } from "./sales.ts";
import { judge } from "./agent.ts";
import { inflatedOldPrice, ourBestToday, priceLabel, realDiscount, realPrice, type PriceLabel } from "./prices.ts";

const BANK_DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, "bank");
const sqlNow = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

/* ------------------------------------------------------------------ */
/* Registro de ofertas e fotos                                          */
/* ------------------------------------------------------------------ */

type ProductRow = { id: number; pkey: string; name: string; ml: number; conc: string | null; tokens: string; last_posted_at: string | null };

function findOrCreateProduct(info: PerfumeInfo, title: string): number {
  const rows = db().prepare("SELECT * FROM products WHERE ml = ?").all(info.ml) as ProductRow[];
  for (const r of rows) {
    const byName = perfumeInfo(r.name);
    if (r.pkey === info.key || samePerfume(info, { ml: r.ml, conc: r.conc, tokens: JSON.parse(r.tokens), key: r.pkey }) || (byName && samePerfume(info, byName))) {
      // guarda o nome mais completo (marca + linha + ml), como os grupos escrevem
      const clean = displayName(title);
      if (nameQuality(clean) > nameQuality(r.name)) db().prepare("UPDATE products SET name = ? WHERE id = ?").run(clean, r.id);
      return r.id;
    }
  }
  const res = db()
    .prepare("INSERT INTO products (pkey, name, ml, conc, tokens) VALUES (?, ?, ?, ?, ?)")
    .run(info.key, displayName(title), info.ml, info.conc, JSON.stringify(info.tokens));
  log("info", `Agente de cadastro: perfume novo no banco: ${displayName(title)}`);
  scheduleDupCheck();
  return Number(res.lastInsertRowid);
}

/** Revisa o nome de todos os perfumes com todos os títulos já vistos nos grupos (roda uma vez). */
export function refreshProductNames(): number {
  const rows = db().prepare("SELECT o.product_id, o.title, p.name FROM offers o JOIN products p ON p.id = o.product_id WHERE o.title IS NOT NULL").all() as {
    product_id: number; title: string; name: string;
  }[];
  const best = new Map<number, { name: string; q: number; cur: string }>();
  for (const r of rows) {
    const clean = displayName(r.title);
    const q = nameQuality(clean);
    const b = best.get(r.product_id);
    if (!b) best.set(r.product_id, { name: clean, q, cur: r.name });
    else if (q > b.q) best.set(r.product_id, { ...b, name: clean, q });
  }
  let n = 0;
  const up = db().prepare("UPDATE products SET name = ? WHERE id = ?");
  for (const [id, b] of best) if (b.name !== b.cur && b.q > nameQuality(b.cur)) (up.run(b.name, id), n++);
  return n;
}

function displayName(title: string) {
  return title
    .replace(/[*_~]/g, "")
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
  /** grupo com marca d'água que a gente limpa (LaMa) */
  wmRemove?: boolean;
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
  const productId0 = productId;

  let img = "";
  if (o.image && !o.watermark) img = await addImage(productId0, o.image, o.messageId, o.groupJid).catch((e) => `foto falhou: ${e.message}`);
  else if (o.image && o.wmRemove) {
    const { queueUnwatermark } = await import("./unwatermark.ts");
    img = await queueUnwatermark({ productId: productId0, image: o.image, messageId: o.messageId, groupJid: o.groupJid }).catch((e) => `foto falhou: ${e.message}`);
  }

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
    db().prepare("UPDATE images SET path=?, width=?, height=?, hash=?, score=?, message_id=?, group_jid=?, feat=? WHERE id=?")
      .run(file, a.width, a.height, a.hash, a.score, messageId || null, groupJid || null, JSON.stringify(featuresOf(a)), same.id);
    if (same.path !== file) fs.rmSync(same.path, { force: true });
    return `foto melhor substituiu a repetida (nota ${a.score})`;
  }
  db().prepare("INSERT INTO images (product_id, message_id, group_jid, path, width, height, hash, score, feat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(productId, messageId || null, groupJid || null, file, a.width, a.height, a.hash, a.score, JSON.stringify(featuresOf(a)));
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
  /** bônus por estar vendendo cada vez mais no ML (RadarHub) */
  sales: { boost: number; note: string } | null;
  /** árabe e importado têm prioridade; nacional só quando a oferta é muito boa */
  origin: Origin | null;
  /** preço real (mediana do "POR" nos grupos, 30 dias) e quanto a melhor oferta está abaixo dele */
  real: { ref: number; samples: number; groups: number; discount: number | null; label: PriceLabel | null; inflated: boolean } | null;
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
  // atrás do RP Promos na última hora: libera preço normal e repete perfume depois de 2h (em vez de 5h)
  const catchUp = catchingUp(s);
  const coolHours = catchUp ? Math.min(2, s.curationCooldownHours) : s.curationCooldownHours;
  const coolSince = Date.now() - coolHours * 3600e3;
  const ts = (d: string) => new Date(d.replace(" ", "T") + "Z").getTime();

  // descartados pelo agente há pouco: espera 30 min antes de tentar de novo (um preço melhor pode chegar)
  const rejected = new Set(
    (db().prepare("SELECT DISTINCT product_id FROM posts WHERE origin='curated' AND status='skipped' AND created_at >= datetime('now','-30 minutes')").all() as { product_id: number }[]).map((r) => r.product_id),
  );

  const photoOnly = new Set(
    (db().prepare("SELECT jid FROM groups WHERE role = 'source' AND promo = 0").all() as { jid: string }[]).map((g) => g.jid),
  );

  const out: RankItem[] = [];
  for (const [pid, list] of byProduct) {
    const p = products.get(pid);
    if (!p) continue;
    const prices = list.map((o) => o.price).filter((x): x is number => typeof x === "number" && x > 0);
    const med = median(prices);
    const recent = list.filter((o) => ts(o.created_at) >= recentSince && o.price && o.url);
    // a oferta postada (link e preço) só vem dos grupos de promoção; os outros contam só para o hype e o preço
    const best = recent.filter((o) => !photoOnly.has(o.group_jid)).sort((a, b) => (a.price! - b.price!) || (ts(b.created_at) - ts(a.created_at)))[0] || null;
    const groups = new Set(list.map((o) => o.group_jid)).size;
    const recentGroups = new Set(recent.map((o) => o.group_jid)).size;
    const pctVsMedian = best && med ? (med - best.price!) / med : null;
    const declaredPct = best?.pct ?? (best?.old_price && best.price ? Math.round((1 - best.price / best.old_price) * 100) : null);
    const pimgs = imgBy.get(pid) || [];
    const rp = realPrice(pid);
    const coolingDown = Boolean(p.last_posted_at && ts(p.last_posted_at) >= coolSince);

    // nota: popularidade (quantos grupos postam), preço contra o histórico e se está bombando agora
    // nota = hype: quantos grupos oferecem o perfume, quantas vezes e se está bombando agora.
    // Preço e % de desconto NÃO entram (variam demais de um perfume para outro).
    let score =
      40 * Math.min(1, groups / 6) +
      20 * Math.min(1, list.length / 20) +
      25 * Math.min(1, recentGroups / 3) +
      // oferta recém-chegada: o preço ainda está valendo
      (best ? 15 * Math.max(0, 1 - (Date.now() - ts(best.created_at)) / lookbackMs) : 0);
    if (!pimgs.length) score -= 20;
    // vendendo cada vez mais no Mercado Livre: sai na frente
    const sales = salesBoostFor(p.name, p.ml);
    if (sales) score += sales.boost;
    // foco do grupo: árabes e importados (é o que mais vende); nacional fica atrás
    const origin = perfumeOrigin(`${p.name}\n${(best || list[0]).text.slice(0, 400)}`);
    if (origin === "arabe") score += 15;
    else if (origin === "importado") score += 12;
    else if (origin === "nacional") score -= 15;
    score = Math.round(Math.max(0, score));

    let why = "";
    if (!best) why = `sem oferta nos últimos ${s.curationLookbackMinutes} min`;
    // regra do Arthur: só perfume (body splash, creme, loção, hidratante… não)
    else if (notPerfume(`${p.name}\n${best.text.split("\n").find((l) => l.trim()) || ""}`))
      why = `não é perfume (${notPerfume(`${p.name}\n${best.text.split("\n").find((l) => l.trim()) || ""}`)})`;
    else if (coolingDown) why = `já postado nas últimas ${coolHours}h`;
    else if (s.curationRequireImage && !pimgs.length) why = "sem foto boa no banco";
    // regra do Arthur: perfume com só 1 foto no banco não é postado
    else if (pimgs.length < 2 && !(p as { main_image_id?: number | null }).main_image_id) why = pimgs.length ? "só 1 foto no banco (precisa de 2 ou mais)" : "sem foto no banco";
    else if (rejected.has(pid)) why = "descartado pelo agente há pouco";
    else if (rp && best?.price && 1 - best.price / rp.ref < (catchUp ? 0 : 0.08))
      why = `preço normal: R$ ${formatPrice(best.price)} contra R$ ${formatPrice(rp.ref)} de preço real`;
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
      sales: sales ? { boost: sales.boost, note: sales.note } : null,
      origin,
      real: rp ? { ref: rp.ref, samples: rp.samples, groups: rp.groups, discount: realDiscount(best?.price ?? null, rp), label: priceLabel(realDiscount(best?.price ?? null, rp)), inflated: inflatedOldPrice(best?.old_price ?? null, rp) } : null,
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

/**
 * Selo de menor preço (vai na 1ª linha do post, que é o que aparece na notificação).
 * Só quando é verdade: o preço é o menor visto nos grupos nos últimos 30 dias,
 * ou fica até 5% acima de um recorde de mais de 7 dias atrás e é o menor da última semana
 * (ex: R$500 → R$400 → semanas depois R$420 também ganha; quem viu o de R$400 provavelmente não vê este).
 * O texto respeita quanto histórico temos: só diz "30 dias" quando o banco cobre ~30 dias.
 */
export function lowPriceSeal(productId: number, price: number | null, messageId?: string | null): string {
  if (!price || price <= 0) return "";
  const rows = db()
    .prepare("SELECT price, created_at FROM offers WHERE product_id = ? AND price > 0 AND created_at >= datetime('now','-30 days') AND created_at < datetime('now','-15 minutes') AND message_id IS NOT ? ORDER BY created_at")
    .all(productId, messageId ?? null) as { price: number; created_at: string }[];
  if (rows.length < 5) return "";
  const ts = (d: string) => new Date(d.replace(" ", "T") + "Z").getTime();
  const coverDays = (Date.now() - ts(rows[0].created_at)) / 86400e3;
  if (coverDays < 2) return ""; // pouco histórico ainda
  const med = median(rows.map((r) => r.price))!;
  const valid = rows.filter((r) => r.price >= med * 0.5); // ignora preço lido errado (kit, miniatura)
  if (!valid.length) return "";
  const low = valid.reduce((a, b) => (b.price < a.price ? b : a));
  const weekAgo = Date.now() - 7 * 86400e3;
  const lastWeek = valid.filter((r) => ts(r.created_at) >= weekAgo).map((r) => r.price);
  const ok = price <= low.price || (ts(low.created_at) < weekAgo && price <= low.price * 1.05 && (!lastWeek.length || price <= Math.min(...lastWeek)));
  if (!ok) return "";
  return coverDays >= 25 ? "MENOR PREÇO EM 30 DIAS" : coverDays >= 7 ? "MENOR PREÇO DA SEMANA" : "MENOR PREÇO DOS ÚLTIMOS DIAS";
}

export function isHistoricLow(productId: number, price: number | null, messageId?: string | null): boolean {
  return Boolean(lowPriceSeal(productId, price, messageId));
}

/**
 * Melhor foto do perfume para o post: nota da foto, mas quadrada vale mais
 * (foto em pé ou deitada gera bordas laterais no quadrado).
 */
export function bestImagePath(productId: number): string | null {
  // foto escolhida como principal na tela Fotos: sempre ela
  const main = db()
    .prepare("SELECT i.path FROM products p JOIN images i ON i.id = p.main_image_id WHERE p.id = ? AND i.disabled = 0")
    .get(productId) as { path: string } | undefined;
  if (main && fs.existsSync(main.path)) return main.path;
  // sem principal: escolha automática, com o gosto aprendido das fotos que o Arthur escolheu
  const rows = db()
    .prepare(
      `SELECT i.path, i.score, i.width, i.height, i.feat, g.photo_priority priority FROM images i
       LEFT JOIN groups g ON g.jid = i.group_jid WHERE i.product_id = ? AND i.disabled = 0`,
    )
    .all(productId) as PhotoRow[];
  // fotos abaixo de 650px não entram na escolha automática: melhor usar a foto do anúncio do ML
  const best = rows
    .filter((r) => Math.min(r.width, r.height) >= 650 && fs.existsSync(r.path))
    .sort((a, b) => autoPhotoScore(b) - autoPhotoScore(a))[0];
  return best ? best.path : null;
}

/**
 * Cria o post do perfume escolhido: converte o link da melhor oferta para o seu link de afiliado,
 * monta o texto no seu template e prepara a melhor foto com as etiquetas.
 */
export async function createCuratedPost(item: RankItem, s: Settings = getSettings()): Promise<{ id: number; status: string; reason: string | null }> {
  if (!item.best) throw new Error("Esse perfume não tem oferta recente");
  // busca as opções do Pinterest (uma vez por perfume) para o Arthur escolher a foto fixa
  import("./pinterest.ts").then((m) => m.ensurePins(item.productId)).catch(() => undefined);
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
    historico: lowPriceSeal(item.productId, item.best.price, (item.best as { message_id?: string }).message_id),
  };
  data.manchete = manchete(data);
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

  // o agente decide sozinho: sai ou não sai
  const offerAgeMin = (Date.now() - new Date(item.best.created_at.replace(" ", "T") + "Z").getTime()) / 60e3;
  const decision = built.status === "skipped" || built.status === "duplicate"
    ? { approve: false, reason: `Descartado: ${built.reason || "bloqueado"}`, checks: [], by: "regras" as const }
    : await judge(
        {
          productId: item.productId, name: item.name, price: item.bestPrice, medianPrice: item.medianPrice, minPrice: item.minPrice,
          groups: item.groups, recentGroups: item.recentGroups, score: item.score, link: data.link, hasImage: Boolean(mediaPath),
          historicLow: Boolean(data.historico), salesNote: item.sales?.note, offerAgeMin, text: item.best.text,
          origin: item.origin, discountPct: discount,
          realPrice: item.real?.ref ?? null, realDiscount: item.real?.discount ?? null, inflated: item.real?.inflated ?? false,
          ourBestToday: ourBestToday(item.productId),
        },
        s,
      );
  const status = decision.approve ? "queued" : "skipped";
  const reason = decision.reason;

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
          medianPrice: item.medianPrice, discount, origin: item.origin, real: item.real, image: bankPath ? "banco" : mediaPath ? "anúncio" : "sem foto",
        },
        agent: decision,
      }),
      mediaPath,
      mediaPath ? "image/jpeg" : null,
      built.productKey,
      item.productId,
      status,
      reason,
    );
  if (decision.approve) db().prepare("UPDATE products SET last_posted_at = datetime('now') WHERE id = ?").run(item.productId);
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
  const last = db().prepare("SELECT MAX(created_at) t FROM posts WHERE origin = 'curated' AND status IN ('queued','sending','sent')").get() as { t: string | null };
  return last.t ? Date.now() - new Date(last.t.replace(" ", "T") + "Z").getTime() : Infinity;
}
const gapMs = (s: Settings) => (s.curationPerHour > 0 ? (60 / s.curationPerHour) * 60e3 : 0);

/**
 * Ritmo espelhado no RP Promos (pedido do Arthur, sócio dele): na última hora, postamos tantos quanto eles postaram.
 * Sem o grupo na lista, volta para o ritmo fixo de curationPerHour.
 */
export const MIRROR_GROUP = process.env.MIRROR_GROUP || "RP PROMOS";
const MIRROR_MIN_GAP = 3 * 60e3; // nunca dois posts nossos com menos de 3 min
let paceCache: { at: number; v: { mirror: boolean; theirs: number; ours: number } } | null = null;
export function pace(s: Settings) {
  if (paceCache && Date.now() - paceCache.at < 20e3) return paceCache.v;
  const jids = (db().prepare("SELECT jid FROM groups WHERE upper(name) LIKE ?").all(`%${MIRROR_GROUP.toUpperCase()}%`) as { jid: string }[]).map((r) => r.jid);
  const ours = (db().prepare("SELECT COUNT(*) n FROM posts WHERE origin='curated' AND status IN ('queued','sending','sent') AND created_at >= datetime('now','-60 minutes')").get() as { n: number }).n;
  let v = { mirror: false, theirs: s.curationPerHour, ours };
  if (jids.length) {
    const theirs = (
      db()
        .prepare(`SELECT COUNT(*) n FROM offers WHERE group_jid IN (${jids.map(() => "?").join(",")}) AND created_at >= datetime('now','-60 minutes')`)
        .get(...jids) as { n: number }
    ).n;
    v = { mirror: true, theirs, ours };
  }
  paceCache = { at: Date.now(), v };
  return v;
}

/**
 * Promoção fora de série pode furar o ritmo de N/h: nota muito alta, menor preço histórico ou vendas disparando.
 * Mesmo assim, sem spam: no máximo N+3 posts na última hora e pelo menos 4 min entre posts.
 */
export function exceptional(item: RankItem, s: Settings) {
  const special = item.score >= 85 || (item.sales?.boost || 0) >= 15 || isHistoricLow(item.productId, item.bestPrice, (item.best as { message_id?: string } | null)?.message_id);
  if (!special) return false;
  const lastHour = (db().prepare("SELECT COUNT(*) n FROM posts WHERE origin='curated' AND status IN ('queued','sending','sent') AND created_at >= datetime('now','-60 minutes')").get() as { n: number }).n;
  const p = pace(s);
  return lastHour < (p.mirror ? p.theirs + 1 : s.curationPerHour + 3) && sinceLastCuratedMs() >= 4 * 60e3;
}

/** Estamos atrás do RP Promos na última hora (regras de preço e repetição ficam mais leves). */
export function catchingUp(s: Settings) {
  if (process.env.MIRROR_RELAX === "0") return false;
  const p = pace(s);
  const v = p.mirror && p.ours < p.theirs;
  (globalThis as { __catchUp?: boolean }).__catchUp = v;
  return v;
}

export function slotOpen(s: Settings) {
  const p = pace(s);
  if (p.mirror) return p.ours < p.theirs && sinceLastCuratedMs() >= MIRROR_MIN_GAP;
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
  if (!slotOpen(s) && !exceptional(item, s)) return `nota ${item.score}, aguardando o ritmo (${pace(s).mirror ? `${MIRROR_GROUP}: ${pace(s).theirs} na última hora, nós ${pace(s).ours}` : `${s.curationPerHour}/h`})`;
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
  if (getState("namesV2") !== "1") {
    try {
      const n = refreshProductNames();
      setState("namesV2", "1");
      log("info", `Nomes dos perfumes revisados: ${n} ficaram com o nome completo`);
    } catch (e) {
      log("warn", `Revisão de nomes: ${(e as Error).message}`);
    }
  }
  // perfumes repetidos: na subida e a cada 6h
  const merge = () => {
    try {
      const n = mergeDuplicateProducts();
      if (n) log("info", `${n} perfume(s) repetido(s) juntado(s)`);
    } catch (e) {
      log("warn", `Juntar perfumes repetidos: ${(e as Error).message}`);
    }
  };
  merge();
  setInterval(merge, 6 * 3600e3);
  w.__afiliadosCuration = setInterval(async () => {
    if (w.__afiliadosCurationBusy) return;
    w.__afiliadosCurationBusy = true;
    try {
      const s = getSettings();
      // vendas do RadarHub a cada 6h, quando ele estiver acessível
      if (process.env.RADARHUB_URL && Date.now() - Number(getState("radarHubAt") || 0) > 6 * 3600e3) {
        setState("radarHubAt", String(Date.now()));
        pullRadarHub().catch((e) => log("warn", `RadarHub: ${(e as Error).message}`));
      }
      import("./pinterest.ts").then(async (m) => { await m.prefetchNext(); await m.pinAutoStep(); }).catch((e) => log("warn", `Pinterest: ${(e as Error).message}`));
      if (s.mode !== "curated") return;
      // "me avisa quando baixar": chamada no grupo 2x por dia
      {
        const { maybeSendWishCall } = await import("./wishes.ts");
        if (await maybeSendWishCall()) return;
      }
      // Top 5 do dia às 21h (um post só)
      if (s.top5Enabled) {
        const { runTop5 } = await import("./top5.ts");
        const r = await runTop5();
        if (r.msg.startsWith("post")) return;
      }
      // espera o histórico ser importado na primeira vez, para não escolher com o banco vazio
      if (process.env.AUTO_SOURCE_GROUPS && !getState("historyImported")) return;
      const { inActiveWindow } = await import("./pipeline.ts");
      if (!inActiveWindow(s)) return;
      // quando abre a vaga do ritmo, posta a melhor promoção boa que estiver valendo
      // garante o ritmo mínimo: se a vaga abriu e em 2 min não chegou nada com nota alta,
      // posta a melhor promoção que estiver valendo
      const since = sinceLastCuratedMs();
      const p = pace(s);
      if (p.mirror && Date.now() - Number(getState("paceLogAt") || 0) > 10 * 60e3) {
        setState("paceLogAt", String(Date.now()));
        const rk = ranking(s).filter((i) => !/^sem oferta/.test(i.why || ""));
        const whys = new Map<string, number>();
        for (const i of rk) if (!i.eligible) { const k = (i.why || "").replace(/R\$ [\d.,]+/g, "R$").replace(/#\d+/g, "#"); whys.set(k, (whys.get(k) || 0) + 1); }
        log("info", `Ritmo ${MIRROR_GROUP}: eles ${p.theirs} na última hora, nós ${p.ours}; promoções valendo agora: ${rk.filter((i) => i.eligible).length} boas, ${rk.length - rk.filter((i) => i.eligible).length} barradas (${[...whys].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${n}× ${k}`).join("; ")})`);
      }
      if (p.mirror && slotOpen(s)) {
        // espelho do RP: estamos atrás deles na última hora, posta a melhor promoção valendo
        const top = ranking(s).find((i) => i.eligible);
        if (top) {
          paceCache = null;
          log("info", `Ritmo ${MIRROR_GROUP}: eles ${p.theirs} na última hora, nós ${p.ours}; postando ${top.name}`);
          await pickAndQueue({ productId: top.productId });
          return;
        }
      } else if (!p.mirror && s.curationPerHour > 0 && since >= gapMs(s)) {
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

/**
 * Junta perfumes cadastrados duas vezes (ex.: "Lattafa The Kingdom EDP 100ml" e "The Kingdom Lattafa Edp 100ml"),
 * que entraram antes das regras atuais de nome. Fica o que tem foto principal escolhida (ou mais ofertas);
 * ofertas, fotos, posts, Pinterest e pedidos do outro passam para ele.
 */
/** Agente de cadastro: cada perfume novo que entra no banco dispara a checagem de repetidos (junta em até 20s). */
function scheduleDupCheck() {
  const g = globalThis as { __dupTimer?: NodeJS.Timeout };
  if (g.__dupTimer) return;
  g.__dupTimer = setTimeout(() => {
    g.__dupTimer = undefined;
    try {
      const n = mergeDuplicateProducts();
      log("info", n ? `Agente de cadastro: ${n} repetido(s) arrumado(s)` : "Agente de cadastro: nenhum repetido");
    } catch (e) {
      log("warn", `Agente de cadastro: ${(e as Error).message}`);
    }
  }, 20_000);
}

export function mergeDuplicateProducts(): number {
  const rows = db()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.id) n,
        (SELECT 1 FROM pin_photos f WHERE f.product_id = p.id AND f.status = 'approved' LIMIT 1) pin FROM products p ORDER BY p.ml, p.id`,
    )
    .all() as (ProductRow & { main_image_id: number | null; n: number; pin: number | null })[];
  const infos = rows.map((r) => ({ r, a: { ml: r.ml, conc: r.conc, tokens: JSON.parse(r.tokens) as string[], key: r.pkey }, b: perfumeInfo(r.name) }));
  const same = (x: (typeof infos)[number], y: (typeof infos)[number]) =>
    samePerfume(x.a, y.a) || (x.b && y.b ? samePerfume(x.b, y.b) : false);
  const gone = new Set<number>();
  let merged = 0;
  for (let i = 0; i < infos.length; i++) {
    if (gone.has(infos[i].r.id)) continue;
    for (let j = i + 1; j < infos.length && infos[j].r.ml === infos[i].r.ml; j++) {
      const x = infos[i], y = infos[j];
      if (gone.has(y.r.id) || !same(x, y)) continue;
      const rank = (z: typeof x) => (z.r.pin ? 4 : 0) + (z.r.main_image_id ? 2 : 0) + z.r.n / 1e4;
      const [keep, drop] = rank(x) >= rank(y) ? [x, y] : [y, x];
      const k = keep.r.id, d = drop.r.id;
      const tx = db();
      tx.exec("BEGIN");
      try {
        for (const t of ["offers", "images", "posts", "wishes", "image_fixes"]) tx.prepare(`UPDATE ${t} SET product_id = ? WHERE product_id = ?`).run(k, d);
        tx.prepare("UPDATE OR IGNORE pin_photos SET product_id = ? WHERE product_id = ?").run(k, d);
        tx.prepare("DELETE FROM pin_photos WHERE product_id = ?").run(d);
        // o que já está aprovado no que fica manda; opções pendentes do outro viram recusadas se já há escolha
        if (keep.r.pin) tx.prepare("UPDATE pin_photos SET status = 'rejected' WHERE product_id = ? AND status = 'pending'").run(k);
        const main = keep.r.main_image_id ?? drop.r.main_image_id;
        const last = [keep.r.last_posted_at, drop.r.last_posted_at].filter(Boolean).sort().pop() ?? null;
        const name = nameQuality(drop.r.name) > nameQuality(keep.r.name) ? drop.r.name : keep.r.name;
        tx.prepare("UPDATE products SET main_image_id = ?, last_posted_at = ?, name = ? WHERE id = ?").run(main, last, name, k);
        tx.prepare("DELETE FROM products WHERE id = ?").run(d);
        tx.exec("COMMIT");
      } catch (e) {
        tx.exec("ROLLBACK");
        log("warn", `Juntar perfumes repetidos (${keep.r.name} + ${drop.r.name}): ${(e as Error).message}`);
        continue;
      }
      gone.add(d);
      if (keep === y) infos[i] = y; // segue comparando com o que ficou
      merged++;
      log("info", `Agente de cadastro: perfume repetido juntado: "${drop.r.name}" entrou em "${keep.r.name}"`);
    }
  }
  // guarda as palavras do nome com as regras atuais (marca escrita errada fica de fora), para os próximos anúncios acharem
  const up = db().prepare("UPDATE products SET tokens = ? WHERE id = ?");
  for (const x of infos)
    if (!gone.has(x.r.id) && x.b && x.b.ml === x.r.ml && JSON.stringify(x.b.tokens) !== x.r.tokens) up.run(JSON.stringify(x.b.tokens), x.r.id);
  return merged;
}
