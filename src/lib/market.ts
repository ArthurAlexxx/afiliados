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
  shops: number | null;      // quantas lojas vendem
  full: number | null;       // fração vendida pelo Full (0..1)
  catShare: number | null;   // fatia do faturamento da categoria inteira (0..1), quando a API manda
  ads: number | null;        // quantos anúncios somados nessa linha
  series: number[] | null;   // faturamento de cada dia do período
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

/** "O Boticário" e "BOTICARIO" viram a mesma marca. */
export const brandKey = (b: string) =>
  b
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9& ]+/g, "")
    .replace(/^(O|GIORGIO)\s+/, "")
    .replace(/\s+(BEAUTY|PARFUMS?|PERFUMES?|PARIS|FRAGRANCES?)$/, "")
    .replace(/\s+/g, " ")
    .trim();

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
  // o RadarHub manda tendência sempre em fração (0,23 = +23%; 288 = +28.800%)
  const radar = list.some((i) => "participacaoCategoria" in i || "ticket" in i || "precoMediano" in i);
  const fraction = radar || (xs.length > 0 && xs.every((x) => Math.abs(x) <= 5));
  const items = list
    .map((it, idx): MarketItem | null => {
      const name = str(it.produto, it.nome, it.titulo, it.title, it.name);
      if (!name) return null;
      const revenue = num(it.faturamento ?? it.receita ?? it.revenue ?? it.gmv);
      const units = num(it.unidades ?? it.vendas ?? it.vendidos ?? it.units ?? it.sold_quantity);
      const price = num(it.precoMediano ?? it.preco ?? it.precoMedio ?? it.ticket ?? it.ticketMedio ?? it.price) ?? (revenue && units ? revenue / units : null);
      const g = growths[idx];
      const info = perfumeInfo(name);
      return {
        name,
        brand: str(it.marca, it.brand, it.vendedorMarca)?.replace(/[\u0080-\u009f]/g, "'") ?? null,
        position: num(it.posicao ?? it.rank ?? it.position),
        revenue,
        units,
        price,
        growth: g == null ? null : fraction ? g * 100 : g,
        ml: info?.ml ?? null,
        origin: perfumeOrigin(`${name} ${str(it.marca) || ""}`),
        link: str(it.link, it.url, it.permalink, it.buscaML),
        image: str(it.imagem, it.thumbnail, it.foto, it.image),
        shops: num(it.lojas),
        full: num(it.pctFull),
        catShare: num(it.participacaoCategoria),
        ads: num(it.anuncios),
        series: Array.isArray(it.serie) ? (it.serie as unknown[]).map((x) => num(x) || 0) : null,
      };
    })
    .filter((x): x is MarketItem => !!x);
  return items;
}

