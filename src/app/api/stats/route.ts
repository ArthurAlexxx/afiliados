import { db } from "@/lib/db";
import { getSettings, getState } from "@/lib/settings";
import { inActiveWindow } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export function GET() {
  const d = db();
  const rows = d.prepare("SELECT status, COUNT(*) c FROM posts GROUP BY status").all() as { status: string; c: number }[];
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = r.c;
  // "capturadas" = ofertas lidas nos grupos de origem; "enviadas" = posts que o agente aprovou e saíram
  const today = d
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM posts WHERE status='sent' AND date(created_at,'-3 hours') = date('now','-3 hours')) sent,
         (SELECT COUNT(*) FROM posts WHERE status IN ('skipped','duplicate') AND date(created_at,'-3 hours') = date('now','-3 hours')) rejected,
         (SELECT COUNT(*) FROM offers WHERE date(created_at,'-3 hours') = date('now','-3 hours')) captured`,
    )
    .get() as { sent: number | null; rejected: number | null; captured: number };
  const sentDays = d
    .prepare(
      `SELECT date(created_at, '-3 hours') day, SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) sent
       FROM posts WHERE created_at >= datetime('now', '-14 days') GROUP BY day`,
    )
    .all() as { day: string; sent: number }[];
  const capDays = d
    .prepare(`SELECT date(created_at, '-3 hours') day, COUNT(*) captured FROM offers WHERE created_at >= datetime('now', '-14 days') GROUP BY day`)
    .all() as { day: string; captured: number }[];
  const dayMap = new Map<string, { day: string; captured: number; sent: number }>();
  for (const r of capDays) dayMap.set(r.day, { day: r.day, captured: r.captured, sent: 0 });
  for (const r of sentDays) dayMap.set(r.day, { day: r.day, captured: dayMap.get(r.day)?.captured || 0, sent: r.sent || 0 });
  const days = [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day));
  const bySource = d
    .prepare(
      `SELECT o.group_name name, COUNT(*) captured,
              (SELECT COUNT(*) FROM posts p WHERE p.source_jid = o.group_jid AND p.status='sent' AND p.created_at >= datetime('now','-7 days')) sent
       FROM offers o WHERE o.created_at >= datetime('now', '-7 days')
       GROUP BY o.group_jid ORDER BY captured DESC LIMIT 8`,
    )
    .all();
  const groups = d.prepare("SELECT role, COUNT(*) c FROM groups GROUP BY role").all() as { role: string; c: number }[];
  const s = getSettings();
  const last = Number(getState("lastSentAt") || 0);
  return Response.json({
    counts,
    today: { sent: today.sent || 0, captured: today.captured || 0, rejected: today.rejected || 0 },
    days,
    bySource,
    groups: Object.fromEntries(groups.map((g) => [g.role, g.c])),
    config: {
      evolution: Boolean(s.evolutionUrl && s.evolutionApiKey && s.evolutionInstance),
      meli: s.meliStrategy === "generator" ? Boolean(s.meliCookie) : Boolean(s.meliTag),
      agent: s.anthropicApiKey || process.env.ANTHROPIC_API_KEY ? "claude" : "regras",
      perHour: s.curationPerHour,
      inWindow: inActiveWindow(s),
      activeFrom: s.activeFrom,
      activeTo: s.activeTo,
      minIntervalSeconds: s.minIntervalSeconds,
    },
    lastSentAt: last || null,
  });
}
