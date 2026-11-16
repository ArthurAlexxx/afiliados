/**
 * Preço real de cada perfume: o que os grupos cobram de verdade ("POR"), nunca o "DE" do anúncio.
 * Mediana dos últimos 30 dias, com pelo menos 5 preços de 2 grupos. Preços absurdos (kit, miniatura,
 * leitura errada) ficam de fora.
 */
import { db } from "./db.ts";

export type PriceLabel = "normal" | "boa" | "otima";
export type RealPrice = {
  ref: number;
  samples: number;
  groups: number;
  min: number;
  max: number;
};

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export function realPrice(productId: number, days = 30): RealPrice | null {
  const rows = db()
    .prepare("SELECT price, group_jid FROM offers WHERE product_id = ? AND price > 0 AND created_at >= datetime('now', ?)")
    .all(productId, `-${days} days`) as { price: number; group_jid: string }[];
  if (rows.length < 5) return null;
  const m0 = median(rows.map((r) => r.price));
  const ok = rows.filter((r) => r.price >= m0 * 0.5 && r.price <= m0 * 2);
  const groups = new Set(ok.map((r) => r.group_jid)).size;
  if (ok.length < 5 || groups < 2) return null;
  const prices = ok.map((r) => r.price);
  return { ref: Math.round(median(prices) * 100) / 100, samples: ok.length, groups, min: Math.min(...prices), max: Math.max(...prices) };
}

/** Desconto real: quanto abaixo do preço real (0,25 = 25% abaixo). */
export function realDiscount(price: number | null, rp: RealPrice | null) {
  if (!price || !rp) return null;
  return 1 - price / rp.ref;
}

export function priceLabel(d: number | null): PriceLabel | null {
  if (d == null) return null;
  if (d >= 0.2) return "otima";
  if (d >= 0.08) return "boa";
  return "normal";
}

/** "DE" inflado: o grupo anunciou um preço antigo muito acima do preço real. */
export function inflatedOldPrice(oldPrice: number | null, rp: RealPrice | null) {
  return Boolean(oldPrice && rp && oldPrice > rp.ref * 1.5);
}

/** Menor preço que NÓS já postamos hoje desse perfume (para não postar algo pior no mesmo dia). */
export function ourBestToday(productId: number): number | null {
  const rows = db()
    .prepare(
      "SELECT data_json FROM posts WHERE product_id = ? AND status = 'sent' AND date(created_at, '-3 hours') = date('now', '-3 hours')",
    )
    .all(productId) as { data_json: string }[];
  let best: number | null = null;
  for (const r of rows) {
    try {
      const p = JSON.parse(r.data_json).curation?.bestPrice;
      if (typeof p === "number" && (best == null || p < best)) best = p;
    } catch {
      /* ignora */
    }
  }
  return best;
}
