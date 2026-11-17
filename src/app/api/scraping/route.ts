import { db } from "@/lib/db";
import { KIND_LABEL, apifyOff, priceTable, setApifyTier, type CallKind } from "@/lib/apify";

export const dynamic = "force-dynamic";

/**
 * Página Scraping: conta do Apify (plano, crédito, gasto do ciclo, por dia e por serviço, execuções)
 * + o nosso registro de cada puxada (api_calls) + cobertura do Fragrantica no banco.
 */
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ACTORS: Record<string, string> = {
  mhO3lsiIJ56cF20f3: "Fragrantica (busca e ficha)",
  yD95d01y3SlKrPqQ7: "Google (Web Search)",
  a6Sqhlnt4touIHTub: "Página do Fragrantica (Web Fetch)",
  LXBYlqViHcR0tnt5i: "Pinterest",
};

let cache: { at: number; data: J } | null = null;

async function apify(path: string): Promise<J | null> {
  const r = await fetch(`https://api.apify.com/v2${path}`, {
    headers: { authorization: `Bearer ${process.env.APIFY_TOKEN}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Apify ${r.status} em ${path.split("?")[0]}`);
  return ((await r.json()) as J).data ?? null;
}

async function account(force: boolean): Promise<J> {
  if (!process.env.APIFY_TOKEN) return { error: "falta APIFY_TOKEN no Railway" };
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.data;
  try {
    const [me, limits, usage, runs] = await Promise.all([
      apify("/users/me"),
      apify("/users/me/limits"),
      apify("/users/me/usage/monthly"),
      apify("/actor-runs?desc=1&limit=100"),
    ]);
    setApifyTier(me?.plan?.tier);
    const items = ((runs?.items || []) as J[]).map((x) => ({
      id: x.id,
      actor: ACTORS[x.actId] || x.actId,
      status: x.status,
      startedAt: x.startedAt,
      finishedAt: x.finishedAt,
      usd: x.usageTotalUsd ?? null,
      origin: x.meta?.origin || null,
      standby: !!x.standby,
    }));
    const services = Object.entries((usage?.monthlyServiceUsage || {}) as Record<string, J>)
      .map(([k, v]) => ({ service: k, quantity: v.quantity, usd: v.amountAfterVolumeDiscountUsd ?? v.baseAmountUsd ?? 0 }))
      .sort((a, b) => b.usd - a.usd);
    const daily = ((usage?.dailyServiceUsages || []) as J[]).map((d) => ({ day: String(d.date).slice(0, 10), usd: d.totalUsageCreditsUsd || 0 }));
    const data = {
      username: me?.username,
      plan: { id: me?.plan?.id, tier: me?.plan?.tier, priceUsd: me?.plan?.monthlyBasePriceUsd, creditsUsd: me?.plan?.monthlyUsageCreditsUsd, paying: !!me?.isPaying },
      cycle: limits?.monthlyUsageCycle,
      maxUsd: limits?.limits?.maxMonthlyUsageUsd ?? null,
      usedUsd: limits?.current?.monthlyUsageUsd ?? usage?.totalUsageCreditsUsdAfterVolumeDiscount ?? 0,
      services,
      daily,
      runs: items,
      runsTotal: runs?.total ?? items.length,
    };
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    return { error: (e as Error).message, ...(cache?.data || {}) };
  }
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const acc = await account(u.searchParams.get("fresh") === "1");
  const kind = u.searchParams.get("kind") || "";
  const q = (u.searchParams.get("q") || "").trim();
  const since = acc.cycle?.startAt ? String(acc.cycle.startAt).replace("T", " ").slice(0, 19) : "1970-01-01";
  const d = db();
  const today = "date(at, '-3 hours') = date('now', '-3 hours')";

  const byKind = (d
    .prepare(
      `SELECT kind, COUNT(*) n, SUM(ok = 0) fails, SUM(cost_usd) usd, AVG(CASE WHEN ok = 1 THEN cost_usd END) avg_usd, AVG(ms) avg_ms,
         SUM(CASE WHEN ${today} THEN 1 ELSE 0 END) n_today, SUM(CASE WHEN ${today} THEN cost_usd ELSE 0 END) usd_today,
         SUM(CASE WHEN at >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) n_hour
       FROM api_calls WHERE at >= ? GROUP BY kind ORDER BY usd DESC`,
    )
    .all(since) as J[]).map((r) => ({ ...r, label: KIND_LABEL[r.kind as CallKind] || r.kind }));

  const days = d
    .prepare(
      `SELECT date(at, '-3 hours') day, kind, COUNT(*) n, SUM(cost_usd) usd FROM api_calls
       WHERE at >= datetime('now', '-30 days') GROUP BY day, kind ORDER BY day`,
    )
    .all();
  const hours = d
    .prepare(
      `SELECT strftime('%H', at, '-3 hours') h, COUNT(*) n, SUM(cost_usd) usd FROM api_calls
       WHERE ${today} GROUP BY h ORDER BY h`,
    )
    .all();

  const calls = d
    .prepare(
      `SELECT c.id, c.at, c.kind, c.product_id, COALESCE(p.name, c.label) name, c.label, c.items, c.cost_usd, c.ok, c.ms, c.result
       FROM api_calls c LEFT JOIN products p ON p.id = c.product_id
       WHERE (? = '' OR c.kind = ?) AND (? = '' OR COALESCE(p.name, '') LIKE ? OR COALESCE(c.label, '') LIKE ? OR COALESCE(c.result, '') LIKE ?)
       ORDER BY c.at DESC, c.id DESC LIMIT 300`,
    )
    .all(kind, kind, q, `%${q}%`, `%${q}%`, `%${q}%`);

  const top = d
    .prepare(
      `SELECT c.product_id, COALESCE(p.name, MAX(c.label)) name, COUNT(*) n, SUM(c.cost_usd) usd
       FROM api_calls c LEFT JOIN products p ON p.id = c.product_id
       WHERE c.at >= ? AND c.product_id IS NOT NULL GROUP BY c.product_id ORDER BY usd DESC LIMIT 10`,
    )
    .all(since);

  const one = (sql: string) => (d.prepare(sql).get() as { n: number }).n;
  const coverage = {
    products: one("SELECT COUNT(*) n FROM products"),
    linked: one("SELECT COUNT(*) n FROM products WHERE frag_url IS NOT NULL"),
    notFound: one("SELECT COUNT(*) n FROM products WHERE frag_url IS NULL AND frag_checked_at IS NOT NULL"),
    toSearch: one("SELECT COUNT(*) n FROM products WHERE frag_checked_at IS NULL"),
    withDetails: one("SELECT COUNT(*) n FROM products WHERE frag_data IS NOT NULL"),
    detailsPending: one("SELECT COUNT(*) n FROM products WHERE frag_url IS NOT NULL AND frag_data IS NULL"),
    photosRead: one("SELECT COUNT(DISTINCT frag_url) n FROM products WHERE fragram_at IS NOT NULL"),
    photosPending: one("SELECT COUNT(DISTINCT frag_url) n FROM products WHERE frag_url IS NOT NULL AND fragram_at IS NULL"),
    photos: one("SELECT COUNT(*) n FROM frag_photos"),
    perfumesWithPhotos: one("SELECT COUNT(DISTINCT frag_url) n FROM frag_photos"),
  };

  return Response.json({ account: acc, prices: priceTable(), paused: apifyOff(), byKind, days, hours, calls, top, coverage, kinds: KIND_LABEL });
}
