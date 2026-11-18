import { db } from "@/lib/db";
import { analyze, deleteSnapshot, history, listSnapshots, pullMarket, radarConfig, radarGet, saveSnapshot } from "@/lib/market";

export const dynamic = "force-dynamic";

/** Se ainda não há retratos, aproveita o que já veio do RadarHub pela /api/vendas. */
function seedFromSales() {
  if (listSnapshots().length) return;
  const rows = db()
    .prepare("SELECT kind, category, name, brand, position, revenue, units, growth, date(updated_at,'-3 hours') day FROM sales")
    .all() as { kind: string; category: string | null; name: string; brand: string | null; position: number | null; revenue: number | null; units: number | null; growth: number | null; day: string }[];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.kind}|${r.category || ""}|${r.day}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  for (const [k, list] of groups) {
    const [kind, cat, day] = k.split("|");
    saveSnapshot(
      kind === "em_alta" ? "em-alta" : "mais-vendidos",
      cat,
      "vendas",
      { produtos: list.map((r) => ({ produto: r.name, marca: r.brand, posicao: r.position, faturamento: r.revenue, unidades: r.units, tendencia: r.growth })) },
      day,
    );
  }
}

/**
 * GET                      → retratos guardados + configuração do RadarHub
 * GET ?id=&vs=             → análise de um retrato (comparando com outro)
 * GET ?hist=termo&endpoint=&categoria= → evolução de um perfume/marca nas datas
 */
export function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  if (u.get("hist")) return Response.json({ points: history(u.get("endpoint") || "", u.get("categoria") || "", u.get("hist")!) });
  const id = Number(u.get("id") || 0);
  if (id) {
    const a = analyze(id, Number(u.get("vs") || 0) || undefined);
    return a ? Response.json(a) : Response.json({ error: "retrato não encontrado" }, { status: 404 });
  }
  seedFromSales();
  const c = radarConfig();
  return Response.json({ snapshots: listSnapshots(), radar: { configured: !!c.url, host: c.url ? new URL(c.url).host : null, hasToken: c.hasToken, categorias: c.categorias } });
}

/**
 * POST { acao: "puxar", categorias?, dias? }        → puxa do RadarHub e guarda
 * POST { acao: "consultar", caminho, guardar? }     → GET livre na API do RadarHub (/api/...)
 * POST { acao: "importar", endpoint, categoria, data?, dados } → guarda uma resposta colada/enviada
 * POST { acao: "apagar", id }
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    acao?: string; categorias?: string[]; dias?: number; caminho?: string; guardar?: boolean;
    endpoint?: string; categoria?: string; data?: string; dados?: unknown; id?: number;
  };
  try {
    switch (body.acao) {
      case "puxar":
        return Response.json({ ok: true, msg: await pullMarket({ categorias: body.categorias, dias: body.dias }) });
      case "consultar": {
        const path = String(body.caminho || "");
        const dados = await radarGet(path);
        let saved = null;
        if (body.guardar) {
          const [p, q = ""] = path.split("?");
          const qs = new URLSearchParams(q);
          const cat = qs.get("categoria") || "";
          qs.delete("categoria");
          saved = saveSnapshot(p.replace(/^\/api\/v\d+\//, ""), cat, qs.toString(), dados);
        }
        return Response.json({ ok: true, dados, saved });
      }
      case "importar": {
        if (!body.dados) return Response.json({ error: "faltou o JSON" }, { status: 400 });
        const dados = typeof body.dados === "string" ? JSON.parse(body.dados) : body.dados;
        const s = saveSnapshot(body.endpoint || "mais-vendidos", body.categoria || "", "importado", dados, body.data);
        if (!s.items) return Response.json({ error: "não achei produtos nesse JSON" }, { status: 400 });
        return Response.json({ ok: true, saved: s });
      }
      case "apagar":
        deleteSnapshot(Number(body.id));
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "ação desconhecida" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
