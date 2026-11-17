import { db, log } from "@/lib/db";
import { fetchDetails, fetchFragram } from "@/lib/fragrantica";

export const dynamic = "force-dynamic";

/** { productId, url }: o Arthur cola o link do perfume no Fragrantica quando a busca automática não achou. */
export async function POST(req: Request) {
  const b = (await req.json()) as { productId?: number; url?: string };
  const pid = Number(b.productId);
  const m = /^https?:\/\/(www\.)?fragrantica\.[a-z.]+(\/(perfume|parfum|perfumes|perfumy|parfem)\/[^?#\s]+\.html)/i.exec((b.url || "").trim());
  if (!pid || !m) return Response.json({ error: "cole o link da página do perfume no Fragrantica (…/perfume/Marca/Nome-123.html)" }, { status: 400 });
  const url = `https://www.fragrantica.com/perfume${m[2].replace(/^\/[^/]+/, "")}`;
  db().prepare("UPDATE products SET frag_url = ?, frag_checked_at = datetime('now'), fragram_at = NULL WHERE id = ?").run(url, pid);
  log("info", `Fragrantica: link colocado à mão no perfume #${pid}: ${url}`);
  try {
    const n = await fetchFragram(pid);
    fetchDetails(pid).catch(() => undefined);
    return Response.json({ msg: n ? `${n} foto(s) do Fragrantica trazidas` : "Página ligada, mas ela não tem Fragram Photos" });
  } catch (e) {
    return Response.json({ error: `Página ligada, mas as fotos não vieram: ${(e as Error).message}` }, { status: 400 });
  }
}
