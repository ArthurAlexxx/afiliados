import fs from "node:fs";
import path from "node:path";
import { db, log, MEDIA_DIR } from "./db.ts";
import { getSettings, getState, setState, type Settings } from "./settings.ts";
import { extractUrls, isMeliUrl, UA } from "./links.ts";
import { manchete, parsePromo, renderTemplate, formatPrice } from "./parser.ts";
import { FLANKERS, nameQuality, norm, notPerfume, perfumeInfo, perfumeOrigin, samePerfume, type Origin, type PerfumeInfo } from "./perfume.ts";
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
      // nome padrão da Fragrantica não é trocado pelo título dos grupos
      if (!(r as { frag_name?: string | null }).frag_name && nameQuality(clean) > nameQuality(r.name)) db().prepare("UPDATE products SET name = ? WHERE id = ?").run(clean, r.id);
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
    .replace(/^(perfume\s+)?((árabe|arabe|masculino|feminino|unissex|unisex|importado|original|veoquiero)\s+)+/i, "")
    .replace(/\s+com\s+nf\b/gi, "")
    .replace(/\s+volume\s+da\s+unidade\b/gi, "")
    .replace(/(\s+(masculino|feminino|masculina|feminina|unissex|unisex|amadeirado|amadeirada|oriental|floral|frutado|frutada|c[ií]trico|arom[aá]tico|especiado|adocicado|original|lacrado|importado))+\s*$/i, "")
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
    // preço de referência só dos grupos de promoção (Arthur, 17/nov: os outros davam "de/por" que não batia com o ML)
    const prices = list.filter((o) => !photoOnly.has(o.group_jid)).map((o) => o.price).filter((x): x is number => typeof x === "number" && x > 0);
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
    // perfume bloqueado pelo Arthur ("não poste isso")
    else if ((p as { blocked?: number }).blocked) why = "bloqueado por você (não postar)";
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
/**
 * Arthur (nov/2026): no post, nome do perfume como está no Fragrantica, e embaixo a marca e o tamanho.
 * Troca a linha do título já renderizada (funciona com qualquer template).
 */
/** Marca escrita no nome, pelas marcas que o Fragrantica já nos deu ("French Avenue", "Rasasi", "O Boticário"). */
function knownBrand(name: string): { name: string; re: string } | null {
  const g = globalThis as { __brands?: { at: number; list: { name: string; key: string }[] } };
  if (!g.__brands || Date.now() - g.__brands.at > 600_000) {
    const rows = db().prepare("SELECT DISTINCT frag_brand b FROM products WHERE frag_brand IS NOT NULL").all() as { b: string }[];
    const list = rows
      .map((r) => {
        const b = r.b.replace(/\s+(Perfumes|Parfums|Fragrances|Paris)$/i, "").trim();
        return { name: b === b.toUpperCase() && /[A-Z]{3}/.test(b) ? b.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m) => m.toUpperCase()) : b, key: norm(b) };
      })
      .filter((x) => x.key.length >= 3)
      .sort((a, b) => b.key.length - a.key.length);
    g.__brands = { at: Date.now(), list };
  }
  const n = ` ${norm(name)} `;
  const hit = g.__brands.list.find((b) => n.includes(` ${b.key} `));
  if (!hit) return null;
  // regex que acha a marca no nome original (com acento e maiúsculas)
  const re = hit.key.split(" ").map((w) => w.split("").map((c) => (/[a-z]/.test(c) ? `[${c}${c.toUpperCase()}\\u00C0-\\u017F]` : c)).join("")).join("[\\s\\-]+");
  return { name: hit.name, re };
}

const CONC_WORDS = /\s+(?:extrait de parfum|eau de parfum|eau de toilette|eau de cologne|deo[\s-]*parfum|deo[\s-]*col[oô]nia|col[oô]nia|(?<!\ble\s)parfum|edp|edt|edc)(?![\p{L}])/giu;

export function withFragTitle(text: string, productId: number, oldTitle: string): string {
  const p = db().prepare("SELECT frag_name, frag_brand, ml, conc FROM products WHERE id = ?").get(productId) as
    | { frag_name: string | null; frag_brand: string | null; ml: number; conc: string | null }
    | undefined;
  if (!oldTitle) return text;
  if (!p?.frag_name || !p.frag_brand) {
    // sem Fragrantica: mesmo padrão dos outros (nome + "🏷️ Marca · ml"), com a marca reconhecida no nome
    const clean = displayName(oldTitle).replace(CONC_WORDS, "").replace(/\b\d{2,4}\s*ml\b/gi, "").replace(/\s{2,}/g, " ").trim();
    const brand = knownBrand(clean);
    const lines = text.split("\n");
    const i = lines.findIndex((l) => l.includes(oldTitle));
    if (i < 0 || !clean) return text;
    if (!brand) {
      lines[i] = lines[i].replace(oldTitle, clean);
      return lines.join("\n");
    }
    const rest = clean.replace(new RegExp(`\\b${brand.re}\\b`, "i"), "").replace(/^[\s\-–·]+|[\s\-–·]+$/g, "").replace(/\s{2,}/g, " ");
    lines.splice(i, 1, lines[i].replace(oldTitle, rest || clean), `🏷️ ${brand.name}${p?.ml ? ` · ${p.ml}ml` : ""}`);
    return lines.join("\n");
  }
  const brand = p.frag_brand.replace(/\s+(Perfumes|Parfums|Fragrances|Paris)$/i, "").trim();
  const nice = brand === brand.toUpperCase() && /[A-Z]{3}/.test(brand) ? brand.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m) => m.toUpperCase()) : brand;
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.includes(oldTitle));
  if (i < 0) return text;
  const name = lines[i].replace(oldTitle, p.frag_name);
  // concentração só serve para achar a página certa no Fragrantica, não aparece no post (Arthur, 17/nov)
  lines.splice(i, 1, name.replace(CONC_WORDS, "").replace(/\s{2,}/g, " ").replace(/\s+(\*?)$/, "$1"), `🏷️ ${nice}${p.ml ? ` · ${p.ml}ml` : ""}`);
  return lines.join("\n");
}

