import { db } from "@/lib/db";
import { dealPrice, dealRules, dealsGroup, judgeDeal } from "@/lib/deals";
import { notPerfume } from "@/lib/perfume";

export const dynamic = "force-dynamic";

type Row = { id: number; product_id: number; group_name: string; title: string; price: number | null; old_price: number | null; url: string | null; created_at: string; name: string; ml: number; blocked: number };
type Eval = { ok: boolean; label: string | null; pct: number | null; ref: number | null; min: number | null; samples: number; groups: number; why: string };

// a análise de cada promoção não muda depois de feita: guarda na memória
const g = globalThis as typeof globalThis & { __aoVivoEval?: Map<number, Eval> };
const cache = (g.__aoVivoEval ||= new Map());

function evaluate(r: Row): Eval {
  const hit = cache.get(r.id);
  if (hit) return hit;
  let e: Eval;
  if (r.blocked) e = { ok: false, label: null, pct: null, ref: null, min: null, samples: 0, groups: 0, why: "perfume bloqueado por você" };
  else if (notPerfume(r.name)) e = { ok: false, label: null, pct: null, ref: null, min: null, samples: 0, groups: 0, why: "não é perfume" };
  else if (!r.price) e = { ok: false, label: null, pct: null, ref: null, min: null, samples: 0, groups: 0, why: "sem preço" };
  else {
    const ref = dealPrice(r.product_id, `datetime('${r.created_at}', '-6 hours')`);
    const v = judgeDeal(r.price, ref, dealRules());
    e = { ok: v.ok, label: v.label || null, pct: v.pct != null ? Math.round(v.pct * 100) : null, ref: v.refPrice ?? ref?.median ?? null, min: ref?.min ?? null, samples: ref?.samples || 0, groups: ref?.groups || 0, why: v.why };
  }
  cache.set(r.id, e);
  if (cache.size > 20000) cache.delete(cache.keys().next().value!);
  return e;
}

const SELECT = `SELECT o.id, o.product_id, o.group_name, o.title, o.price, o.old_price, o.url, o.created_at, p.name, p.ml, p.blocked
  FROM offers o JOIN products p ON p.id = o.product_id`;

/** Tela Ao vivo: promoções novas (depois de `after`), a análise do agente e os números da última hora. */
export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const after = Number(q.get("after")) || 0;
  const rows = (
    after
      ? db().prepare(`${SELECT} WHERE o.id > ? ORDER BY o.id DESC LIMIT 200`).all(after)
      : db().prepare(`${SELECT} ORDER BY o.id DESC LIMIT 250`).all()
  ) as Row[];

  // post que o agente criou no grupo de ofertas para a promoção
  const dg = dealsGroup();
  const postFor = dg
    ? db().prepare("SELECT id, status FROM posts WHERE dest = ? AND product_id = ? AND created_at >= datetime(?, '-1 minutes') AND created_at <= datetime(?, '+10 minutes') ORDER BY id LIMIT 1")
    : null;
  const items = rows.map((r) => {
    const e = evaluate(r);
    const post = postFor && e.ok ? (postFor.get(dg!.jid, r.product_id, r.created_at, r.created_at) as { id: number; status: string } | undefined) : undefined;
    return { id: r.id, pid: r.product_id, name: r.name, group: r.group_name, price: r.price, old: r.old_price, url: r.url, at: r.created_at, ...e, post: post || null };
  });

  const wantStats = !after || q.get("stats") === "1";
  let stats = null;
  if (wantStats) {
    const hour = db().prepare("SELECT COUNT(*) n, COUNT(DISTINCT product_id) p FROM offers WHERE created_at >= datetime('now','-60 minutes')").get() as { n: number; p: number };
    const byGroup = db()
      .prepare("SELECT group_name g, COUNT(*) n FROM offers WHERE created_at >= datetime('now','-60 minutes') GROUP BY group_name ORDER BY n DESC")
      .all() as { g: string; n: number }[];
    // mais postados na última hora (bom termômetro para anúncio)
    const trending = db()
      .prepare(
        `SELECT p.id pid, p.name, COUNT(*) n, COUNT(DISTINCT o.group_name) groups, MIN(o.price) price FROM offers o JOIN products p ON p.id = o.product_id
         WHERE o.created_at >= datetime('now','-3 hours') AND o.price > 0 GROUP BY p.id ORDER BY groups DESC, n DESC LIMIT 12`,
      )
      .all() as { pid: number; name: string; n: number; groups: number; price: number }[];
    // melhores ofertas das últimas 6h (para anúncio): maior desconto contra o preço normal
    const recent = db().prepare(`${SELECT} WHERE o.created_at >= datetime('now','-6 hours') AND o.price > 0 ORDER BY o.id DESC LIMIT 1500`).all() as Row[];
    const bestBy = new Map<number, ReturnType<typeof evaluate> & { r: Row }>();
    for (const r of recent) {
      const e = evaluate(r);
      if (!e.ok || e.pct == null) continue;
      const cur = bestBy.get(r.product_id);
      if (!cur || (e.pct ?? 0) > (cur.pct ?? 0)) bestBy.set(r.product_id, { ...e, r });
    }
    const top = [...bestBy.values()]
      .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
      .slice(0, 12)
      .map((x) => ({ pid: x.r.product_id, name: x.r.name, price: x.r.price, ref: x.ref, pct: x.pct, label: x.label, group: x.r.group_name, url: x.r.url, at: x.r.created_at }));
    const passedHour = recent.filter((r) => r.created_at >= sqlAgo(60) && evaluate(r).ok).length;
    stats = { hour, byGroup, trending, top, passedHour, rules: dealRules(), dealsGroup: dg?.name || null };
  }
  return Response.json({ items, stats, now: new Date().toISOString() });
}

function sqlAgo(min: number) {
  return new Date(Date.now() - min * 60e3).toISOString().replace("T", " ").slice(0, 19);
}
