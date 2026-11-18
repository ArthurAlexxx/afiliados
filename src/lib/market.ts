/**
 * Estudo de Mercado: dados do RadarHub (vendas do Mercado Livre) guardados por data, para análise.
 *
 * Cada resposta do RadarHub vira um "retrato" (market_snapshots) com a data da coleta. Assim dá para
 * comparar datas, ver quem cresce, a fatia de cada marca, faixa de preço, tamanhos e o que a gente
 * ainda não posta. Os retratos chegam de três jeitos: puxados daqui (RADARHUB_URL), enviados por
 * POST /api/mercado (de um script no PC) ou colados na própria página.
 */
import { db, log } from "./db.ts";
import { nameTokens, perfumeInfo, perfumeOrigin, tokenSimilarity } from "./perfume.ts";

let ready = false;
function d() {
  const x = db();
  if (!ready) {
    x.exec(`
      CREATE TABLE IF NOT EXISTS market_snapshots (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint    TEXT NOT NULL,             -- mais-vendidos | em-alta | outro caminho da API
        category    TEXT NOT NULL DEFAULT '',
        params      TEXT NOT NULL DEFAULT '',  -- query usada (dias, porMarca...)
        ref_date    TEXT NOT NULL,             -- data a que os dados se referem (AAAA-MM-DD)
        items       INTEGER NOT NULL DEFAULT 0,
        payload     TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_market_snap ON market_snapshots(endpoint, category, ref_date);
    `);
    ready = true;
  }
  return x;
}

/* ---------------- normalização das respostas ---------------- */

export type MarketItem = {
  name: string;
  brand: string | null;
  position: number | null;
  revenue: number | null;
  units: number | null;
  price: number | null;      // preço médio (faturamento / unidades, ou o que vier)
  growth: number | null;     // % (19 = +19%)
  ml: number | null;
  origin: string | null;
  link: string | null;
  image: string | null;
};

const num = (v: unknown) => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[R$%+\s]/g, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const str = (...v: unknown[]) => {
  for (const x of v) if (typeof x === "string" && x.trim()) return x.trim();
  return null;
};

type Raw = Record<string, unknown>;

/** Acha a lista de produtos em qualquer formato comum de resposta (marcas[].produtos, produtos, itens, data...). */
function rawList(payload: unknown): Raw[] {
  if (Array.isArray(payload)) return payload.filter((x) => x && typeof x === "object") as Raw[];
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Raw;
  const out: Raw[] = [];
  if (Array.isArray(p.marcas))
    for (const m of p.marcas as Raw[]) for (const it of (m?.produtos as Raw[]) || []) out.push({ marca: m.marca ?? m.nome, ...it });
  for (const k of ["produtos", "itens", "items", "results", "resultados", "anuncios"]) if (Array.isArray(p[k])) out.push(...(p[k] as Raw[]));
  if (!out.length && p.data) return rawList(p.data);
  return out;
}

export function normalize(payload: unknown): MarketItem[] {
  const list = rawList(payload);
  const growths = list.map((i) => num(i.tendencia ?? i.variacaoVsAnterior ?? i.crescimento ?? i.variacao ?? i.growth));
  const xs = growths.filter((x): x is number => x != null);
  const fraction = xs.length > 0 && xs.every((x) => Math.abs(x) <= 5);
  const items = list
    .map((it, idx): MarketItem | null => {
      const name = str(it.produto, it.nome, it.titulo, it.title, it.name);
      if (!name) return null;
      const revenue = num(it.faturamento ?? it.receita ?? it.revenue ?? it.gmv);
      const units = num(it.unidades ?? it.vendas ?? it.vendidos ?? it.units ?? it.sold_quantity);
      const price = num(it.preco ?? it.precoMedio ?? it.ticketMedio ?? it.price) ?? (revenue && units ? revenue / units : null);
      const g = growths[idx];
      const info = perfumeInfo(name);
      return {
        name,
        brand: str(it.marca, it.brand, it.vendedorMarca),
        position: num(it.posicao ?? it.rank ?? it.position),
        revenue,
        units,
        price,
        growth: g == null ? null : fraction ? g * 100 : g,
        ml: info?.ml ?? null,
        origin: perfumeOrigin(`${name} ${str(it.marca) || ""}`),
        link: str(it.link, it.url, it.permalink),
        image: str(it.imagem, it.thumbnail, it.foto, it.image),
      };
    })
    .filter((x): x is MarketItem => !!x);
  return items;
}