/**
 * Notas principais do Fragrantica no pé do post (Arthur, 17/nov, opção A): "🎯 cítrico, aromático, marinho".
 * Vêm da mesma página lida para as fotos (sem custo extra); se o perfume já tem a ficha, usa as notas dela.
 */
export function fragProfileLines(productId: number): string[] {
  const row = db().prepare("SELECT frag_accords, frag_data FROM products WHERE id = ?").get(productId) as { frag_accords: string | null; frag_data: string | null } | undefined;
  let acc: string[] = [];
  try {
    acc = row?.frag_accords ? JSON.parse(row.frag_accords) : [];
  } catch {}
  if (!acc.length) {
    try {
      const d = row?.frag_data ? JSON.parse(row.frag_data) : null;
      acc = (d?.accords || []).map((a: { name: string }) => String(a.name || "").toLowerCase()).filter(Boolean);
    } catch {}
  }
  if (!acc.length) {
    // mesmo perfume em outro anúncio (outro ml) já leu a página
    const sib = db()
      .prepare("SELECT s.frag_accords FROM products s, products p WHERE p.id = ? AND s.frag_url = p.frag_url AND s.frag_accords IS NOT NULL LIMIT 1")
      .get(productId) as { frag_accords: string } | undefined;
    try {
      acc = sib ? JSON.parse(sib.frag_accords) : [];
    } catch {}
  }
  const line = acc.filter((a) => /^[\p{L} ]+$/u.test(a)).slice(0, 3).join(", ");
  return line ? [`🎯 ${line}`] : [];
}

/** Linha das notas no post (pode desligar com FRAG_PROFILE=0). */
export const FRAG_PROFILE = process.env.FRAG_PROFILE !== "0";

/** Põe as notas do Fragrantica antes do link do produto (uma vez só). */
export function withFragProfile(text: string, productId: number): string {
  if (!FRAG_PROFILE) return text;
  if (/^🎯 /m.test(text)) return text;
  const lines = fragProfileLines(productId);
  if (!lines.length) return text;
  const all = text.split("\n");
  const at = all.findIndex((l) => /LINK DO PRODUTO|https?:\/\//i.test(l));
  if (at < 0) return `${text.trimEnd()}\n\n${lines.join("\n")}`;
  all.splice(at, 0, ...lines, "");
  return all.join("\n");
}

/** Sem custo extra: não chama a ficha; só aproveita o que já foi lido. */
async function ensureFragData(_productId: number) {}

/** Sem foto boa no banco, o post fica esperando a escolha do Arthur (status 'photo') em vez de sair com a foto do anúncio. */
export const WAIT_FOR_PHOTO = true;
const WAIT_HOURS = 3;

/**
 * Arthur escolheu a foto de um perfume: o post dele que estava esperando foto sai agora
 * (só o mais recente, e só se tiver menos de WAIT_HOURS horas).
 */
export async function releaseWaiting(productId: number): Promise<string> {
  const post = db()
    .prepare("SELECT id, data_json FROM posts WHERE product_id = ? AND status = 'photo' AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1")
    .get(productId, `-${WAIT_HOURS} hours`) as { id: number; data_json: string } | undefined;
  if (!post) return "";
  const bank = bestImagePath(productId);
  if (!bank) return "";
  const s = getSettings();
  let pct: number | null = null;
  try {
    pct = JSON.parse(post.data_json)?.curation?.discount ?? null;
  } catch {}
  const out = await brand(await readPostPhoto(bank), pct, s);
  const mediaPath = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, `curadoria_${productId}_${Date.now()}.jpg`);
  fs.writeFileSync(mediaPath, out);
  // o perfume pode ter sido achado no Fragrantica enquanto esperava: título no formato novo
  const cur = db().prepare("SELECT formatted_text FROM posts WHERE id = ?").get(post.id) as { formatted_text: string };
  let title = "";
  try {
    title = JSON.parse(post.data_json)?.data?.titulo || "";
  } catch {}
  await ensureFragData(productId);
  const text = withFragProfile(/🏷️/.test(cur.formatted_text) ? cur.formatted_text : withFragTitle(cur.formatted_text, productId, title), productId);
  db()
    .prepare("UPDATE posts SET media_path = ?, media_mime = 'image/jpeg', formatted_text = ?, status = 'queued', reason = 'Foto escolhida por você' WHERE id = ? AND status = 'photo'")
    .run(mediaPath, text, post.id);
  db().prepare("UPDATE posts SET status = 'skipped', reason = 'Saiu outro post com a foto escolhida' WHERE product_id = ? AND status = 'photo'").run(productId);
  db().prepare("UPDATE products SET last_posted_at = datetime('now') WHERE id = ?").run(productId);
  log("info", `Post #${post.id} saiu da espera: foto escolhida`);
  const { processQueue } = await import("./pipeline.ts");
  void processQueue();
  return `post #${post.id} enviado com a foto escolhida`;
}