/** Faturamento total da categoria e venda por dia, quando a resposta traz. */
function extras(payload: unknown) {
  const p = (payload && typeof payload === "object" ? payload : {}) as Raw;
  const days = Array.isArray(p.porDia) ? (p.porDia as Raw[]).map((x) => ({ day: String(x.dia), revenue: num(x.faturamento) || 0, units: num(x.unidades) || 0 })) : [];
  // total de cada marca (todas as vendas dela, não só os produtos listados), quando vem
  const brandTotals = new Map<string, { revenue: number; units: number; growth: number | null; series: number[] | null; products: number | null }>();
  const src = Array.isArray(p.marcasTotal) ? (p.marcasTotal as Raw[]) : Array.isArray(p.marcas) ? (p.marcas as Raw[]) : [];
  for (const m of src) {
    const name = str(m.marca, m.nome);
    const rev = num(m.faturamento);
    if (!name || rev == null) continue;
    const k = brandKey(name);
    const e = brandTotals.get(k) || { revenue: 0, units: 0, growth: null, series: null, products: null };
    e.revenue += rev;
    e.units += num(m.unidades) || 0;
    const g = num(m.tendencia);
    if (g != null) e.growth = g * 100;
    if (Array.isArray(m.serie)) e.series = (m.serie as unknown[]).map((x) => num(x) || 0);
    e.products = num(m.produtos ?? m.totalProdutos) ?? e.products;
    brandTotals.set(k, e);
  }
  return { categoryRevenue: num(p.faturamentoCategoria), days, shops: Array.isArray(p.lojas) ? (p.lojas as Raw[]) : [], brandTotals };
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

function snapshotItems(id: number): { meta: SnapshotMeta; items: MarketItem[]; extra: ReturnType<typeof extras> } | null {
  const r = d().prepare("SELECT id, endpoint, category, params, ref_date, items, created_at, payload FROM market_snapshots WHERE id = ?").get(id) as
    | (SnapshotMeta & { payload: string })
    | undefined;
  if (!r) return null;
  const { payload, ...meta } = r;
  const data = JSON.parse(payload);
  return { meta, items: normalize(data), extra: extras(data) };
}

/* ---------------- RadarHub ---------------- */

export function radarConfig() {
  return {
    url: (process.env.RADARHUB_URL || "").replace(/\/+$/, "").replace(/\/api\/v\d+$/, ""),
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
type RadarCat = { id: string; nome: string; primeiroDia?: string; ultimoDia?: string; diasComDados?: number };

export async function radarCategories(): Promise<RadarCat[]> {
  const r = (await radarGet("/api/v1/categorias")) as { categorias?: RadarCat[] };
  return r.categorias || [];
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

/**
 * Todas as vendas do período (rota /vendas, uma linha por anúncio por dia), somadas por perfume:
 * anúncios do mesmo perfume (mesma marca, mesmas palavras do nome e mesmo tamanho) viram uma linha só.
 * Guarda faturamento, unidades, preço mediano, lojas, anúncios, a venda de cada dia e a tendência
 * (2ª metade do período / 1ª metade - 1), por perfume e por marca.
 */
async function pullVendas(cat: string, from: string, to: string) {
  type Line = { dia: string; produto: string; marca: string | null; vendedor_id: string; modo_entrega: string; qtde_num: number | null; total_num: number | null; preco_unit: number | null; anuncio_chave?: string };
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const half = Math.floor(days.length / 2);
  const firstHalf = new Set(days.slice(0, half));
  const secondHalf = new Set(days.slice(days.length - half));
  const di = new Map(days.map((d, i) => [d, i]));
  type Agg = { t: number; u: number; h1: number; h2: number; serie: number[] };
  const agg = (): Agg => ({ t: 0, u: 0, h1: 0, h2: 0, serie: days.map(() => 0) });
  const add = (a: Agg, dia: string, t: number, u: number) => {
    a.t += t;
    a.u += u;
    if (firstHalf.has(dia)) a.h1 += t;
    if (secondHalf.has(dia)) a.h2 += t;
    a.serie[di.get(dia)!] += t;
  };
  const prods = new Map<string, Agg & { names: Map<string, number>; marca: string | null; prices: number[]; shops: Set<string>; ads: Set<string>; full: number }>();
  const brands = new Map<string, Agg & { marca: string; products: Set<string> }>();
  const perDay = new Map<string, { faturamento: number; unidades: number }>();
  const shops = new Map<string, number>();
  const keyCache = new Map<string, string>();
  for (const dia of days) {
    for (let page = 1; page <= 20; page++) {
      const r = (await radarGet(`/api/v1/vendas?categoria=${encodeURIComponent(cat)}&dia=${dia}&pagina=${page}&limite=5000`)) as { itens?: Line[]; paginas?: number };
      for (const l of r.itens || []) {
        const t = l.total_num || 0;
        const u = l.qtde_num || 0;
        const day = perDay.get(dia) || { faturamento: 0, unidades: 0 };
        day.faturamento += t;
        day.unidades += u;
        perDay.set(dia, day);
        shops.set(l.vendedor_id, (shops.get(l.vendedor_id) || 0) + t);
        const bk = l.marca ? brandKey(l.marca) : "";
        let k = keyCache.get(`${bk}|${l.produto}`);
        if (!k) {
          const tk = nameTokens(l.produto);
          const ml = perfumeInfo(l.produto)?.ml;
          k = `${bk}|${tk.length ? tk.join(" ") : l.produto.toLowerCase()}|${ml || ""}`;
          keyCache.set(`${bk}|${l.produto}`, k);
        }
        const e = prods.get(k) || { ...agg(), names: new Map<string, number>(), marca: l.marca, prices: [] as number[], shops: new Set<string>(), ads: new Set<string>(), full: 0 };
        add(e, dia, t, u);
        e.names.set(l.produto, (e.names.get(l.produto) || 0) + t);
        if (l.preco_unit) e.prices.push(l.preco_unit);
        e.shops.add(l.vendedor_id);
        e.ads.add(l.anuncio_chave || `${l.vendedor_id}|${l.produto}`);
        if (l.modo_entrega === "fulfillment") e.full += t;
        prods.set(k, e);
        if (bk) {
          const b = brands.get(bk) || { ...agg(), marca: l.marca!, products: new Set<string>() };
          add(b, dia, t, u);
          b.products.add(k);
          brands.set(bk, b);
        }
      }
      if (!r.paginas || page >= r.paginas) break;
    }
  }
  const total = [...perDay.values()].reduce((a, d) => a + d.faturamento, 0);
  const trend = (a: Agg) => (a.h1 > 0 ? a.h2 / a.h1 - 1 : null);
  const produtos = [...prods.values()]
    .sort((a, b) => b.t - a.t)
    .slice(0, 3000)
    .map((e, i) => {
      const ps = e.prices.sort((a, b) => a - b);
      const name = [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return {
        posicao: i + 1, produto: name, marca: e.marca, faturamento: e.t, unidades: e.u,
        precoMediano: ps.length ? ps[Math.floor(ps.length / 2)] : null, lojas: e.shops.size, anuncios: e.ads.size,
        pctFull: e.t ? e.full / e.t : null, participacaoCategoria: total ? e.t / total : null,
        tendencia: trend(e), serie: e.serie,
      };
    });
  return {
    categoria: cat,
    periodo: { diaIni: from, diaFim: to, dias: days.length },
    faturamentoCategoria: total,
    porDia: [...perDay.entries()].sort().map(([dia, v]) => ({ dia, ...v })),
    marcasTotal: [...brands.values()]
      .sort((a, b) => b.t - a.t)
      .slice(0, 500)
      .map((b) => ({ marca: b.marca, faturamento: b.t, unidades: b.u, produtos: b.products.size, tendencia: trend(b), serie: b.serie })),
    lojas: [...shops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, faturamento]) => ({ id, faturamento })),
    produtos,
  };
}

/** Puxada em andamento (roda em segundo plano: as vendas de 15 dias levam alguns minutos). */
export const pullState: { running: boolean; startedAt: number | null; last: string | null; error: string | null } = { running: false, startedAt: null, last: null, error: null };

export function startPull(opts: { categorias?: string[]; dias?: number; vendas?: boolean }) {
  if (pullState.running) return false;
  Object.assign(pullState, { running: true, startedAt: Date.now(), error: null });
  pullMarket(opts)
    .then((m) => (pullState.last = m))
    .catch((e) => {
      pullState.error = (e as Error).message;
      log("warn", `Estudo de Mercado: ${pullState.error}`);
    })
    .finally(() => (pullState.running = false));
  return true;
}

export async function pullMarket(opts: { categorias?: string[]; dias?: number; vendas?: boolean }) {
  const all = await radarCategories().catch(() => [] as RadarCat[]);
  let cats = opts.categorias?.length ? opts.categorias : radarConfig().categorias;
  if (!cats.length) cats = all.map((c) => c.id);
  if (!cats.length) throw new Error("Nenhuma categoria no RadarHub");
  const done: string[] = [];
  for (const c of cats) {
    const info = all.find((x) => x.id === c || x.nome.toLowerCase() === c.toLowerCase());
    const id = info?.id || c;
    const last = info?.ultimoDia;
    const dias = Math.min(opts.dias || 15, info?.diasComDados || 15);
    const q = encodeURIComponent(id);
    const mv = `dias=${dias}&porMarca=50`;
    saveSnapshot("mais-vendidos", id, mv, await radarGet(`/api/v1/mais-vendidos?categoria=${q}&${mv}`), last);
    const ea = `dias=${dias}`;
    saveSnapshot("em-alta", id, ea, await radarGet(`/api/v1/em-alta?categoria=${q}&${ea}`), last);
    if (opts.vendas !== false && last) {
      const from = addDays(last, -(dias - 1));
      saveSnapshot("vendas", id, `dias=${dias}`, await pullVendas(id, from, last), last);
    }
    done.push(info ? info.nome : c);
  }
  const msg = `Estudo de Mercado: RadarHub puxado (${done.join(", ")})`;
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
  const catRevenue = s.extra.categoryRevenue || null;
  const totalUnits = sum(items.map((i) => i.units));
  const growths = items.map((i) => i.growth).filter((x): x is number => x != null);

  // marcas
  const brands = new Map<string, { brand: string; revenue: number; units: number; products: number; growth: number[]; trend?: number | null; series?: number[] | null }>();
  for (const it of items) {
    const b = it.brand ? brandKey(it.brand) : "Sem marca";
    const e = brands.get(b) || { brand: it.brand || b, revenue: 0, units: 0, products: 0, growth: [] };
    e.revenue += it.revenue || 0;
    e.units += it.units || 0;
    e.products++;
    if (it.growth != null) e.growth.push(it.growth);
    brands.set(b, e);
  }
  for (const [k, t] of s.extra.brandTotals) {
    const e = brands.get(k);
    if (e) Object.assign(e, { revenue: t.revenue, units: t.units || e.units, trend: t.growth, series: t.series, products: t.products || e.products });
  }
  const brandRows = [...brands.values()]
    .map((b) => ({
      brand: b.brand, revenue: b.revenue, units: b.units, products: b.products,
      share: (catRevenue || totalRevenue) ? b.revenue / (catRevenue || totalRevenue) : 0,
      growth: b.trend ?? median(b.growth), series: b.series ?? null,
      ticket: b.units ? b.revenue / b.units : null,
    }))
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
  const base = catRevenue || totalRevenue;
  const top10Share = base ? sum(byRev.slice(0, 10).map((i) => i.revenue)) / base : null;
  const top3BrandShare = base ? sum(brandRows.slice(0, 3).map((b) => b.revenue)) / base : null;

  const rows = items.map((it) => {
    const o = ours(it);
    const p = prevBy.get(key(it));
    return {
      ...it,
      share: it.catShare ?? (totalRevenue && it.revenue ? it.revenue / totalRevenue : null),
      ours: o,
      prev: p ? { position: p.position, revenue: p.revenue, units: p.units } : null,
      delta: p && p.revenue && it.revenue ? ((it.revenue - p.revenue) / p.revenue) * 100 : null,
      isNew: !!prev && !p,
    };
  });

  // tendência só conta para quem tem volume (senão quem vendeu 1 e depois 10 vira +900%)
  const minRev = base * 0.001;
  const relevant = (r: (typeof rows)[number]) => !minRev || (r.revenue || 0) >= minRev;

  // oportunidades: vende bem ou está subindo e a gente quase não posta
  const opportunities = rows
    .filter((r) => relevant(r) && (r.ours?.offers || 0) <= 2 && ((r.growth || 0) >= 15 || (r.position != null && r.position <= 20) || (r.share || 0) >= 0.005))
    .sort((a, b) => (b.growth || 0) + (b.share || 0) * 1000 - ((a.growth || 0) + (a.share || 0) * 1000))
    .slice(0, 25);

  const covered = rows.filter((r) => r.ours).length;

  return {
    meta: s.meta,
    compare: prev?.meta || null,
    days: s.extra.days,
    shops: s.extra.shops.slice(0, 10).map((x) => ({ id: String(x.id), revenue: num(x.faturamento) || 0, share: catRevenue ? (num(x.faturamento) || 0) / catRevenue : null })),
    kpis: {
      categoryRevenue: catRevenue,
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
    brands: brandRows.slice(0, 300),
    brandRisers: brandRows.filter((b) => b.growth != null && b.share >= 0.002).sort((a, b) => b.growth! - a.growth!).slice(0, 12),
    brandFallers: brandRows.filter((b) => b.growth != null && b.growth < 0 && b.share >= 0.002).sort((a, b) => a.growth! - b.growth!).slice(0, 12),
    bands,
    sizes: sizes.slice(0, 10),
    origins,
    risers: [...rows].filter((r) => r.growth != null && relevant(r)).sort((a, b) => b.growth! - a.growth!).slice(0, 20),
    fallers: [...rows].filter((r) => r.growth != null && r.growth < 0 && relevant(r)).sort((a, b) => a.growth! - b.growth!).slice(0, 20),
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
