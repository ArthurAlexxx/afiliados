/**
 * Grupo de ofertas boas (teste 2, pedido do Arthur em 22/nov).
 *
 * Lê as promoções de TODOS os grupos de perfume, guarda o preço de cada uma (tabela offers)
 * e só publica no grupo marcado como "ofertas" quando o preço está realmente bom contra o
 * que os grupos costumam anunciar nos últimos 30 dias.
 */
import { db, log } from "./db.ts";
import { getSettings, getState, setState } from "./settings.ts";
import { formatPrice } from "./parser.ts";
import { notPerfume, perfumeOrigin } from "./perfume.ts";
import type { OfferRow, RankItem } from "./curation.ts";

export type DealRules = {
  /** quanto abaixo do preço normal (mediana) para contar como boa: 0,12 = 12% */
  minPct: number;
  /** a partir daqui é ótima e sai mesmo sem ser o menor preço do mês */
  greatPct: number;
  /** boa só sai se estiver perto do menor preço do mês (min × isso) */
  nearMin: number;
  /** histórico mínimo: dias-grupo com preço e grupos diferentes */
  minSamples: number;
  minGroups: number;
  /** não repete o mesmo perfume nessas horas, a não ser que fique pelo menos 5% mais barato */
  repeatHours: number;
  /** contra o quê comparar: 1 = o "DE" (preço cheio) que os grupos anunciam (Arthur, 22/nov); 2 = o "POR" de sempre */
  base: number;
};

export const DEFAULT_RULES: DealRules = { minPct: 0.12, greatPct: 0.2, nearMin: 1.03, minSamples: 5, minGroups: 2, repeatHours: 24, base: 1 };

export function dealRules(): DealRules {
  try {
    return { ...DEFAULT_RULES, ...JSON.parse(getState("dealRules") || "{}") };
  } catch {
    return DEFAULT_RULES;
  }
}

export function setDealRules(r: Partial<DealRules>) {
  const cur = dealRules();
  const next = { ...cur };
  for (const k of Object.keys(DEFAULT_RULES) as (keyof DealRules)[]) {
    const v = Number(r[k]);
    if (r[k] != null && Number.isFinite(v) && v > 0) next[k] = v;
  }
  setState("dealRules", JSON.stringify(next));
  return next;
}