/**
 * Arthur trocou a foto ou o enquadramento de um perfume que já está na fila para sair:
 * refaz a imagem dos posts dele que ainda não foram enviados.
 */
export async function refreshQueuedMedia(productId: number): Promise<number> {
  const posts = db().prepare("SELECT id, data_json FROM posts WHERE product_id = ? AND status = 'queued'").all(productId) as { id: number; data_json: string }[];
  if (!posts.length) return 0;
  const bank = chosenImagePath(productId);
  if (!bank) return 0;
  const s = getSettings();
  const photo = await readPostPhoto(bank);
  for (const p of posts) {
    let pct: number | null = null;
    try {
      const j = JSON.parse(p.data_json);
      pct = j?.curation?.discount ?? (Number(j?.data?.desconto_pct) || null);
    } catch {}
    const out = await brand(photo, pct, s);
    const mediaPath = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, `curadoria_${productId}_${Date.now()}_${p.id}.jpg`);
    fs.writeFileSync(mediaPath, out);
    db().prepare("UPDATE posts SET media_path = ?, media_mime = 'image/jpeg' WHERE id = ? AND status = 'queued'").run(mediaPath, p.id);
  }
  log("info", `Foto do perfume #${productId} ajustada: ${posts.length} post(s) da fila refeitos`);
  return posts.length;
}

/** Arthur aprovou um perfume novo: entra no leque e o post segue (foto escolhida → fila; sem foto → Fragrantica). */
export async function approveReview(postId: number): Promise<string> {
  const post = db().prepare("SELECT product_id FROM posts WHERE id = ? AND status = 'review'").get(postId) as { product_id: number } | undefined;
  if (!post) return "esse post não está esperando aprovação";
  db().prepare("UPDATE products SET approved = 1, blocked = 0 WHERE id = ?").run(post.product_id);
  db().prepare("UPDATE posts SET status = 'photo', reason = 'Aprovado por você: esperando foto', created_at = datetime('now') WHERE id = ?").run(postId);
  if (chosenImagePath(post.product_id)) return (await releaseWaiting(post.product_id)) || "aprovado";
  import("./fragrantica.ts").then((m) => m.fragranticaStep()).catch((e) => log("warn", `Fragrantica: ${(e as Error).message}`));
  return "aprovado: procurando as fotos no Fragrantica";
}

export function rejectReview(postId: number): string {
  const post = db().prepare("SELECT product_id FROM posts WHERE id = ?").get(postId) as { product_id: number | null } | undefined;
  if (post?.product_id) db().prepare("UPDATE products SET blocked = 1, approved = 0 WHERE id = ?").run(post.product_id);
  db().prepare("UPDATE posts SET status = 'skipped', reason = 'Rejeitado por você' WHERE id = ?").run(postId);
  if (post?.product_id) db().prepare("UPDATE posts SET status = 'skipped', reason = 'Rejeitado por você' WHERE product_id = ? AND status IN ('review','photo','queued')").run(post.product_id);
  return "rejeitado";
}

export function expireWaiting() {
  const r = db()
    .prepare("UPDATE posts SET status = 'skipped', reason = 'Ficou 3h sem sua aprovação' WHERE status = 'review' AND created_at < datetime('now', ?)")
    .run(`-${WAIT_HOURS} hours`).changes;
  if (r) log("info", `${r} perfume(s) novo(s) sem aprovação em ${WAIT_HOURS}h: descartados`);
  const n = db()
    .prepare("UPDATE posts SET status = 'skipped', reason = 'Ficou sem foto escolhida por 3h' WHERE status = 'photo' AND created_at < datetime('now', ?)")
    .run(`-${WAIT_HOURS} hours`).changes;
  if (n) log("info", `${n} post(s) desistidos: ficaram ${WAIT_HOURS}h sem foto escolhida`);
}

/** Lê a foto do banco já com o enquadramento 1:1 que o Arthur escolheu (se escolheu). */
export async function readPostPhoto(p: string): Promise<Buffer> {
  const { applyCrop, parseCrop } = await import("./crop.ts");
  const row = db().prepare("SELECT crop FROM images WHERE path = ? ORDER BY id DESC LIMIT 1").get(p) as { crop: string | null } | undefined;
  return applyCrop(fs.readFileSync(p), parseCrop(row?.crop ?? null));
}

