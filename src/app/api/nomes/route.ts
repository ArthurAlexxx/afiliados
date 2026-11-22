import { db } from "@/lib/db";
import { perfumeInfo } from "@/lib/perfume";

export const dynamic = "force-dynamic";

const CONC: Record<string, string> = { edp: "EDP", edt: "EDT", parfum: "Parfum", extrait: "Extrait", elixir: "Elixir", colonia: "Colônia", deo: "Deo colônia", edc: "EDC" };

/** Dicionário de nomes: cada perfume com todos os jeitos que os grupos escrevem e os anúncios do ML ligados a ele. */
export function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim().toLowerCase();
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const ids = (
    q
      ? db()
          .prepare(
            `SELECT DISTINCT p.id FROM products p LEFT JOIN name_aliases a ON a.product_id = p.id
             WHERE lower(p.name) LIKE ? OR lower(COALESCE(p.frag_name,'')) LIKE ? OR a.alias LIKE ? OR lower(COALESCE(a.title,'')) LIKE ? LIMIT 60`,
          )
          .all(like, like, like, like)
      : db()
          .prepare(
            `SELECT p.id FROM products p JOIN name_aliases a ON a.product_id = p.id GROUP BY p.id ORDER BY COUNT(*) DESC, SUM(a.hits) DESC LIMIT 60`,
          )
          .all()
  ).map((r) => (r as { id: number }).id);
  const rows = ids.map((id) => {
    const p = db().prepare("SELECT id, name, ml, conc, frag_name, frag_brand, frag_url FROM products WHERE id = ?").get(id) as {
      id: number; name: string; ml: number; conc: string | null; frag_name: string | null; frag_brand: string | null; frag_url: string | null;
    };
    const conc = perfumeInfo(p.name)?.conc ?? p.conc;
    const aliases = db().prepare("SELECT title, hits FROM name_aliases WHERE product_id = ? ORDER BY hits DESC LIMIT 40").all(id) as { title: string; hits: number }[];
    const meli = db().prepare("SELECT meli_id, hits FROM meli_refs WHERE product_id = ? ORDER BY hits DESC LIMIT 10").all(id) as { meli_id: string; hits: number }[];
    return { ...p, concLabel: conc ? CONC[conc] || conc : null, aliases, meli };
  });
  const totals = {
    products: (db().prepare("SELECT COUNT(*) n FROM products").get() as { n: number }).n,
    aliases: (db().prepare("SELECT COUNT(*) n FROM name_aliases").get() as { n: number }).n,
    meli: (db().prepare("SELECT COUNT(*) n FROM meli_refs").get() as { n: number }).n,
  };
  return Response.json({ rows, totals });
}
