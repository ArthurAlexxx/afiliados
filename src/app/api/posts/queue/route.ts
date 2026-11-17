import { db } from "@/lib/db";
import { getSettings, getState } from "@/lib/settings";
import { inActiveWindow } from "@/lib/pipeline";
import { POST_SELECT, postViewer, type P } from "@/lib/postview";

export const dynamic = "force-dynamic";

/** Fila de posts: o que está saindo, o que espera foto e os últimos enviados, com a previsão de horário. */
export function GET() {
  const s = getSettings();
  const sel = POST_SELECT;
  const slim = postViewer();
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