/* ---------------- retratos ---------------- */

const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

export function saveSnapshot(endpoint: string, category: string, params: string, payload: unknown, refDate?: string) {
  const items = normalize(payload).length;
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(refDate || "") ? refDate! : today();
  const x = d();
  // um retrato por endpoint+categoria+parâmetros+data: o mais novo substitui
  x.prepare("DELETE FROM market_snapshots WHERE endpoint = ? AND category = ? AND params = ? AND ref_date = ?").run(endpoint, category, params, ref);
  const r = x
    .prepare("INSERT INTO market_snapshots (endpoint, category, params, ref_date, items, payload) VALUES (?,?,?,?,?,?)")
    .run(endpoint, category, params, ref, items, JSON.stringify(payload));
  return { id: Number(r.lastInsertRowid), items, ref_date: ref };
}

export type SnapshotMeta = { id: number; endpoint: string; category: string; params: string; ref_date: string; items: number; created_at: string };

export function listSnapshots(): SnapshotMeta[] {
  return d()
    .prepare("SELECT id, endpoint, category, params, ref_date, items, created_at FROM market_snapshots ORDER BY ref_date DESC, id DESC LIMIT 500")
    .all() as SnapshotMeta[];
}

export function deleteSnapshot(id: number) {
  d().prepare("DELETE FROM market_snapshots WHERE id = ?").run(id);
}

function snapshotItems(id: number): { meta: SnapshotMeta; items: MarketItem[] } | null {
  const r = d().prepare("SELECT id, endpoint, category, params, ref_date, items, created_at, payload FROM market_snapshots WHERE id = ?").get(id) as
    | (SnapshotMeta & { payload: string })
    | undefined;
  if (!r) return null;
  const { payload, ...meta } = r;
  return { meta, items: normalize(JSON.parse(payload)) };
}

/* ---------------- RadarHub ---------------- */

export function radarConfig() {
  return {
    url: (process.env.RADARHUB_URL || "").replace(/\/+$/, ""),
    hasToken: !!process.env.RADARHUB_TOKEN,
    categorias: (process.env.RADARHUB_CATEGORIAS || "").split(",").map((c) => c.trim()).filter(Boolean),
  };
}

