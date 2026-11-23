import { storePhoto } from "@/lib/lojas";

export const dynamic = "force-dynamic";

/** Teste da busca de foto oficial nas lojas: ?name=Lattafa Fakhar Black 100ml (&img=1 devolve a foto). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const name = q.get("name") || "";
  if (!name) return Response.json({ error: "falta ?name=" }, { status: 400 });
  const r = await storePhoto(name, { listing: q.get("listing") || undefined, debug: !q.get("img") });
  if (q.get("img") && r?.buf.length) return new Response(new Uint8Array(r.buf), { headers: { "content-type": "image/jpeg" } });
  return Response.json({ found: !!r?.buf.length, url: r?.url, label: r?.label, tried: r?.tried });
}
