import { mediaOf } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/** Foto/vídeo/áudio de uma mensagem (?id=), guardado em cache depois da primeira vez. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  const m = id ? await mediaOf(id) : null;
  if (!m) return new Response("não encontrado", { status: 404 });
  return new Response(new Uint8Array(m.buf), { headers: { "content-type": m.type, "cache-control": "private, max-age=86400" } });
}