/** GET num caminho da API do RadarHub (só /api/...). */
export async function radarGet(path: string): Promise<unknown> {
  const { url } = radarConfig();
  if (!url) throw new Error("RadarHub não configurado (falta RADARHUB_URL no servidor)");
  if (!path.startsWith("/api/") || path.includes("..")) throw new Error("caminho inválido");
  const r = await fetch(`${url}${path}`, {
    headers: { authorization: `Bearer ${process.env.RADARHUB_TOKEN || ""}`, "x-api-key": process.env.RADARHUB_TOKEN || "" },
    signal: AbortSignal.timeout(60e3),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`RadarHub ${path} → HTTP ${r.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`RadarHub ${path} não respondeu JSON`);
  }
}

/** Puxa mais vendidos e em alta de cada categoria e guarda como retrato de hoje. */
export async function pullMarket(opts: { categorias?: string[]; dias?: number }) {
  const cats = opts.categorias?.length ? opts.categorias : radarConfig().categorias;
  if (!cats.length) throw new Error("Nenhuma categoria (configure RADARHUB_CATEGORIAS ou escolha uma)");
  const dias = opts.dias || 7;
  const done: string[] = [];
  for (const c of cats) {
    const q = encodeURIComponent(c);
    const mv = `dias=${dias}&porMarca=50`;
    saveSnapshot("mais-vendidos", c, mv, await radarGet(`/api/v1/mais-vendidos?categoria=${q}&${mv}`));
    const ea = `dias=${Math.max(dias, 14)}`;
    saveSnapshot("em-alta", c, ea, await radarGet(`/api/v1/em-alta?categoria=${q}&${ea}`));
    done.push(c);
  }
  const msg = `Estudo de Mercado: RadarHub puxado (${done.join(", ")}, ${dias} dias)`;
  log("info", msg);
  return msg;
}

/* ---------------- análise ---------------- */

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b || 0), 0);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const PRICE_BANDS = [0, 100, 200, 300, 500, 800, Infinity];
const bandLabel = (lo: number, hi: number) => (hi === Infinity ? `R$ ${lo}+` : `R$ ${lo}–${hi}`);

type Ours = { offers: number; minPrice: number | null; lastPosted: string | null; product: string };

/** Casa cada item do mercado com os perfumes que a gente já viu nos grupos. */
function oursMatcher() {
  const prods = d()
    .prepare(
      `SELECT p.id, p.name, p.ml, p.tokens, p.last_posted_at,
              (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.id AND o.created_at >= datetime('now','-30 days')) offers,
              (SELECT MIN(price) FROM offers o WHERE o.product_id = p.id AND o.price > 0 AND o.created_at >= datetime('now','-30 days')) min_price
       FROM products p`,
    )
    .all() as { id: number; name: string; ml: number; tokens: string; last_posted_at: string | null; offers: number; min_price: number | null }[];
  const rows = prods.map((p) => ({ ...p, tk: JSON.parse(p.tokens) as string[] }));
  return (it: MarketItem): Ours | null => {
    const tk = nameTokens(it.name);
    if (!tk.length) return null;
    let best: { sim: number; p: (typeof rows)[number] } | null = null;
    for (const p of rows) {
      const sim = tokenSimilarity(tk, p.tk);
      if (sim < 0.75) continue;
      if (it.ml && p.ml && it.ml !== p.ml && sim < 1) continue;
      if (!best || sim > best.sim || (sim === best.sim && p.offers > best.p.offers)) best = { sim, p };
    }
    return best ? { offers: best.p.offers, minPrice: best.p.min_price, lastPosted: best.p.last_posted_at, product: best.p.name } : null;
  };
}

const key = (it: MarketItem) => nameTokens(it.name).join(" ") + (it.ml ? `|${it.ml}` : "");

export function analyze(id: number, compareId?: number) {
  const s = snapshotItems(id);
  if (!s) return null;
  const items = s.items;
  const prev = compareId ? snapshotItems(compareId) : null;
  const prevBy = new Map((prev?.items || []).map((it) => [key(it), it]));
  const ours = oursMatcher();

  const totalRevenue = sum(items.map((i) => i.revenue));
  const totalUnits = sum(items.map((i) => i.units));
  const growths = items.map((i) => i.growth).filter((x): x is number => x != null);

  // marcas
  const brands = new Map<string, { brand: string; revenue: number; units: number; products: number; growth: number[] }>();
  for (const it of items) {
    const b = it.brand || "Sem marca";
    const e = brands.get(b) || { brand: b, revenue: 0, units: 0, products: 0, growth: [] };
    e.revenue += it.revenue || 0;
    e.units += it.units || 0;
    e.products++;
    if (it.growth != null) e.growth.push(it.growth);
    brands.set(b, e);
  }
  const brandRows = [...brands.values()]
    .map((b) => ({ brand: b.brand, revenue: b.revenue, units: b.units, products: b.products, share: totalRevenue ? b.revenue / totalRevenue : 0, growth: median(b.growth) }))
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units);

  // faixas de preço
  const bands = PRICE_BANDS.slice(0, -1).map((lo, i) => ({ label: bandLabel(lo, PRICE_BANDS[i + 1]), lo, hi: PRICE_BANDS[i + 1], revenue: 0, units: 0, products: 0 }));
  for (const it of items) {
    if (it.price == null) continue;
    const b = bands.find((x) => it.price! >= x.lo && it.price! < x.hi);
    if (!b) continue;
    b.revenue += it.revenue || 0;
    b.units += it.units || 0;
    b.products++;
  }

  // tamanhos e origem
  const group = (f: (i: MarketItem) => string) => {
    const m = new Map<string, { label: string; revenue: number; units: number; products: number }>();
    for (const it of items) {
      const k = f(it);
      const e = m.get(k) || { label: k, revenue: 0, units: 0, products: 0 };
      e.revenue += it.revenue || 0;
      e.units += it.units || 0;
      e.products++;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue || b.units - a.units);
  };
  const sizes = group((i) => (i.ml ? `${i.ml} ml` : "sem tamanho"));
  const origins = group((i) => (i.origin === "arabe" ? "Árabe" : i.origin === "nacional" ? "Nacional" : i.origin === "importado" ? "Importado" : "Não identificado"));

  // concentração
  const byRev = [...items].sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
  const top10Share = totalRevenue ? sum(byRev.slice(0, 10).map((i) => i.revenue)) / totalRevenue : null;
  const top3BrandShare = totalRevenue ? sum(brandRows.slice(0, 3).map((b) => b.revenue)) / totalRevenue : null;

  const rows = items.map((it) => {
    const o = ours(it);
    const p = prevBy.get(key(it));
    return {
      ...it,
      share: totalRevenue && it.revenue ? it.revenue / totalRevenue : null,
      ours: o,
      prev: p ? { position: p.position, revenue: p.revenue, units: p.units } : null,
      delta: p && p.revenue && it.revenue ? ((it.revenue - p.revenue) / p.revenue) * 100 : null,
      isNew: !!prev && !p,
    };
  });

  // oportunidades: vende bem ou está subindo e a gente quase não posta
  const opportunities = rows
    .filter((r) => (r.ours?.offers || 0) <= 2 && ((r.growth || 0) >= 15 || (r.position != null && r.position <= 20) || (r.share || 0) >= 0.01))
    .sort((a, b) => (b.growth || 0) + (b.share || 0) * 1000 - ((a.growth || 0) + (a.share || 0) * 1000))
    .slice(0, 25);

  const covered = rows.filter((r) => r.ours).length;

  return {
    meta: s.meta,
    compare: prev?.meta || null,
    kpis: {
      products: items.length,
      brands: brandRows.length,
      revenue: totalRevenue || null,
      units: totalUnits || null,
      avgTicket: totalRevenue && totalUnits ? totalRevenue / totalUnits : null,
      medianGrowth: median(growths),
      rising: growths.filter((g) => g > 0).length,
      falling: growths.filter((g) => g < 0).length,
      top10Share,
      top3BrandShare,
      covered,
      newItems: rows.filter((r) => r.isNew).length,
      dropped: prev ? prev.items.filter((p) => !items.some((i) => key(i) === key(p))).map((p) => p.name).slice(0, 30) : [],
    },
    brands: brandRows.slice(0, 30),
    bands,
    sizes: sizes.slice(0, 10),
    origins,
    risers: [...rows].filter((r) => r.growth != null).sort((a, b) => b.growth! - a.growth!).slice(0, 15),
    fallers: [...rows].filter((r) => r.growth != null && r.growth < 0).sort((a, b) => a.growth! - b.growth!).slice(0, 10),
    opportunities,
    rows: rows.sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || (b.revenue || 0) - (a.revenue || 0)),
  };
}

/** Evolução de um perfume (ou marca) ao longo dos retratos do mesmo endpoint e categoria. */
export function history(endpoint: string, category: string, term: string) {
  const snaps = d()
    .prepare("SELECT id, ref_date FROM market_snapshots WHERE endpoint = ? AND category = ? ORDER BY ref_date, id")
    .all(endpoint, category) as { id: number; ref_date: string }[];
  const tk = nameTokens(term);
  const t = term.trim().toLowerCase();
  return snaps.map((sn) => {
    const s = snapshotItems(sn.id)!;
    const hit = s.items.filter((it) => (it.brand || "").toLowerCase() === t || (tk.length && tokenSimilarity(tk, nameTokens(it.name)) >= 0.75));
    return {
      date: sn.ref_date,
      revenue: hit.length ? sum(hit.map((h) => h.revenue)) : null,
      units: hit.length ? sum(hit.map((h) => h.units)) : null,
      position: hit.length ? Math.min(...hit.map((h) => h.position ?? 1e9)) : null,
    };
  });
}
