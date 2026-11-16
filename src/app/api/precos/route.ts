import { db } from "@/lib/db";
import { realPrice } from "@/lib/prices";
import { perfumeOrigin } from "@/lib/perfume";

export const dynamic = "force-dynamic";

type Off = { product_id: number; price: number; old_price: number | null; group_name: string; group_jid: string; created_at: string };

/** Preço real de cada perfume, melhor oferta de hoje e quem infla o "DE". ?id= traz o histórico diário de um perfume. */
export function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id") || 0);
  if (id) {
    const days = db()
      .prepare(
        `SELECT date(created_at,'-3 hours') day, MIN(price) min, COUNT(*) n FROM offers
         WHERE product_id = ? AND price > 0 AND created_at >= datetime('now','-30 days') GROUP BY day ORDER BY day`,
      )
      .all(id);
    const offers = db()
      .prepare("SELECT price, old_price, group_name, created_at FROM offers WHERE product_id = ? AND price > 0 ORDER BY created_at DESC LIMIT 30")
      .all(id);
    return Response.json({ days, offers, real: realPrice(id) });
  }

  const offers = db()
    .prepare("SELECT product_id, price, old_price, group_name, group_jid, created_at FROM offers WHERE price > 0 AND created_at >= datetime('now','-30 days')")
    .all() as Off[];
  const by = new Map<number, Off[]>();
  for (const o of offers) by.set(o.product_id, [...(by.get(o.product_id) || []), o]);
  const names = new Map(
    (db().prepare("SELECT id, name FROM products").all() as { id: number; name: string }[]).map((p) => [p.id, p.name]),
  );
  const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const inflators = new Map<string, { name: string; inflated: number; total: number }>();
  const rows = [];
  for (const [pid, list] of by) {
    const rp = realPrice(pid);
    const todays = list.filter((o) => new Date(o.created_at.replace(" ", "T") + "Z").getTime() - 3 * 3600e3 >= Date.parse(today));
    const bestToday = todays.length ? Math.min(...todays.map((o) => o.price)) : null;
    for (const o of list) {
      const g = inflators.get(o.group_jid) || { name: o.group_name, inflated: 0, total: 0 };
      if (rp && o.old_price) {
        g.total++;
        if (o.old_price > rp.ref * 1.5) g.inflated++;
      }
      inflators.set(o.group_jid, g);
    }
    const name = names.get(pid) || "?";
    rows.push({
      id: pid,
      name,
      origin: perfumeOrigin(name),
      offers: list.length,
      real: rp,
      bestToday,
      todayDiscount: rp && bestToday ? 1 - bestToday / rp.ref : null,
      min30: Math.min(...list.map((o) => o.price)),
    });
  }
  rows.sort((a, b) => b.offers - a.offers);
  return Response.json({
    rows,
    inflators: [...inflators.values()].filter((g) => g.total >= 5).sort((a, b) => b.inflated / b.total - a.inflated / a.total),
  });
}
