import { db, log } from "@/lib/db";
import { canonicalName, fetchDetails, fetchFragram } from "@/lib/fragrantica";

export const dynamic = "force-dynamic";

/** { productId, url }: o Arthur cola o link do perfume no Fragrantica quando a busca automática não achou. */
export async function POST(req: Request) {
  const b = (await req.json()) as { productId?: number; url?: string };
  const pid = Number(b.productId);
  const m = /^https?:\/\/(www\.)?fragrantica\.[a-z.]+(\/(perfume|parfum|perfumes|perfumy|parfem)\/[^?#\s]+\.html)/i.exec((b.url || "").trim());
  if (!pid || !m) return Response.json({ error: "cole o link da página do perfume no Fragrantica (…/perfume/Marca/Nome-123.html)" }, { status: 400 });
  const url = `https://www.fragrantica.com/perfume${m[2].replace(/^\/[^/]+/, "")}`;
  // nome padrão a partir do link: /perfume/Lattafa-Perfumes/Art-of-Arabia-I-92423.html
  const parts = /\/perfume\/([^/]+)\/(.+)-\d+\.html$/.exec(url);
  const brand = parts ? decodeURIComponent(parts[1]).replace(/-/g, " ") : null;
  const fname = parts ? decodeURIComponent(parts[2]).replace(/-/g, " ") : null;
  const ml = (db().prepare("SELECT ml FROM products WHERE id = ?").get(pid) as { ml: number } | undefined)?.ml || 0;
  const name = brand && fname ? canonicalName({ brand, name: fname }, ml) : null;
  db()
    .prepare("UPDATE products SET frag_url = ?, frag_checked_at = datetime('now'), fragram_at = NULL, frag_brand = COALESCE(?, frag_brand), frag_name = COALESCE(?, frag_name), name = COALESCE(?, name) WHERE id = ?")
    .run(url, brand, fname, name, pid);
  log("info", `Fragrantica: link colocado à mão no perfume #${pid}: ${url}`);
  try {
    const n = await fetchFragram(pid);
    fetchDetails(pid).catch(() => undefined);
    return Response.json({ msg: n ? `${n} foto(s) do Fragrantica trazidas` : "Página ligada, mas ela não tem Fragram Photos" });
  } catch (e) {
    return Response.json({ error: `Página ligada, mas as fotos não vieram: ${(e as Error).message}` }, { status: 400 });
  }
}
