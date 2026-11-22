import { db } from "@/lib/db";
import { dealRules, dealsGroup, setDealRules, simulateDeals, type DealRules } from "@/lib/deals";

export const dynamic = "force-dynamic";

/** Grupo de ofertas boas: regras, o que saiu e a simulação das últimas 48h com as regras atuais. */
export function GET() {
  const group = dealsGroup() || null;
  const rules = dealRules();
  const posts = group
    ? db()
        .prepare("SELECT id, status, reason, source_name, created_at, sent_at, data_json FROM posts WHERE dest = ? ORDER BY id DESC LIMIT 20")
        .all(group.jid)
        .map((p) => {
          const r = p as { id: number; status: string; reason: string | null; source_name: string; created_at: string; sent_at: string | null; data_json: string };
          let name = "", price = null as number | null, ref = null as number | null;
          try {
            const j = JSON.parse(r.data_json);
            name = j.data?.titulo || "";
            price = j.curation?.bestPrice ?? null;
            ref = j.curation?.medianPrice ?? null;
          } catch {}
          return { id: r.id, status: r.status, reason: r.reason, via: r.source_name, created_at: r.created_at, sent_at: r.sent_at, name, price, ref };
        })
    : [];
  const prices = db()
    .prepare("SELECT COUNT(*) n, COUNT(DISTINCT product_id) p, COUNT(DISTINCT group_jid) g FROM offers WHERE price > 0 AND created_at >= datetime('now','-30 days')")
    .get() as { n: number; p: number; g: number };
  const sim = simulateDeals(48, rules);
  return Response.json({ group, rules, posts, prices, sim: { checked: sim.checked, deals: sim.deals.slice(0, 30), total: sim.deals.length } });
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as Partial<DealRules>;
  return Response.json({ ok: true, rules: setDealRules(body) });
}
