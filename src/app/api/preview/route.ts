import { buildPost } from "@/lib/pipeline";
import { getSettings, type Settings } from "@/lib/settings";
import { renderTemplate, parsePromo } from "@/lib/parser";

export const dynamic = "force-dynamic";

/**
 * Simula a conversão de uma mensagem.
 * offline=true → não acessa a internet (link fictício), só testa template/parser.
 */
export async function POST(req: Request) {
  const { text, template, offline } = (await req.json()) as { text: string; template?: string; offline?: boolean };
  const s: Settings = { ...getSettings(), ...(template ? { template } : {}) };
  if (offline) {
    const data = { ...parsePromo(text), link: "https://meli.la/SEU-LINK", links: "https://meli.la/SEU-LINK", texto: text, grupo_origem: "Grupo de teste", loja: "Mercado Livre" };
    return Response.json({ formatted: renderTemplate(s.template, data), data, conversions: [], status: "queued", reason: null });
  }
  const r = await buildPost(text, s, { groupName: "Grupo de teste", wantImage: s.fetchProductImage });
  return Response.json(r);
}