export function dealsGroup() {
  return db().prepare("SELECT jid, name FROM groups WHERE role = 'deals' ORDER BY name LIMIT 1").get() as { jid: string; name: string } | undefined;
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export type DealPrice = { median: number; min: number; samples: number; groups: number; de: number | null; deSamples: number };

/**
 * Banco de preços: o preço "POR" que cada grupo anunciou nos últimos 30 dias.
 * Um grupo que repete a mesma oferta várias vezes no dia conta uma vez só (o menor preço do dia),
 * e preços absurdos (menos da metade ou mais do dobro da mediana) ficam de fora.
 * `before` deixa a promoção que está sendo avaliada (e as repetições dela) fora da conta.
 */
export function dealPrice(productId: number, before = "datetime('now','-6 hours')", days = 30): DealPrice | null {
  const rows = db()
    .prepare(
      `SELECT group_jid, date(created_at, '-3 hours') d, MIN(price) price FROM offers
       WHERE product_id = ? AND price > 0 AND created_at >= datetime('now', ?) AND created_at < ${before}
       GROUP BY group_jid, d`,
    )
    .all(productId, `-${days} days`) as { group_jid: string; d: string; price: number }[];
  if (rows.length < 3) return null;
  // "DE" (preço cheio) anunciado pelos grupos: mediana, um por grupo por dia, sem os absurdos
  const deRows = db()
    .prepare(
      `SELECT group_jid, date(created_at, '-3 hours') d, MAX(old_price) old FROM offers
       WHERE product_id = ? AND old_price > price AND price > 0 AND created_at >= datetime('now', ?) AND created_at < ${before}
       GROUP BY group_jid, d`,
    )
    .all(productId, `-${days} days`) as { old: number }[];
  const m0 = median(rows.map((r) => r.price));
  const ok = rows.filter((r) => r.price >= m0 * 0.5 && r.price <= m0 * 2);
  if (!ok.length) return null;
  const prices = ok.map((r) => r.price);
  const med = median(prices);
  const des = deRows.map((r) => r.old).filter((x) => x >= med && x <= med * 3);
  return {
    median: Math.round(med * 100) / 100,
    min: Math.min(...prices),
    samples: ok.length,
    groups: new Set(ok.map((r) => r.group_jid)).size,
    de: des.length >= 3 ? Math.round(median(des) * 100) / 100 : null,
    deSamples: des.length,
  };
}

export type DealVerdict = { ok: boolean; why: string; pct?: number; label?: "boa" | "otima"; ref?: DealPrice; refPrice?: number; byDe?: boolean };

/** A regra em si (sem efeito colateral), usada na hora e na simulação da tela. */
export function judgeDeal(price: number, ref: DealPrice | null, r: DealRules = dealRules()): DealVerdict {
  if (!ref || ref.samples < r.minSamples || ref.groups < r.minGroups)
    return { ok: false, why: `pouco histórico (${ref?.samples || 0} preços em ${ref?.groups || 0} grupo(s))`, ref: ref || undefined };
  if (r.base === 1) {
    // comparado com o "DE" que os grupos anunciam; mas nunca acima do preço final de sempre
    if (!ref.de) return { ok: false, why: `os grupos não anunciam "DE" desse perfume (${ref.deSamples})`, ref };
    const pct = 1 - price / ref.de;
    const great = pct >= r.greatPct;
    if (pct < r.minPct) return { ok: false, why: `${Math.round(pct * 100)}% abaixo do DE (R$ ${formatPrice(ref.de)}), precisa de ${Math.round(r.minPct * 100)}%`, pct, ref, refPrice: ref.de, byDe: true };
    if (price > ref.median * 1.02) return { ok: false, why: `${Math.round(pct * 100)}% abaixo do DE, mas acima do preço final de sempre (R$ ${formatPrice(ref.median)})`, pct, ref, refPrice: ref.de, byDe: true };
    return { ok: true, why: `${Math.round(pct * 100)}% abaixo do DE (R$ ${formatPrice(ref.de)})`, pct, label: great ? "otima" : "boa", ref, refPrice: ref.de, byDe: true };
  }
  const pct = 1 - price / ref.median;
  const great = pct >= r.greatPct;
  if (pct < r.minPct) return { ok: false, why: `${Math.round(pct * 100)}% abaixo do normal (R$ ${formatPrice(ref.median)}), precisa de ${Math.round(r.minPct * 100)}%`, pct, ref, refPrice: ref.median };
  if (!great && price > ref.min * r.nearMin)
    return { ok: false, why: `${Math.round(pct * 100)}% abaixo do normal, mas já saiu por R$ ${formatPrice(ref.min)} no mês`, pct, ref, refPrice: ref.median };
  return { ok: true, why: `${Math.round(pct * 100)}% abaixo do normal (R$ ${formatPrice(ref.median)})`, pct, label: great ? "otima" : "boa", ref, refPrice: ref.median };
}

/** Promoção nova de qualquer grupo: se for realmente boa, vira post do grupo de ofertas boas. */
export async function dealCheck(productId: number, messageId: string): Promise<string> {
  const g = dealsGroup();
  if (!g) return "";
  const s = getSettings();
  const offer = db().prepare("SELECT * FROM offers WHERE product_id = ? AND message_id = ?").get(productId, messageId) as OfferRow | undefined;
  if (!offer?.price || !offer.url) return "";
  const p = db().prepare("SELECT id, name, ml, blocked, last_posted_at FROM products WHERE id = ?").get(productId) as
    | { id: number; name: string; ml: number; blocked: number; last_posted_at: string | null }
    | undefined;
  if (!p || p.blocked) return "";
  const firstLine = offer.text.split("\n").find((l) => l.trim()) || "";
  if (notPerfume(`${p.name}\n${firstLine}`)) return "";

  const ref = dealPrice(productId);
  const v = judgeDeal(offer.price, ref);
  if (!v.ok) return "";
  const { inActiveWindow } = await import("./pipeline.ts");
  if (!inActiveWindow(s)) return `${p.name} R$ ${formatPrice(offer.price)}: boa, mas fora do horário`;

  // não repete o perfume no dia, a não ser que caia mais 5%
  const r = dealRules();
  const prev = db()
    .prepare(
      `SELECT id, data_json, created_at FROM posts WHERE product_id = ? AND dest = ? AND status IN ('review','photo','queued','sending','sent')
       AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1`,
    )
    .get(productId, g.jid, `-${r.repeatHours} hours`) as { id: number; data_json: string; created_at: string } | undefined;
  if (prev) {
    let prevPrice = 0;
    try {
      prevPrice = Number(JSON.parse(prev.data_json)?.curation?.bestPrice) || 0;
    } catch {}
    const minutes = (Date.now() - new Date(prev.created_at.replace(" ", "T") + "Z").getTime()) / 60e3;
    if (minutes < 30 || !prevPrice || offer.price > prevPrice * 0.95) return `${p.name}: já saiu no grupo de ofertas (#${prev.id})`;
  }

  const ml = v.ref!;
  // Arthur (22/nov): só é boa oferta se estiver abaixo da média do que os outros grupos postaram
  const others = othersAvg(productId, offer.group_jid);
  if (others && offer.price > others.avg * 0.97) return "";
  const pct = Math.round(v.pct! * 100);
  // "Baixou X%" do post = o de/por do próprio post
  const ownPct = offer.old_price && offer.old_price > offer.price ? Math.round((1 - offer.price / offer.old_price) * 100) : null;
  const groupsAll = (db().prepare("SELECT COUNT(DISTINCT group_jid) n FROM offers WHERE product_id = ? AND created_at >= datetime('now','-30 days')").get(productId) as { n: number }).n;
  const item: RankItem = {
    productId,
    name: p.name,
    ml: p.ml,
    posts: ml.samples,
    groups: groupsAll,
    recentGroups: 1,
    minPrice: ml.min,
    medianPrice: v.refPrice ?? ml.median,
    best: offer,
    bestPrice: offer.price,
    pctVsMedian: ownPct == null ? 0 : v.pct!,
    declaredPct: ownPct,
    image: null,
    images: 0,
    lastPostedAt: p.last_posted_at,
    coolingDown: false,
    eligible: true,
    why: "",
    sales: null,
    origin: perfumeOrigin(`${p.name}\n${offer.text.slice(0, 400)}`),
    real: { ref: v.refPrice ?? ml.median, samples: ml.samples, groups: ml.groups, discount: v.pct!, label: v.label!, inflated: false },
    score: 0,
  };
  const extraLine = dealLine(offer.price, ml, v.label!, others);
  const { createCuratedPost } = await import("./curation.ts");
  const res = await createCuratedPost(item, s, { follow: `Ofertas boas (${v.why})`, dest: g.jid, destName: g.name, extraLine });
  log("info", `Ofertas boas: ${p.name} R$ ${formatPrice(offer.price)} de ${offer.group_name} · ${v.why} → #${res.id} ${res.status}`);
  if (res.status === "queued") {
    const { processDeals } = await import("./pipeline.ts");
    void processDeals();
  }
  return `#${res.id} ${p.name} R$ ${formatPrice(offer.price)} (${v.why}) → ${res.status}`;
}

/**
 * Simulação para a tela: das promoções dos últimos `hours`, quais teriam saído com as regras atuais.
 * Usa o histórico até 6h antes de cada promoção (igual à regra ao vivo).
 */
/**
 * Arthur (22/nov): a comparação é a MÉDIA do preço final ("por") que os outros grupos postaram desse perfume
 * nos últimos 30 dias, sem o grupo de onde veio a oferta (senão parece que copiamos o "de" do próprio post).
 * Um valor por grupo por dia (o menor), sem os absurdos.
 */
export function othersAvg(productId: number, excludeGroup: string | null, days = 30): { avg: number; groups: number; samples: number } | null {
  const rows = db()
    .prepare(
      `SELECT group_jid, date(created_at, '-3 hours') d, MIN(price) price FROM offers
       WHERE product_id = ? AND price > 0 AND created_at >= datetime('now', ?) AND group_jid IS NOT ?
       GROUP BY group_jid, d`,
    )
    .all(productId, `-${days} days`, excludeGroup) as { group_jid: string; price: number }[];
  if (!rows.length) return null;
  const m = median(rows.map((r) => r.price));
  const ok = rows.filter((r) => r.price >= m * 0.5 && r.price <= m * 2);
  if (!ok.length) return null;
  const avg = ok.reduce((a, r) => a + r.price, 0) / ok.length;
  return { avg: Math.round(avg * 100) / 100, groups: new Set(ok.map((r) => r.group_jid)).size, samples: ok.length };
}

/** A faixa "📉 Boa/Ótima oferta" (sempre aparece): média dos outros grupos, sem número de grupos; % só a partir de 10%. */
export function dealLine(price: number, ml: DealPrice, label: "boa" | "otima", others: { avg: number; groups: number } | null): string {
  const title = label === "otima" ? "Ótima oferta" : "Boa oferta";
  const ref = others?.avg ?? ml.median;
  const cheaper = Math.round((1 - price / ref) * 100);
  const base = `📉 ${title}: a média de promoção dos outros grupos é de R$ ${formatPrice(ref)}`;
  return cheaper >= 10 ? `${base}. Aqui está ${cheaper}% mais barato` : base;
}

/**
 * Arthur (22/nov): "reposte os que sairam sem essa info". Copia os posts do grupo de ofertas que saíram
 * sem a faixa, já com ela, e põe na fila (sai um a cada 90s). As mensagens antigas ficam.
 */
export async function repostMissingLine(hours = 24, dry = false) {
  const g = dealsGroup();
  if (!g) return { ok: false, error: "sem grupo de ofertas", reposted: [] as number[] };
  const { withLineBeforeLink } = await import("./curation.ts");
  const rows = db()
    .prepare(
      `SELECT * FROM posts WHERE dest = ? AND status = 'sent' AND sent_at >= datetime('now', ?)
       AND formatted_text NOT LIKE '%📉%oferta%' ORDER BY id`,
    )
    .all(g.jid, `-${hours} hours`) as Record<string, unknown>[];
  const r = dealRules();
  const out: { id: number; newId?: number; line?: string; why?: string }[] = [];
  for (const p of rows) {
    const id = Number(p.id);
    // já tem repost na fila ou enviado
    const dup = db().prepare("SELECT id FROM posts WHERE message_id = ?").get(`repost-${id}`);
    if (dup) { out.push({ id, why: "já repostado" }); continue; }
    let price = 0, label: "boa" | "otima" | undefined;
    try {
      const j = JSON.parse(String(p.data_json));
      price = Number(j.curation?.bestPrice) || 0;
      label = j.curation?.real?.label;
    } catch {}
    const ml = p.product_id ? dealPrice(Number(p.product_id), "datetime('now')") : null;
    if (!price || !ml) { out.push({ id, why: "sem preço de referência" }); continue; }
    const v = judgeDeal(price, ml, r);
    const pct = Math.round((v.pct ?? Math.max(0, 1 - price / (ml.de ?? ml.median))) * 100);
    const line = dealLine(price, ml, label || v.label || (pct >= r.greatPct * 100 ? "otima" : "boa"), othersAvg(Number(p.product_id), (p.source_jid as string) || null));
    if (dry) { out.push({ id, line }); continue; }
    const info = db()
      .prepare(
        `INSERT INTO posts (message_id, source_jid, source_name, original_text, formatted_text, data_json,
          media_path, media_mime, product_key, product_id, origin, status, reason, dest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deal', 'queued', ?, ?)`,
      )
      .run(
        `repost-${id}`, p.source_jid as string, p.source_name as string, p.original_text as string,
        withLineBeforeLink(String(p.formatted_text), line), p.data_json as string,
        (p.media_path as string) ?? null, (p.media_mime as string) ?? null, (p.product_key as string) ?? null,
        (p.product_id as number) ?? null, `Repost de #${id} com a faixa de oferta`, g.jid,
      );
    out.push({ id, newId: Number(info.lastInsertRowid), line });
  }
  if (!dry) log("info", `Ofertas boas: repost de ${out.filter((o) => o.newId).length} post(s) sem a faixa`);
  return { ok: true, checked: rows.length, reposted: out };
}

export function simulateDeals(hours = 48, rules: DealRules = dealRules()) {
  const offers = db()
    .prepare(
      `SELECT o.id, o.product_id, o.group_name, o.price, o.created_at, p.name, p.blocked FROM offers o JOIN products p ON p.id = o.product_id
       WHERE o.price > 0 AND o.url IS NOT NULL AND o.created_at >= datetime('now', ?) ORDER BY o.created_at`,
    )
    .all(`-${hours} hours`) as { id: number; product_id: number; group_name: string; price: number; created_at: string; name: string; blocked: number }[];
  const out: { at: string; name: string; group: string; price: number; ref: number; pct: number; label: string }[] = [];
  const lastBy = new Map<number, { t: number; price: number }>();
  let checked = 0;
  for (const o of offers) {
    if (o.blocked || notPerfume(o.name)) continue;
    checked++;
    const ref = dealPrice(o.product_id, `datetime('${o.created_at}', '-6 hours')`);
    const v = judgeDeal(o.price, ref, rules);
    if (!v.ok) continue;
    const t = new Date(o.created_at.replace(" ", "T") + "Z").getTime();
    const prev = lastBy.get(o.product_id);
    if (prev && t - prev.t < rules.repeatHours * 3600e3 && (t - prev.t < 30 * 60e3 || o.price > prev.price * 0.95)) continue;
    lastBy.set(o.product_id, { t, price: o.price });
    out.push({ at: o.created_at, name: o.name, group: o.group_name, price: o.price, ref: v.refPrice ?? v.ref!.median, pct: Math.round(v.pct! * 100), label: v.label! });
  }
  return { checked, deals: out.reverse() };
}
