import { db } from "@/lib/db";
import { dealPrice, dealRules, dealsGroup, judgeDeal, othersAvg } from "@/lib/deals";
import { getSettings, getState } from "@/lib/settings";
import { notPerfume } from "@/lib/perfume";

export const dynamic = "force-dynamic";

type Row = { id: number; product_id: number; group_jid: string; group_name: string; title: string; price: number | null; old_price: number | null; url: string | null; created_at: string; name: string; ml: number; blocked: number };
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
    // mesma regra do envio: precisa estar abaixo da média do que os outros grupos postaram
    if (e.ok) {
      const avg = othersAvg(r.product_id, r.group_jid);
      if (avg && r.price > avg.avg * 0.97) e = { ...e, ok: false, why: `${v.why}, mas acima da média de outros grupos (R$ ${avg.avg.toFixed(2).replace(".", ",")})` };
    }
  }
  cache.set(r.id, e);
  if (cache.size > 20000) cache.delete(cache.keys().next().value!);
  return e;
}

const SELECT = `SELECT o.id, o.product_id, o.group_jid, o.group_name, o.title, o.price, o.old_price, o.url, o.created_at, p.name, p.ml, p.blocked
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
  // Arthur (22/nov): mostrar em quanto tempo cada post da fila entra no grupo
  const s = getSettings();
  const step = Math.max(30, s.minIntervalSeconds || 90);
  const etaOf = new Map<number, number>();
  if (dg) {
    const queued = db().prepare("SELECT id FROM posts WHERE status = 'queued' AND dest = ? ORDER BY id").all(dg.jid) as { id: number }[];
    const last = Number(getState(`lastSentAt:${dg.jid}`) || 0);
    const first = Math.max(0, (last + step * 1000 - Date.now()) / 1000);
    queued.forEach((q, i) => etaOf.set(q.id, Math.round(first + i * step)));
  }
  const lastPost = dg
    ? db().prepare("SELECT id, created_at FROM posts WHERE dest = ? AND product_id = ? AND status IN ('queued','sending','sent') AND created_at < datetime(?, '-1 minutes') ORDER BY id DESC LIMIT 1")
    : null;
  const build = (r: Row) => {
    let e = evaluate(r);
    const post = postFor && e.ok ? (postFor.get(dg!.jid, r.product_id, r.created_at, r.created_at) as { id: number; status: string } | undefined) : undefined;
    if (e.ok && !post && lastPost) {
      const prev = lastPost.get(dg!.jid, r.product_id, r.created_at) as { id: number; created_at: string } | undefined;
      if (prev) e = { ...e, why: `${e.why} · já tinha saído no grupo (post #${prev.id})` };
    }
    const p = post ? { ...post, eta: post.status === "queued" ? (etaOf.get(post.id) ?? null) : null } : null;
    return { id: r.id, pid: r.product_id, name: r.name, group: r.group_name, price: r.price, old: r.old_price, url: r.url, at: r.created_at, ...e, post: p };
  };
  const items = rows.map(build);
  // atualização dos posts das promoções que já estão na tela (status e tempo para entrar no grupo)
  let posts: Record<number, ReturnType<typeof build>["post"]> | null = null;
  if (q.get("posts") === "1") {
    posts = {};
    const recent = db().prepare(`${SELECT} WHERE o.created_at >= datetime('now','-3 hours') ORDER BY o.id DESC LIMIT 400`).all() as Row[];
    for (const r of recent) {
      const b = build(r);
      if (b.post) posts[r.id] = b.post;
    }
  }

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
  return Response.json({ items, stats, posts, now: new Date().toISOString() });
}

function sqlAgo(min: number) {
  return new Date(Date.now() - min * 60e3).toISOString().replace("T", " ").slice(0, 19);
}
