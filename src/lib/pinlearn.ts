/**
 * Treino da escolha automática das fotos do Pinterest, com as escolhas do Arthur.
 *
 * - Cada perfume em que ele escolheu uma foto do Pinterest é um exemplo: a escolhida contra as outras opções.
 * - O gosto aprendido = o que a escolhida tem a mais (ou a menos) que as outras, em média.
 * - Prova honesta (deixa-um-de-fora): para cada escolha dele, treina sem ela e vê se o sistema escolheria a mesma.
 * - O automático só liga sozinho quando acerta a maioria das escolhas dele.
 */
import fs from "node:fs";
import { db, log } from "./db.ts";
import { getState, setState } from "./settings.ts";
import { analyzeImage } from "./images.ts";
import { featuresOf, FEATS, FEAT_LABEL } from "./photoprefs.ts";

const KEYS = [...FEATS, "ref", "base"] as const;
type K = (typeof KEYS)[number];
type V = Record<K, number>;
type Row = { id: number; product_id: number; status: string; score: number; feat: string | null; ref_sim: number | null; flags: string | null; chosen_by?: string | null };
type Model = { n: number; mean: V; std: V; w: V };

export const AUTO_MIN = 8; // escolhas dele antes de o automático poder ligar
export const AUTO_RATE = 0.7; // acerto mínimo

const LABEL: Record<K, [string, string]> = {
  ...FEAT_LABEL,
  ref: ["mais parecida com a foto do anúncio", "menos parecida com a foto do anúncio"],
  base: ["nota técnica maior", "nota técnica menor"],
};

function vec(r: Row): V | null {
  if (!r.feat) return null;
  const f = JSON.parse(r.feat) as Record<string, number>;
  const v = {} as V;
  for (const k of FEATS) v[k] = f[k] ?? 0;
  v.ref = r.ref_sim ?? 0.5;
  v.base = r.score ?? 0;
  return v;
}

/** Medidas das fotos do Pinterest que ainda não têm (uma vez por foto). */
export async function pinFeatures(limit = 400) {
  const rows = db().prepare("SELECT id, path FROM pin_photos WHERE feat IS NULL AND path != '' LIMIT ?").all(limit) as { id: number; path: string }[];
  let n = 0;
  for (const r of rows) {
    try {
      if (!fs.existsSync(r.path)) throw new Error("sem arquivo");
      const a = await analyzeImage(fs.readFileSync(r.path));
      db().prepare("UPDATE pin_photos SET feat = ? WHERE id = ?").run(JSON.stringify(featuresOf(a)), r.id);
      n++;
    } catch {
      db().prepare("UPDATE pin_photos SET feat = '{}' WHERE id = ?").run(r.id);
    }
  }
  return n;
}

/** Perfumes em que o Arthur (não o automático) escolheu uma foto do Pinterest, com as opções que ele viu. */
function examples() {
  const rows = db()
    .prepare(
      `SELECT f.id, f.product_id, f.status, f.score, f.feat, f.ref_sim, f.flags, f.chosen_by, p.name FROM pin_photos f JOIN products p ON p.id = f.product_id
       WHERE f.path != '' AND f.status IN ('approved','rejected') AND (f.flags IS NULL OR f.status = 'approved') AND f.product_id IN
         (SELECT product_id FROM pin_photos WHERE status = 'approved' AND COALESCE(chosen_by, 'arthur') = 'arthur')
       ORDER BY f.product_id, f.id`,
    )
    .all() as (Row & { name: string })[];
  const by = new Map<number, (Row & { name: string })[]>();
  for (const r of rows) by.set(r.product_id, [...(by.get(r.product_id) || []), r]);
  const out: { pid: number; name: string; chosen: number; opts: { id: number; v: V }[] }[] = [];
  for (const [pid, rs] of by) {
    const chosen = rs.find((r) => r.status === "approved");
    const opts = rs.flatMap((r) => {
      const v = vec(r);
      return v ? [{ id: r.id, v }] : [];
    });
    if (chosen && opts.length >= 2 && opts.some((o) => o.id === chosen.id)) out.push({ pid, name: rs[0].name, chosen: chosen.id, opts });
  }
  return out;
}

function train(ex: ReturnType<typeof examples>): Model {
  const all = ex.flatMap((e) => e.opts.map((o) => o.v));
  const mean = {} as V, std = {} as V, w = {} as V;
  for (const k of KEYS) {
    const xs = all.map((v) => v[k]);
    mean[k] = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    std[k] = Math.sqrt(xs.reduce((a, b) => a + (b - mean[k]) ** 2, 0) / Math.max(1, xs.length)) || 1;
    w[k] = 0;
  }
  for (const e of ex) {
    const c = e.opts.find((o) => o.id === e.chosen)!.v;
    const others = e.opts.filter((o) => o.id !== e.chosen);
    for (const k of KEYS) w[k] += (c[k] - others.reduce((a, o) => a + o.v[k], 0) / others.length) / std[k];
  }
  if (ex.length) for (const k of KEYS) w[k] = Math.max(-1.5, Math.min(1.5, w[k] / ex.length));
  return { n: ex.length, mean, std, w };
}

