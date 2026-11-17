import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Posts prontos esperando o Arthur escolher a foto (leve: a tela consulta a cada poucos segundos). */
export async function GET() {
  const rows = db()
    .prepare(
      `SELECT q.id post, q.product_id id, p.name, q.created_at,
         (SELECT COUNT(*) FROM frag_photos f WHERE f.frag_url = p.frag_url) photos,
         CASE WHEN p.fragram_at IS NOT NULL OR (p.frag_url IS NULL AND p.frag_searched > 0) THEN 1 ELSE 0 END searched
       FROM posts q JOIN products p ON p.id = q.product_id
       WHERE q.status = 'photo' ORDER BY q.id DESC LIMIT 50`,
    )
    .all();
  return Response.json({ rows });
}
