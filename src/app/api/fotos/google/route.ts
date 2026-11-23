import { googlePhoto } from "@/lib/googleimages";

export const dynamic = "force-dynamic";

/** Teste da busca de foto no Google Imagens: ?name=Lattafa Fakhar Black 100ml (&img=1 devolve a foto). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const name = q.get("name") || "";
  if (!name) return Response.json({ error: "falta ?name=" }, { status: 400 });
  const r = await googlePhoto(name, { listing: q.get("listing") || undefined });
  if (!r) return Response.json({ found: false });
  if (q.get("img")) return new Response(new Uint8Array(r.buf), { headers: { "content-type": "image/jpeg" } });
  return Response.json({ found: true, url: r.url, label: r.label, bytes: r.buf.length });
}
