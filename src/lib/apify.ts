import { db, log } from "./db.ts";

/**
 * Quando a conta do Apify fica sem saldo (plano grátis: US$ 5 por mês), toda chamada volta 402/403.
 * Aí paramos de chamar por 1h, em vez de encher o log de erro a cada rodada.
 */
// no globalThis: o robô e as rotas do painel enxergam a mesma pausa
const P = ((globalThis as { __apifyPause?: { until: number; reason: string } }).__apifyPause ??= { until: 0, reason: "" });

export function apifyOff(): string | null {
  return Date.now() < P.until ? P.reason : null;
}

export function checkApify() {
  const r = apifyOff();
  if (r) throw new Error(r);
}

/** Chame com a resposta que não deu ok. Se for falta de saldo, pausa o Apify por 1h. */
export async function apifyFail(what: string, r: Response): Promise<Error> {
  const body = (await r.text().catch(() => "")).replace(/\s+/g, " ");
  // muitas execuções ao mesmo tempo (o plano deixa 5) não é falta de saldo: não pausa
  if ((r.status === 402 || r.status === 403) && /usage|actor-disabled|limit|plan/i.test(body) && !/concurren|memory|parallel/i.test(body)) {
    const first = !apifyOff();
    P.until = Date.now() + 60 * 60 * 1000;
    P.reason = "Apify sem saldo neste mês: busca no Fragrantica pausada";
    if (first) log("error", `${P.reason} (tento de novo em 1h)`);
    return new Error(P.reason);
  }
  return new Error(`${what} ${r.status}: ${body.slice(0, 300)}`);
}

/**
 * Registro de cada puxada paga (página Scraping): tipo, perfume, itens, custo estimado, tempo e resultado.
 * O custo segue a tabela de preço de cada robô no Apify, conforme o plano da conta (FREE, BRONZE...).
 */
export type CallKind = "frag_search" | "frag_google" | "frag_details" | "frag_photos" | "pinterest" | "google_images";

export const KIND_LABEL: Record<CallKind, string> = {
  frag_search: "Busca do nome (Fragrantica)",
  frag_google: "Busca reserva (Google)",
  frag_details: "Ficha do perfume (notas, acordes)",
  frag_photos: "Fotos do Fragrantica (página)",
  pinterest: "Pinterest (desligado)",
  google_images: "Fotos do Google Imagens",
};

// preços dos robôs (US$), por nível do plano. FREE e BRONZE (Starter) são os que importam aqui.
const PRICES: Record<string, { start: number; listing: number; profile: number; search: number; fetch: number; pin: number }> = {
  FREE: { start: 0.001, listing: 0.00029, profile: 0.00079, search: 0.005, fetch: 0.0015, pin: 0.0002 },
  BRONZE: { start: 0.001, listing: 0.00029, profile: 0.00079, search: 0.0015, fetch: 0.0015, pin: 0.0002 },
  SILVER: { start: 0.001, listing: 0.00028, profile: 0.00078, search: 0.00125, fetch: 0.00125, pin: 0.0002 },
  GOLD: { start: 0.001, listing: 0.00027, profile: 0.00077, search: 0.001, fetch: 0.001, pin: 0.0002 },
};
let tier = "FREE";
export function setApifyTier(t: string | null | undefined) {
  if (t) tier = PRICES[t] ? t : t === "PLATINUM" || t === "DIAMOND" ? "GOLD" : tier;
}
export function priceTable() {
  return { tier, ...PRICES[tier] };
}

export function estimateCost(kind: CallKind, items: number): number {
  const p = PRICES[tier];
  switch (kind) {
    case "frag_search":
      return p.start + items * p.listing;
    case "frag_details":
      return p.start + Math.max(1, items) * p.profile;
    case "frag_google":
      return 0.00005 + p.search;
    case "frag_photos":
      return 0.00005 + p.fetch;
    case "pinterest":
      return 0.00005 + items * p.pin;
    case "google_images":
      return 0.00002 + items * 0.00011;
  }
}

export function recordCall(c: { kind: CallKind; productId?: number | null; label?: string; items?: number; ok?: boolean; ms?: number; result?: string; cost?: number }) {
  try {
    const items = c.items ?? 0;
    db()
      .prepare("INSERT INTO api_calls (kind, product_id, label, items, cost_usd, ok, ms, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(c.kind, c.productId ?? null, (c.label || "").slice(0, 200), items, c.ok === false && !items ? 0 : (c.cost ?? estimateCost(c.kind, items)), c.ok === false ? 0 : 1, c.ms ?? null, (c.result || "").slice(0, 300));
  } catch {
    /* registro nunca derruba a busca */
  }
}

/** Mede e registra uma chamada: devolve o resultado dela, ou repassa o erro já registrado. */
export async function tracked<T>(kind: CallKind, meta: { productId?: number | null; label?: string }, fn: () => Promise<T>, summarize: (r: T) => { items: number; result: string }): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    const s = summarize(r);
    recordCall({ kind, ...meta, items: s.items, result: s.result, ms: Date.now() - t0 });
    return r;
  } catch (e) {
    const msg = (e as Error).message;
    // sem saldo: o Apify não cobra; não registra 1 linha por rodada
    if (!/sem saldo/.test(msg)) recordCall({ kind, ...meta, ok: false, result: msg, ms: Date.now() - t0 });
    throw e;
  }
}

let tierAt = 0;
/** Lê o nível do plano no Apify (de 6 em 6 horas), para o custo estimado de cada puxada sair certo. */
export async function refreshTier() {
  if (!process.env.APIFY_TOKEN || Date.now() - tierAt < 6 * 3600e3) return;
  tierAt = Date.now();
  try {
    const r = await fetch("https://api.apify.com/v2/users/me", { headers: { authorization: `Bearer ${process.env.APIFY_TOKEN}` }, signal: AbortSignal.timeout(15000) });
    if (r.ok) setApifyTier(((await r.json()) as { data?: { plan?: { tier?: string } } }).data?.plan?.tier);
  } catch {
    /* tenta de novo depois */
  }
}

/**
 * Teto de gasto por dia das buscas automáticas (Arthur, 17/nov: "daqui 1 a 2 horas acaba o dinheiro").
 * Padrão US$ 0,15 por dia (o plano grátis dá US$ 5 por mês). Muda com APIFY_DAILY_USD no Railway.
 * Colar o link à mão na tela Fotos não conta para o teto.
 */
export function dailyLimitUsd() {
  const v = Number(process.env.APIFY_DAILY_USD);
  return Number.isFinite(v) && v > 0 ? v : 0.15;
}
export function spentTodayUsd(): number {
  // o gasto de antes da regra "só o post esperando foto" (17/nov 15:20) não conta para o teto
  return (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) n FROM api_calls WHERE date(at, '-3 hours') = date('now', '-3 hours') AND at >= '2026-11-17 18:20:00'").get() as { n: number }).n;
}
let budgetLogged = "";
export function overDailyBudget(): boolean {
  const spent = spentTodayUsd();
  if (spent < dailyLimitUsd()) return false;
  const day = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  if (budgetLogged !== day) {
    budgetLogged = day;
    log("info", `Apify: teto do dia atingido (US$ ${spent.toFixed(3)} de US$ ${dailyLimitUsd().toFixed(2)}); buscas automáticas voltam amanhã`);
  }
  return true;
}
