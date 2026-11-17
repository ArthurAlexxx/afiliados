import { db } from "@/lib/db";
import { getSettings, getState } from "@/lib/settings";
import { inActiveWindow } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

type P = {
  id: number;
  product_id: number | null;
  name: string | null;
  source_name: string;
  formatted_text: string;
  has_media: number;
  status: string;
  reason: string | null;
  created_at: string;
  sent_at: string | null;
  data_json: string;
  main: number | null;
  mv: string;
  original_text: string;
};

const srcOffer = () =>
  db().prepare(
    `SELECT group_name, created_at, price, old_price, pct, coupon, url FROM offers
     WHERE product_id = ? AND (text = ? OR price = ?) ORDER BY (text = ?) DESC, id DESC LIMIT 1`,
  );
const otherGroups = () =>
  db().prepare(
    `SELECT group_name g, MIN(price) price, MAX(created_at) at, COUNT(*) n FROM offers
     WHERE product_id = ? AND created_at >= datetime(?, '-1 day') AND created_at <= datetime(?, '+5 minutes')
     GROUP BY group_name ORDER BY price IS NULL, price, at DESC LIMIT 8`,
  );

/** Fila de posts: o que está saindo, o que espera foto e os últimos enviados, com a previsão de horário. */
export function GET() {
  const s = getSettings();
  const sel = `SELECT q.id, q.product_id, p.name, q.source_name, q.formatted_text, q.media_path IS NOT NULL has_media, substr(COALESCE(q.media_path,''), -28) mv, q.status, q.reason,
                      q.created_at, q.sent_at, q.data_json, q.original_text, p.main_image_id main
               FROM posts q LEFT JOIN products p ON p.id = q.product_id`;
  const so = srcOffer(), og = otherGroups();
  const slim = (r: P, detailed = false) => {
    let price: number | null = null, discount: number | null = null, link: string | null = null;
    let cur: Record<string, unknown> | null = null, agent: { reason?: string; by?: string } | null = null;
    try {
      const j = JSON.parse(r.data_json || "{}");
      price = j?.curation?.bestPrice ?? null;
      discount = j?.curation?.discount ?? (Number(j?.data?.desconto_pct) || null);
      link = j?.data?.link ?? null;
      cur = j?.curation ?? null;
      agent = j?.agent ?? null;
    } catch {}
    const { data_json: _d, original_text: orig, ...rest } = r;
    if (!detailed) return { ...rest, price, discount, link };
    const src = r.product_id
      ? (so.get(r.product_id, orig, price ?? -1, orig) as
          | { group_name: string; created_at: string; price: number | null; old_price: number | null; pct: number | null; coupon: string | null; url: string | null }
          | undefined) ?? null
      : null;
    const groups = r.product_id ? (og.all(r.product_id, r.created_at, r.created_at) as { g: string; price: number | null; at: string; n: number }[]) : [];
    const real = (cur?.real ?? null) as { ref: number; samples: number; groups: number; label: string | null; inflated: boolean } | null;
    return {
      ...rest,
      price,
      discount,
      link,
      detail: {
        source: src,
        groups,
        score: (cur?.score as number) ?? null,
        median: (cur?.medianPrice as number) ?? null,
        realRef: real?.ref ?? null,
        realSamples: real?.samples ?? null,
        realLabel: real?.label ?? null,
        inflated: real?.inflated ?? false,
        origin: (cur?.origin as string) ?? null,
        seenGroups: (cur?.groups as number) ?? null,
        agent: agent?.reason ?? null,
        photo: (cur?.image as string) ?? null,
      },
    };
  };
  const queued = (db().prepare(`${sel} WHERE q.status IN ('sending','queued') ORDER BY q.status = 'sending' DESC, q.id`).all() as P[]).map((r) => slim(r, true));
  const waiting = (db().prepare(`${sel} WHERE q.status = 'photo' ORDER BY q.id DESC`).all() as P[]).map((r) => slim(r));
  const sent = (db().prepare(`${sel} WHERE q.status = 'sent' ORDER BY q.sent_at DESC LIMIT 8`).all() as P[]).map((r) => slim(r, true));
  const last = Number(getState("lastSentAt") || 0);
  const gap = s.minIntervalSeconds * 1000;
  const inWindow = inActiveWindow(s);
  // previsão: um post por intervalo, a partir do último envio
  let t = Math.max(Date.now(), last + gap);
  const eta = queued.map((q) => {
    if (q.status === "sending") return new Date().toISOString();
    const at = new Date(t).toISOString();
    t += gap;
    return at;
  });
  const counts = db().prepare("SELECT status, COUNT(*) n FROM posts GROUP BY status").all() as { status: string; n: number }[];
  return Response.json({
    queued: queued.map((q, i) => ({ ...q, eta: eta[i] })),
    waiting,
    sent,
    intervalSeconds: s.minIntervalSeconds,
    lastSentAt: last ? new Date(last).toISOString() : null,
    inWindow,
    window: s.activeFrom && s.activeTo ? `${s.activeFrom}–${s.activeTo}` : null,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  });
}
