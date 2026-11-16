import { db } from "@/lib/db";
import { getSettings, getState } from "@/lib/settings";
import { inActiveWindow } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export function GET() {
  const d = db();
  const rows = d.prepare("SELECT status, COUNT(*) c FROM posts GROUP BY status").all() as { status: string; c: number }[];
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = r.c;
  const today = d
    .prepare(
      `SELECT
         SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent,
         COUNT(*) captured
       FROM posts WHERE date(created_at, '-3 hours') = date('now', '-3 hours')`,
    )
    .get() as { sent: number | null; captured: number };
  const days = d
    .prepare(
      `SELECT date(created_at, '-3 hours') day,
              COUNT(*) captured,
              SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent
       FROM posts WHERE created_at >= datetime('now', '-14 days')
       GROUP BY day ORDER BY day`,
    )
    .all() as { day: string; captured: number; sent: number }[];
  const bySource = d
    .prepare(
      `SELECT COALESCE(source_name, source_jid) name, COUNT(*) captured,
              SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent
       FROM posts WHERE created_at >= datetime('now', '-7 days')
       GROUP BY source_jid ORDER BY captured DESC LIMIT 6`,
    )
    .all();
  const groups = d.prepare("SELECT role, COUNT(*) c FROM groups GROUP BY role").all() as { role: string; c: number }[];
  const s = getSettings();
  const last = Number(getState("lastSentAt") || 0);
  return Response.json({
    counts,
    today: { sent: today.sent || 0, captured: today.captured || 0 },
    days,
    bySource,
    groups: Object.fromEntries(groups.map((g) => [g.role, g.c])),
    config: {
      evolution: Boolean(s.evolutionUrl && s.evolutionApiKey && s.evolutionInstance),
      meli: s.meliStrategy === "generator" ? Boolean(s.meliCookie) : Boolean(s.meliTag),
      sendMode: s.sendMode,
      inWindow: inActiveWindow(s),
      activeFrom: s.activeFrom,
      activeTo: s.activeTo,
      minIntervalSeconds: s.minIntervalSeconds,
    },
    lastSentAt: last || null,
  });
}
