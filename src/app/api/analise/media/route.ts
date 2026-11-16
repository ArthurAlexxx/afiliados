import { Evolution } from "@/lib/evolution";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Baixa a imagem original de uma mensagem (id) pela Evolution. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return new Response("id obrigatório", { status: 400 });
  const r = await new Evolution(getSettings()).getBase64FromMediaMessage(id);
  if (!r.base64) return new Response("sem mídia", { status: 404 });
  return new Response(Buffer.from(r.base64.replace(/^data:[^,]+,/, ""), "base64"), {
    headers: { "content-type": r.mimetype || "image/jpeg" },
  });
}
