import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { clearSalesCache, ingestSales, pullRadarHub } from "@/lib/sales";

export const dynamic = "force-dynamic";

/** O que está guardado das vendas do ML (RadarHub). */
export function GET() {
  const rows = db()
    .prepare("SELECT kind, category, name, brand, position, revenue, units, growth, updated_at FROM sales ORDER BY kind, position LIMIT 500")
    .all();
  return Response.json({ rows });
}

/**
 * Recebe as respostas da API do RadarHub.
 * Body: { tipo: "mais_vendidos" | "em_alta", dados: <resposta da API> } ou { puxar: true }.
 * Chave: cabeçalho x-api-key (VENDAS_TOKEN ou o token do webhook).
 */
export async function POST(req: Request) {
  const key = req.headers.get("x-api-key") || new URL(req.url).searchParams.get("token") || "";
  const expected = process.env.VENDAS_TOKEN || getSettings().webhookToken;
  if (!expected || key !== expected) return Response.json({ error: "chave inválida" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { tipo?: string; dados?: unknown; puxar?: boolean };
  if (body.puxar) return Response.json({ ok: true, msg: await pullRadarHub() });
  const kind = body.tipo === "em_alta" || body.tipo === "em-alta" ? "em_alta" : "mais_vendidos";
  const n = ingestSales(kind, (body.dados || {}) as Parameters<typeof ingestSales>[1]);
  clearSalesCache();
  return Response.json({ ok: true, produtos: n });
}