function score(m: Model | null, v: V): number {
  if (!m?.n) return v.base; // sem treino: nota técnica
  let s = 0;
  for (const k of KEYS) s += m.w[k] * ((v[k] - m.mean[k]) / m.std[k]);
  return s;
}

let cached: { m: Model; at: number } | null = null;
function model(): Model {
  if (!cached || Date.now() - cached.at > 60_000) cached = { m: train(examples()), at: Date.now() };
  return cached.m;
}

/** A foto que o sistema escolheria entre as opções pendentes (sem suspeitas) do perfume. */
export function systemPick(productId: number): number | null {
  const rows = db().prepare("SELECT id, product_id, status, score, feat, ref_sim, flags FROM pin_photos WHERE product_id = ? AND status = 'pending' AND flags IS NULL AND path != ''").all(productId) as Row[];
  const m = model();
  let best: number | null = null, bs = -Infinity;
  for (const r of rows) {
    const v = vec(r);
    const s = v ? score(m, v) : (r.score ?? 0) - 1e6;
    if (s > bs) (bs = s), (best = r.id);
  }
  return best;
}

/** Prova honesta: para cada escolha dele, treina sem ela e vê se o sistema acertaria. */
export function evaluate() {
  const ex = examples();
  const res = ex.map((e) => {
    const m = train(ex.filter((x) => x !== e));
    const ranked = [...e.opts].sort((a, b) => score(m, b.v) - score(m, a.v));
    return { name: e.name, hit: ranked[0].id === e.chosen, top2: ranked.slice(0, 2).some((o) => o.id === e.chosen), opts: e.opts.length };
  });
  const hits = res.filter((r) => r.hit).length;
  const chance = res.reduce((a, r) => a + 1 / r.opts, 0);
  const m = train(ex);
  const likes = KEYS.map((k) => ({ k, w: m.w[k] }))
    .filter((x) => Math.abs(x.w) >= 0.3)
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .slice(0, 4)
    .map((x) => LABEL[x.k][x.w > 0 ? 0 : 1]);
  return { n: res.length, hits, top2: res.filter((r) => r.top2).length, chance: Math.round(chance), likes, res };
}

export function trainingStatus() {
  const e = evaluate();
  return { n: e.n, hits: e.hits, top2: e.top2, chance: e.chance, likes: e.likes, min: AUTO_MIN, rate: AUTO_RATE, auto: getState("pinAuto") === "1" };
}

/** Depois de cada escolha dele: registra se o sistema acertaria e liga o automático quando ele já acerta a maioria. */
export function afterChoice(productId: number, chosenId: number, systemId: number | null) {
  cached = null;
  const name = (db().prepare("SELECT name FROM products WHERE id = ?").get(productId) as { name: string } | undefined)?.name || `#${productId}`;
  const e = evaluate();
  log(
    "info",
    `Treino Pinterest: você escolheu a foto ${chosenId} de ${name}; o sistema escolheria ${systemId ?? "nenhuma"} (${systemId === chosenId ? "acertou" : "errou"}). ` +
      `Acerto nas suas ${e.n} escolhas: ${e.hits}/${e.n} (no chute seria ~${e.chance})${e.likes.length ? `. Você prefere: ${e.likes.join(", ")}` : ""}`,
  );
  maybeAuto(e);
}

function maybeAuto(e = evaluate()) {
  if (getState("pinAuto") === "1" || getState("pinAutoOffByArthur") === "1") return;
  if (e.n >= AUTO_MIN && e.hits / e.n >= AUTO_RATE) {
    setState("pinAuto", "1");
    log("info", `Treino Pinterest: o sistema acertou ${e.hits} de ${e.n} escolhas suas; escolha automática LIGADA`);
  }
}

/** Na subida: mede as fotos, mostra o relatório do treino e liga o automático se já merece. */
export async function trainOnStart() {
  const n = await pinFeatures(2000);
  const e = evaluate();
  log("info", `Treino Pinterest: ${n} foto(s) medidas. Suas escolhas do Pinterest: ${e.n}; o sistema acertaria ${e.hits} (top 2: ${e.top2}; no chute ~${e.chance})${e.likes.length ? `. Você prefere: ${e.likes.join(", ")}` : ""}`);
  for (const r of e.res) log("info", `Treino Pinterest: ${r.name}: ${r.hit ? "acertou" : r.top2 ? "2ª opção" : "errou"} (${r.opts} opções)`);
  maybeAuto(e);
}