/** Foto escolhida pelo Arthur como principal (tela Fotos), ou nada. */
export function chosenImagePath(productId: number): string | null {
  const main = db()
    .prepare("SELECT i.path FROM products p JOIN images i ON i.id = p.main_image_id WHERE p.id = ? AND i.disabled = 0")
    .get(productId) as { path: string } | undefined;
  return main && fs.existsSync(main.path) ? main.path : null;
}

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
export async function createCuratedPost(item: RankItem, s: Settings = getSettings(), opts: { follow?: string } = {}): Promise<{ id: number; status: string; reason: string | null }> {
  if (!item.best) throw new Error("Esse perfume não tem oferta recente");
  // busca as opções do Pinterest (uma vez por perfume) para o Arthur escolher a foto fixa
  // import tardio para evitar ciclo pipeline ↔ curation
  const { buildPost } = await import("./pipeline.ts");
  // agente de nomes: perfume que já é nosso (outro anúncio, outro ml, já postado) não pede aprovação nem foto de novo
  adoptKnown(item.productId);
  // Arthur (17/nov): só posta direto com a foto que ele escolheu; sem foto escolhida, vai para "esperando foto"
  const bankPath = chosenImagePath(item.productId);
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
  // perfume do leque que já vai sair: lê a ficha (dia/noite, notas) antes de montar o texto
  if (bankPath && (db().prepare("SELECT approved FROM products WHERE id = ?").get(item.productId) as { approved: number | null } | undefined)?.approved === 1)
    await ensureFragData(item.productId);
  const formatted = withFragProfile(withFragTitle(renderTemplate(s.template, data), item.productId, data.titulo), item.productId);

  let mediaPath: string | null = null;
  try {
    let raw: Buffer | null = bankPath ? await readPostPhoto(bankPath) : null;
    // Arthur (nov/2026): sem foto boa no banco não usa a foto do anúncio; o post espera ele escolher
    if (!raw && built.productImage && !WAIT_FOR_PHOTO) {
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
    : opts.follow
      ? // cópia de grupo seguido: só as travas que não podem falhar (nosso link e preço lido)
        data.link && item.bestPrice
        ? { approve: true, reason: `Copiado de ${opts.follow}`, checks: [{ ok: true, label: `Postado em ${opts.follow}` }], by: "regras" as const }
        : { approve: false, reason: `Descartado: ${data.link ? "sem preço" : "o link do ML não virou o nosso link"}`, checks: [], by: "regras" as const }
      : await judge(
        {
          productId: item.productId, name: item.name, price: item.bestPrice, medianPrice: item.medianPrice, minPrice: item.minPrice,
          groups: item.groups, recentGroups: item.recentGroups, score: item.score, link: data.link, hasImage: Boolean(mediaPath) || (WAIT_FOR_PHOTO && !bankPath),
          historicLow: Boolean(data.historico), salesNote: item.sales?.note, offerAgeMin, text: item.best.text,
          origin: item.origin, discountPct: discount,
          realPrice: item.real?.ref ?? null, realDiscount: item.real?.discount ?? null, inflated: item.real?.inflated ?? false,
          ourBestToday: ourBestToday(item.productId),
        },
        s,
      );
  // Arthur (17/nov): perfume fora do nosso leque espera a aprovação dele (e só então vai ao Fragrantica)
  const approved = (db().prepare("SELECT approved FROM products WHERE id = ?").get(item.productId) as { approved: number | null } | undefined)?.approved === 1;
  const review = decision.approve && !approved;
  const waitPhoto = decision.approve && !review && !bankPath && WAIT_FOR_PHOTO;
  const status = review ? "review" : waitPhoto ? "photo" : decision.approve ? "queued" : "skipped";
  const reason = review ? "Perfume novo: esperando sua aprovação" : waitPhoto ? "Esperando você escolher a foto (tela Fotos)" : decision.reason;

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
  // aviso no celular: perfume novo esperando aprovação
  if (status === "review")
    void import("./push.ts").then((m) =>
      m.sendPush({ title: "Perfume novo para aprovar", body: `${item.name}${item.bestPrice != null ? ` · R$ ${formatPrice(item.bestPrice)}` : ""}`, url: "/fila", tag: `review-${id}` }),
    );
  // esperando foto: já procura as fotos no Fragrantica agora, sem esperar a próxima rodada
  if (waitPhoto) import("./fragrantica.ts").then((m) => m.fragranticaStep()).catch((e) => log("warn", `Fragrantica: ${(e as Error).message}`));
  return { id, status, reason };
}

/**
 * Refaz um post já enviado: apaga a mensagem no nosso grupo (para todos) e posta de novo
 * o mesmo texto com a foto atual do perfume (a principal escolhida na tela Fotos / Pinterest).
 */
export async function redoPost(postId: number): Promise<string> {
  const s = getSettings();
  const post = db().prepare("SELECT * FROM posts WHERE id = ?").get(postId) as
    | { id: number; product_id: number | null; formatted_text: string; data_json: string; source_jid: string; source_name: string; original_text: string; product_key: string | null; wa_ids: string | null; sent_at: string | null }
    | undefined;
  if (!post) throw new Error("post não encontrado");
  if (!post.product_id) throw new Error("post sem perfume");
  const evo = new Evolution(s);
  // 1) apaga no nosso grupo
  let ids: { jid: string; id: string }[] = post.wa_ids ? JSON.parse(post.wa_ids) : [];
  if (!ids.length) {
    // posts antigos não guardavam o id: acha a nossa mensagem pelo texto, perto da hora do envio
    const dests = db().prepare("SELECT jid FROM groups WHERE role = 'destination'").all() as { jid: string }[];
    const sent = post.sent_at ? new Date(post.sent_at.replace(" ", "T") + "Z").getTime() / 1000 : 0;
    const head = post.formatted_text.slice(0, 60);
    for (const d of dests) {
      const msgs = await evo.findMessages(d.jid, 80, 1).catch(() => []);
      for (const m of msgs as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const msg = m.message || {};
        const cap = msg.imageMessage?.caption || msg.extendedTextMessage?.text || msg.conversation || "";
        const ts = Number(m.messageTimestamp) || 0;
        if (m.key?.fromMe && cap.startsWith(head) && (!sent || Math.abs(ts - sent) < 600)) ids.push({ jid: d.jid, id: String(m.key.id) });
      }
    }
  }
  let deleted = 0;
  for (const x of ids) {
    try {
      await evo.deleteForEveryone(x.jid, x.id);
      deleted++;
    } catch (e) {
      log("warn", `Apagar mensagem ${x.id}: ${(e as Error).message}`);
    }
  }
  // 2) posta de novo com a foto atual
  const bank = bestImagePath(post.product_id);
  if (!bank) throw new Error(`apaguei ${deleted} mensagem(ns), mas o perfume não tem foto no banco para repostar`);
  const data = (JSON.parse(post.data_json || "{}").data || {}) as Record<string, string>;
  const pct = Number(data.desconto_pct) || null;
  const out = await brand(await readPostPhoto(bank), pct, s);
  const mediaPath = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, `curadoria_${post.product_id}_${Date.now()}.jpg`);
  fs.writeFileSync(mediaPath, out);
  db().prepare("UPDATE posts SET status = 'skipped', reason = ? WHERE id = ?").run(`Apagado no grupo e refeito com a foto nova`, post.id);
  const info = db()
    .prepare(
      `INSERT INTO posts (message_id, source_jid, source_name, original_text, formatted_text, data_json, media_path, media_mime, product_key, product_id, origin, status, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'image/jpeg', ?, ?, 'curated', 'queued', ?)`,
    )
    .run(`redo-${post.id}-${Date.now()}`, post.source_jid, post.source_name, post.original_text, post.formatted_text, post.data_json, mediaPath, post.product_key, post.product_id, `Refeito do #${post.id} com a foto nova`);
  const id = Number(info.lastInsertRowid);
  const { sendPost } = await import("./pipeline.ts");
  const r = await sendPost(id);
  return `#${post.id} apagado no grupo (${deleted} mensagem) e repostado como #${id} com a foto ${path.basename(bank)} → ${r}`;
}

/* ------------------------------------------------------------------ */
/* Copiar grupos (pedido do Arthur): postou num grupo seguido, posta no nosso                */
/* ------------------------------------------------------------------ */

export const FOLLOW_DEDUP_HOURS = Number(process.env.FOLLOW_DEDUP_HOURS || 4);

export function followMode(): boolean {
  return Boolean(db().prepare("SELECT 1 FROM groups WHERE role = 'source' AND follow = 1 LIMIT 1").get());
}

/** Oferta nova de um grupo seguido: posta o perfume no nosso grupo, se ele não saiu nas últimas horas. */
export async function followPost(productId: number, groupJid: string): Promise<string> {
  const s = getSettings();
  const g = db().prepare("SELECT name, follow FROM groups WHERE jid = ?").get(groupJid) as { name: string; follow: number } | undefined;
  if (!g?.follow) return "";
  const { inActiveWindow } = await import("./pipeline.ts");
  if (!inActiveWindow(s)) return "cópia: fora do horário";
  const p = db().prepare("SELECT name, last_posted_at FROM products WHERE id = ?").get(productId) as { name: string; last_posted_at: string | null } | undefined;
  if (!p) return "";
  if (p.last_posted_at && Date.now() - new Date(p.last_posted_at.replace(" ", "T") + "Z").getTime() < FOLLOW_DEDUP_HOURS * 3600e3)
    return `cópia: já postado nas últimas ${FOLLOW_DEDUP_HOURS}h`;
  const busy = db().prepare("SELECT 1 FROM posts WHERE product_id = ? AND created_at >= datetime('now', ?) AND status IN ('queued','sending','sent','photo','review')").get(productId, `-${FOLLOW_DEDUP_HOURS} hours`);
  if (busy) return "cópia: já na fila/postado";
  const item = ranking(s).find((i) => i.productId === productId);
  if (!item?.best) return "cópia: sem oferta com link";
  if (notPerfume(`${item.name}\n${item.best.text.split("\n").find((l) => l.trim()) || ""}`)) return "cópia: não é perfume";
  if ((db().prepare("SELECT blocked FROM products WHERE id = ?").get(productId) as { blocked: number } | undefined)?.blocked) return "cópia: perfume bloqueado por você";
  const r = await createCuratedPost(item, s, { follow: g.name });
  if (r.status === "queued") {
    const { processQueue } = await import("./pipeline.ts");
    void processQueue();
  }
  return `cópia de ${g.name}: #${r.id} ${item.name} → ${r.status}${r.reason ? ` (${r.reason})` : ""}`;
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
  if (s.mode !== "curated" || !s.curationInstantScore || followMode()) return "";
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
      expireWaiting();
      import("./fragrantica.ts").then((m) => m.fragranticaStep()).catch((e) => log("warn", `Fragrantica: ${(e as Error).message}`));
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
      if (followMode()) return; // modo cópia: só posta o que os grupos seguidos postam
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
      const n = syncNames();
      if (n) log("info", `Agente de cadastro: ${n} repetido(s) arrumado(s)`);
    } catch (e) {
      log("warn", `Agente de cadastro: ${(e as Error).message}`);
    }
  }, 20_000);
}

