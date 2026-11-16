/**
 * Vendas do Mercado Livre vindas do RadarHub.
 * Serve para dar prioridade aos perfumes que estão vendendo cada vez mais (lançamento disparando, etc.).
 *
 * Entrada: as respostas da API do RadarHub como vêm (mais-vendidos e em-alta), por push (POST /api/vendas)
 * ou puxadas daqui quando RADARHUB_URL estiver configurado.
 */
import { db, log } from "./db.ts";
import { nameTokens, perfumeInfo, tokenSimilarity } from "./perfume.ts";

type Item = {
  produto?: string; nome?: string; titulo?: string; marca?: string; posicao?: number;
  faturamento?: number; unidades?: number; tendencia?: number | string | null; variacaoVsAnterior?: number | string | null;
};
type Payload = {
  categoria?: string | { id?: string; nome?: string };
  periodo?: unknown;
  marcas?: { marca?: string; produtos?: Item[] }[];
  produtos?: Item[];
  itens?: Item[];
  items?: Item[];
};

const num = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[%+\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Detecta se a variação veio em fração (0,19) ou em % (19) olhando o lote todo. */
function toPercent(values: (number | null)[]) {
  const xs = values.filter((x): x is number => x != null);
  const fraction = xs.length > 0 && xs.every((x) => Math.abs(x) <= 5);
  return (x: number | null) => (x == null ? null : fraction ? x * 100 : x);
}

export function ingestSales(kind: "em_alta" | "mais_vendidos", payload: Payload): number {
  const cat = typeof payload.categoria === "object" ? payload.categoria?.nome || payload.categoria?.id || "" : payload.categoria || "";
  const list: Item[] = [];
  for (const m of payload.marcas || []) for (const p of m.produtos || []) list.push({ marca: m.marca, ...p });
  list.push(...(payload.produtos || []), ...(payload.itens || []), ...(payload.items || []));
  if (!list.length) return 0;

  const growths = list.map((i) => num(kind === "em_alta" ? i.tendencia ?? i.variacaoVsAnterior : i.variacaoVsAnterior ?? i.tendencia));
  const pct = toPercent(growths);
  // posição por faturamento quando não vier
  const sorted = [...list].sort((a, b) => (num(b.faturamento) || 0) - (num(a.faturamento) || 0));

  const d = db();
  d.prepare("DELETE FROM sales WHERE kind = ? AND COALESCE(category,'') = ?").run(kind, String(cat));
  const ins = d.prepare(
    "INSERT INTO sales (kind, category, name, brand, ml, tokens, position, revenue, units, growth, period) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  );
  let n = 0;
  list.forEach((it, idx) => {
    const name = String(it.produto || it.nome || it.titulo || "").trim();
    if (!name) return;
    const tokens = nameTokens(`${name}`);
    if (!tokens.length) return;
    const info = perfumeInfo(name);
    ins.run(
      kind, String(cat), name, it.marca || null, info?.ml ?? null, JSON.stringify(tokens),
      num(it.posicao) ?? sorted.indexOf(it) + 1, num(it.faturamento), num(it.unidades), pct(growths[idx]),
      typeof payload.periodo === "string" ? payload.periodo : JSON.stringify(payload.periodo ?? null),
    );
    n++;
  });
  return n;
}

type SaleRow = { kind: string; name: string; ml: number | null; tokens: string; position: number | null; growth: number | null; revenue: number | null };

let cache: { at: number; rows: (SaleRow & { tk: string[] })[] } | null = null;
function recentSales() {
  if (cache && Date.now() - cache.at < 60e3) return cache.rows;
  // vendas valem por 5 dias (a coleta do RadarHub roda com alguns dias de atraso)
  const rows = (db().prepare("SELECT kind, name, ml, tokens, position, growth, revenue FROM sales WHERE updated_at >= datetime('now','-5 days')").all() as SaleRow[])
    .map((r) => ({ ...r, tk: JSON.parse(r.tokens) as string[] }));
  cache = { at: Date.now(), rows };
  return rows;
}
export function clearSalesCache() {
  cache = null;
}

export type SalesBoost = { boost: number; note: string; growth: number | null; name: string };

/**
 * Bônus de até +25 na nota: até +15 pelo crescimento das vendas e até +10 por estar no topo dos mais vendidos.
 * Casa pelo nome do perfume (mesmas palavras da linha), qualquer tamanho.
 */
export function salesBoostFor(productName: string, ml?: number): SalesBoost | null {
  const rows = recentSales();
  if (!rows.length) return null;
  const tk = nameTokens(productName);
  if (!tk.length) return null;
  let best: SalesBoost | null = null;
  for (const r of rows) {
    const sim = tokenSimilarity(tk, r.tk);
    if (sim < 0.75) continue;
    if (ml && r.ml && r.ml !== ml && sim < 1) continue;
    const g = r.growth ?? 0;
    let boost = 15 * Math.min(1, Math.max(0, g) / 100);
    if (r.kind === "mais_vendidos" && r.position) boost += 10 * Math.max(0, 1 - (r.position - 1) / 30);
    if (r.kind === "em_alta") boost = Math.max(boost, 10); // estar no "em alta" já é sinal forte
    boost = Math.round(Math.min(25, boost));
    if (!best || boost > best.boost) {
      const note = r.kind === "em_alta"
        ? `em alta no ML${r.growth != null ? ` (+${Math.round(r.growth)}%)` : ""}`
        : `top ${r.position} vendas ML${r.growth != null ? ` (${r.growth >= 0 ? "+" : ""}${Math.round(r.growth)}%)` : ""}`;
      best = { boost, note, growth: r.growth, name: r.name };
    }
  }
  return best && best.boost > 0 ? best : null;
}

/* ---------------- puxar do RadarHub (quando ele estiver acessível pela internet) ---------------- */

export async function pullRadarHub(): Promise<string> {
  const base = (process.env.RADARHUB_URL || "").replace(/\/+$/, "");
  const token = process.env.RADARHUB_TOKEN || "";
  const cats = (process.env.RADARHUB_CATEGORIAS || "").split(",").map((c) => c.trim()).filter(Boolean);
  if (!base || !cats.length) return "RadarHub não configurado";
  const get = async (p: string) => {
    const r = await fetch(`${base}${p}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60e3) });
    if (!r.ok) throw new Error(`${p} → HTTP ${r.status}`);
    return r.json();
  };
  let total = 0;
  for (const c of cats) {
    const q = encodeURIComponent(c);
    total += ingestSales("mais_vendidos", await get(`/api/v1/mais-vendidos?categoria=${q}&dias=7&porMarca=10`));
    total += ingestSales("em_alta", await get(`/api/v1/em-alta?categoria=${q}&dias=14`));
  }
  clearSalesCache();
  const msg = `Vendas do RadarHub atualizadas: ${total} produtos de ${cats.length} categoria(s)`;
  log("info", msg);
  return msg;
}
