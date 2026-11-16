import { runTop5, top5Picks } from "@/lib/top5";

export const dynamic = "force-dynamic";

/** Prévia do Top 5 de hoje: ?img=1 devolve a imagem; sem isso, a lista e a legenda. */
export async function GET(req: Request) {
  const wantImg = new URL(req.url).searchParams.get("img");
  const r = await runTop5({ force: true, dryRun: true });
  if (wantImg) {
    if (!r.image) return new Response(r.msg, { status: 404 });
    return new Response(new Uint8Array(r.image), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
  }
  return Response.json({ msg: r.msg, caption: r.caption || null, picks: top5Picks().map((p) => ({ titulo: p.titulo, preco: p.preco, pct: p.pct })) });
}

/** Monta e coloca na fila agora (sem esperar as 21h). */
export async function POST() {
  return Response.json(await runTop5({ force: true }));
}