const isParfum = (t: string) => perfumeInfo(t)?.conc === "parfum";

/**
 * Separa o "Parfum" que tinha sido juntado com a versão comum (Stronger With You Parfum ≠ Stronger With You).
 * Ofertas e posts cujo título é de outra concentração vão para o perfume certo; a página da Fragrantica
 * errada é esquecida para ser procurada de novo.
 */
export function splitParfum(): number {
  const prods = db().prepare("SELECT id, conc, name, frag_url, ml, tokens FROM products").all() as { id: number; conc: string | null; name: string; frag_url: string | null; ml: number; tokens: string }[];
  let moved = 0;
  const touched = new Set<number>();
  const tx = db();
  for (const p of prods) {
    const mine = p.conc === "parfum";
    const offers = tx.prepare("SELECT id, title FROM offers WHERE product_id = ?").all(p.id) as { id: number; title: string }[];
    const pinfo = { ml: (p as { ml?: number }).ml ?? 0, conc: p.conc, tokens: JSON.parse((p as { tokens?: string }).tokens || "[]") as string[], key: "" };
    const other = offers.filter((o) => o.title && perfumeInfo(o.title) && isParfum(o.title) !== mine && !samePerfume(perfumeInfo(o.title)!, pinfo));
    if (!other.length) continue;
    for (const o of other) {
      const info = perfumeInfo(o.title)!;
      const to = findOrCreateProduct(info, o.title);
      if (to === p.id) continue;
      tx.prepare("UPDATE offers SET product_id = ? WHERE id = ?").run(to, o.id);
      touched.add(p.id).add(to);
      moved++;
    }
    const posts = tx.prepare("SELECT id, original_text FROM posts WHERE product_id = ?").all(p.id) as { id: number; original_text: string }[];
    for (const q of posts) {
      const title = (q.original_text || "").split("\n").map((l) => l.replace(/[*_~]/g, "").trim()).find((l) => perfumeInfo(l)) || "";
      if (!title || isParfum(title) === mine || samePerfume(perfumeInfo(title)!, pinfo)) continue;
      const to = findOrCreateProduct(perfumeInfo(title)!, title);
      if (to !== p.id) tx.prepare("UPDATE posts SET product_id = ? WHERE id = ?").run(to, q.id);
    }
    log("info", `Agente de cadastro: ${other.length} oferta(s) de outra concentração separadas de ${p.name}`);
  }
  // página da Fragrantica de outra concentração (só nos perfumes mexidos): esquece para procurar de novo
  const flank = new RegExp(`\\b(${FLANKERS.join("|")})\\b`, "i");
  for (const id of touched) {
    const p = db().prepare("SELECT conc, frag_url, frag_name FROM products WHERE id = ?").get(id) as { conc: string | null; frag_url: string | null; frag_name: string | null } | undefined;
    if (!p?.frag_url) continue;
    const fn = (p.frag_name || p.frag_url.split("/").pop()!.replace(/-\d+\.html$/, "").replace(/-/g, " ")).toLowerCase();
    const fragParfum = /\bparfum\b/.test(fn) && !/eau de parfum/.test(fn);
    if (fragParfum === (p.conc === "parfum") || (!fragParfum && flank.test(fn))) continue;
    db().prepare("UPDATE products SET frag_url = NULL, frag_name = NULL, frag_brand = NULL, frag_data = NULL, frag_accords = NULL, fragram_at = NULL, frag_searched = 0, frag_checked_at = NULL WHERE id = ?").run(id);
  }
  return moved;
}

