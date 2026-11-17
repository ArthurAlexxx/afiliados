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
};

/** Fila de posts: o que está saindo, o que espera foto e os últimos enviados, com a previsão de horário. */
export function GET() {
  const s = getSettings();
  const sel = `SELECT q.id, q.product_id, p.name, q.source_name, q.formatted_text, q.media_path IS NOT NULL has_media, substr(COALESCE(q.media_path,''), -28) mv, q.status, q.reason,
                      q.created_at, q.sent_at, q.data_json, p.main_image_id main
               FROM posts q LEFT JOIN products p ON p.id = q.product_id`;
  const slim = (r: P) => {
    let price: number | null = null, discount: number | null = null, link: string | null = null;
    try {
      const j = JSON.parse(r.data_json || "{}");
      price = j?.curation?.bestPrice ?? null;
      discount = j?.curation?.discount ?? (Number(j?.data?.desconto_pct) || null);
      link = j?.data?.link ?? null;
    } catch {}
    const { data_json: _d, ...rest } = r;
    return { ...rest, price, discount, link };
  };
  const queued = (db().prepare(`${sel} WHERE q.status IN ('sending','queued') ORDER BY q.status = 'sending' DESC, q.id`).all() as P[]).map(slim);
  const waiting = (db().prepare(`${sel} WHERE q.status = 'photo' ORDER BY q.id DESC`).all() as P[]).map(slim);
  const sent = (db().prepare(`${sel} WHERE q.status = 'sent' ORDER BY q.sent_at DESC LIMIT 8`).all() as P[]).map(slim);
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
