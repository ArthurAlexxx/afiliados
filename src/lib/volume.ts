/**
 * Volume de postagens de cada grupo: quantas mensagens ontem e hoje, e a média por hora.
 * Lê direto do histórico da Evolution (conta tudo que o grupo postou, não só as promoções de perfume).
 */
import { db, log } from "./db.ts";
import { getSettings } from "./settings.ts";
import { Evolution } from "./evolution.ts";

type Row = { jid: string; name: string; yesterday: number; today: number; yHours: Record<string, number>; activeHoursY: number };

function tzParts(tz: string, d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

export async function groupVolume(onlyJid?: string): Promise<{ rows: Row[]; hoursToday: number }> {
  const s = getSettings();
  const tz = s.timezone || "America/Sao_Paulo";
  const evo = new Evolution(s);
  const now = new Date();
  const today = tzParts(tz, now).day;
  const yDay = tzParts(tz, new Date(now.getTime() - 24 * 3600e3)).day;
  const since = Math.floor(now.getTime() / 1000) - 50 * 3600;
  const groups = db()
    .prepare("SELECT jid, name FROM groups WHERE role IN ('source','destination') OR name LIKE '%RP%'")
    .all() as { jid: string; name: string }[];
  const rows: Row[] = [];
  for (const g of groups) {
    if (onlyJid && g.jid !== onlyJid) continue;
    const r: Row = { jid: g.jid, name: g.name, yesterday: 0, today: 0, yHours: {}, activeHoursY: 0 };
    const seen = new Set<string>();
    for (let page = 1; page <= 20; page++) {
      let res;
      try {
        res = await evo.findMessagesSince(g.jid, since, 250, page);
      } catch (e) {
        log("warn", `Volume: ${g.name}: ${(e as Error).message}`);
        break;
      }
      for (const m of res.list as { key?: { id?: string }; messageType?: string; messageTimestamp?: number | string }[]) {
        const id = m.key?.id || "";
        if (seen.has(id)) continue;
        seen.add(id);
        if (/reaction|protocol|senderKeyDistribution|pollUpdate|edited/i.test(m.messageType || "")) continue;
        const ts = Number(m.messageTimestamp || 0);
        if (!ts) continue;
        const p = tzParts(tz, new Date(ts * 1000));
        if (p.day === today) r.today++;
        else if (p.day === yDay) {
          r.yesterday++;
          r.yHours[p.hour] = (r.yHours[p.hour] || 0) + 1;
        }
      }
      if (page >= res.pages || res.list.length < 250) break;
    }
    r.activeHoursY = Object.keys(r.yHours).length;
    rows.push(r);
  }
  rows.sort((a, b) => b.yesterday - a.yesterday);
  return { rows, hoursToday: tzParts(tz, now).hour + 1 };
}

/** Escreve o volume nos logs (roda uma vez depois de cada deploy). */
export async function logGroupVolume() {
  const { rows, hoursToday } = await groupVolume();
  for (const r of rows) {
    const peak = Object.entries(r.yHours).sort((a, b) => b[1] - a[1])[0];
    log(
      "info",
      `Volume ${r.name}: ontem ${r.yesterday} msgs (${(r.yesterday / 24).toFixed(1)}/h no dia, ${r.activeHoursY ? (r.yesterday / r.activeHoursY).toFixed(1) : 0}/h em ${r.activeHoursY}h ativas${peak ? `, pico ${peak[0]}h com ${peak[1]}` : ""}); hoje ${r.today} em ${hoursToday}h (${(r.today / hoursToday).toFixed(1)}/h)`,
    );
  }
}