/** Desfaz separações erradas da 1ª versão: Natura "Parfum" = Deo Parfum; linha que só existe em Parfum (Royal) junta de novo. */
export function fixParfumSplit(): number {
  const rows = db().prepare("SELECT id, name, pkey FROM products WHERE conc = 'parfum'").all() as { id: number; name: string; pkey: string }[];
  for (const r of rows)
    if (perfumeOrigin(r.name) === "nacional") db().prepare("UPDATE products SET conc = 'deo', pkey = REPLACE(pkey, '|parfum', '|deo') WHERE id = ?").run(r.id);
  return mergeDuplicateProducts();
}

/** Depois de juntar: aprovado no leque libera o "para aprovar"; com foto escolhida, o "esperando foto" sai. */
async function continueMergedPosts(ids: number[]) {
  for (const id of ids) {
    try {
      const p = db().prepare("SELECT approved, name FROM products WHERE id = ?").get(id) as { approved: number | null; name: string } | undefined;
      if (!p) continue;
      if (p.approved === 1) {
        const rev = db().prepare("SELECT id FROM posts WHERE product_id = ? AND status = 'review'").all(id) as { id: number }[];
        for (const r of rev) log("info", `Agente de nomes: #${r.id} ${p.name} já é do leque → ${await approveReview(r.id)}`);
      }
      if (chosenImagePath(id) && db().prepare("SELECT 1 FROM posts WHERE product_id = ? AND status = 'photo'").get(id)) {
        const r = await releaseWaiting(id);
        if (r) log("info", `Agente de nomes: ${p.name} já tinha foto → ${r}`);
      }
    } catch (e) {
      log("warn", `Agente de nomes: ${(e as Error).message}`);
    }
  }
}

/** Agente de nomes: tira as palavras de anúncio dos nomes ainda sem Fragrantica ("Masculino … Amadeirado Oriental"). */
export function cleanProductNames(): number {
  const rows = db().prepare("SELECT id, name FROM products WHERE frag_name IS NULL").all() as { id: number; name: string }[];
  let n = 0;
  for (const r of rows) {
    const c = displayName(r.name);
    if (c && c !== r.name && /\d{2,4}\s*ml/i.test(c)) (db().prepare("UPDATE products SET name = ? WHERE id = ?").run(c, r.id), n++);
  }
  return n;
}

/** Agente de nomes, rodando sempre: limpa os nomes e junta o mesmo perfume escrito de outro jeito. */
/** Desfaz uma junção errada: ofertas com esse título voltam para um cadastro próprio. */
export function unmergeOffers(intoNameLike: string, titleRe: RegExp): number {
  const p = db().prepare("SELECT id FROM products WHERE name LIKE ?").get(intoNameLike) as { id: number } | undefined;
  if (!p) return 0;
  const offers = db().prepare("SELECT id, title FROM offers WHERE product_id = ?").all(p.id) as { id: number; title: string }[];
  let n = 0;
  for (const o of offers) {
    const info = o.title && titleRe.test(o.title) ? perfumeInfo(o.title) : null;
    if (!info) continue;
    const to = findOrCreateProduct(info, o.title);
    if (to === p.id) continue;
    db().prepare("UPDATE offers SET product_id = ? WHERE id = ?").run(to, o.id);
    db().prepare("UPDATE posts SET product_id = ? WHERE product_id = ? AND original_text LIKE ?").run(to, p.id, `%${titleRe.source.replace(/\\b/g, "")}%`);
    n++;
  }
  return n;
}

/**
 * Já é nosso? Aprovado, já postado alguma vez, ou o mesmo perfume em outro tamanho (Le Male Elixir 75ml → 125ml).
 * Marca como aprovado e, sem foto escolhida, usa a foto do outro tamanho (o frasco é o mesmo).
 */
export function adoptKnown(productId: number): { approved: boolean; photo: boolean } {
  const p = db().prepare("SELECT id, name, ml, conc, tokens, approved, blocked, main_image_id FROM products WHERE id = ?").get(productId) as
    | { id: number; name: string; ml: number; conc: string | null; tokens: string; approved: number | null; blocked: number; main_image_id: number | null }
    | undefined;
  if (!p || p.blocked) return { approved: false, photo: false };
  const sent = (id: number) => !!db().prepare("SELECT 1 FROM posts WHERE product_id = ? AND status = 'sent' LIMIT 1").get(id);
  let approved = p.approved === 1 || sent(p.id);
  let photo = false;
  const me = perfumeInfo(p.name) ?? { ml: p.ml, conc: p.conc, tokens: JSON.parse(p.tokens || "[]") as string[], key: "" };
  if (!approved || !p.main_image_id) {
    const sibs = db()
      .prepare(
        `SELECT id, name, ml, conc, tokens, approved, main_image_id FROM products
         WHERE id != ? AND blocked = 0 AND (approved = 1 OR main_image_id IS NOT NULL OR EXISTS (SELECT 1 FROM posts q WHERE q.product_id = products.id AND q.status = 'sent'))`,
      )
      .all(p.id) as { id: number; name: string; ml: number; conc: string | null; tokens: string; approved: number | null; main_image_id: number | null }[];
    for (const s2 of sibs) {
      const o = perfumeInfo(s2.name) ?? { ml: s2.ml, conc: s2.conc, tokens: JSON.parse(s2.tokens || "[]") as string[], key: "" };
      if (!samePerfume({ ...me, ml: o.ml }, o)) continue;
      if (!approved && (s2.approved === 1 || sent(s2.id))) approved = true;
      if (!p.main_image_id && s2.main_image_id && !photo) {
        db().prepare("UPDATE products SET main_image_id = ? WHERE id = ? AND main_image_id IS NULL").run(s2.main_image_id, p.id);
        photo = true;
        log("info", `Agente de nomes: ${p.name} usa a foto de ${s2.name}`);
      }
      if (approved && (p.main_image_id || photo)) break;
    }
  }
  if (approved && p.approved !== 1) db().prepare("UPDATE products SET approved = 1 WHERE id = ?").run(p.id);
  return { approved, photo };
}

/** Passa pelos posts "para aprovar" e "esperando foto": o que já é nosso segue sozinho. */
async function sweepKnown(): Promise<number> {
  let n = 0;
  const rows = db().prepare("SELECT id, product_id, status FROM posts WHERE status IN ('review','photo') AND product_id IS NOT NULL").all() as { id: number; product_id: number; status: string }[];
  for (const r of rows) {
    try {
      const k = adoptKnown(r.product_id);
      if (r.status === "review" && k.approved) {
        log("info", `Agente de nomes: post #${r.id} já é perfume nosso → ${await approveReview(r.id)}`);
        n++;
      } else if (r.status === "photo" && chosenImagePath(r.product_id)) {
        const res = await releaseWaiting(r.product_id);
        if (res) (log("info", `Agente de nomes: post #${r.id} já tinha foto → ${res}`), n++);
      }
    } catch (e) {
      log("warn", `Agente de nomes: ${(e as Error).message}`);
    }
  }
  return n;
}

export function syncNames(): number {
  const c = cleanProductNames();
  const m = mergeDuplicateProducts();
  void sweepKnown().then((k) => k && log("info", `Agente de nomes: ${k} post(s) liberado(s) por já serem perfumes nossos`));
  if (c || m) log("info", `Agente de nomes: ${c} nome(s) limpo(s), ${m} perfume(s) repetido(s) juntado(s)`);
  return m;
}

export function mergeDuplicateProducts(): number {
  const rows = db()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.id) n,
        (SELECT 1 FROM pin_photos f WHERE f.product_id = p.id AND f.status = 'approved' LIMIT 1) pin FROM products p ORDER BY p.ml, p.id`,
    )
    .all() as (ProductRow & { main_image_id: number | null; n: number; pin: number | null })[];
  const infos = rows.map((r) => ({ r, a: { ml: r.ml, conc: r.conc, tokens: JSON.parse(r.tokens) as string[], key: r.pkey }, b: perfumeInfo(r.name) }));
  type FR = { frag_url?: string | null };
  const concOk = (a: string | null, b: string | null) => (a === "parfum") === (b === "parfum") && (!a || !b || a === b || (["colonia", "edt"].includes(a) && ["colonia", "edt"].includes(b)));
  const gen = (n: string) => (/\b(feminino|feminina|women|woman|femme|for her)\b/i.test(n) ? "f" : /\b(masculino|masculina|men|man|homme|for him)\b/i.test(n) ? "m" : null);
  const same = (x: (typeof infos)[number], y: (typeof infos)[number]) =>
    !(gen(x.r.name) && gen(y.r.name) && gen(x.r.name) !== gen(y.r.name)) && (
    // mesma página da Fragrantica, mesmo ml: mesmo perfume
    (Boolean((x.r as FR).frag_url) && (x.r as FR).frag_url === (y.r as FR).frag_url && x.r.ml === y.r.ml && concOk(x.r.conc, y.r.conc)) ||
    samePerfume(x.a, y.a) ||
    (x.b && y.b ? samePerfume(x.b, y.b) : false));
  const gone = new Set<number>();
  const touchedKeep = new Set<number>();
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
        const fk = (keep.r as FR).frag_url, fd = (drop.r as FR).frag_url;
        const name = fk ? keep.r.name : fd ? drop.r.name : nameQuality(drop.r.name) > nameQuality(keep.r.name) ? drop.r.name : keep.r.name;
        if (!fk && fd) tx.prepare("UPDATE products SET frag_name = (SELECT frag_name FROM products WHERE id = ?), frag_brand = (SELECT frag_brand FROM products WHERE id = ?), frag_url = ? WHERE id = ?").run(d, d, fd, k);
        tx.prepare("UPDATE products SET main_image_id = ?, last_posted_at = ?, name = ? WHERE id = ?").run(main, last, name, k);
        // já aprovado no nosso leque (de qualquer um dos dois cadastros): continua aprovado
        tx.prepare("UPDATE products SET approved = CASE WHEN COALESCE(approved,0) = 1 OR (SELECT COALESCE(approved,0) FROM products WHERE id = ?) = 1 THEN 1 ELSE approved END WHERE id = ?").run(d, k);
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
      touchedKeep.add(k);
    }
  }
  // agente de nomes: o post que esperava aprovação/foto de um perfume que já temos segue sozinho
  if (touchedKeep.size) setTimeout(() => void continueMergedPosts([...touchedKeep]), 0);
  // guarda as palavras do nome com as regras atuais (marca escrita errada fica de fora), para os próximos anúncios acharem
  const up = db().prepare("UPDATE products SET tokens = ? WHERE id = ?");
  for (const x of infos)
    if (!gone.has(x.r.id) && !(x.r as FR).frag_url && x.b && x.b.ml === x.r.ml && JSON.stringify(x.b.tokens) !== x.r.tokens) up.run(JSON.stringify(x.b.tokens), x.r.id);
  return merged;
}
