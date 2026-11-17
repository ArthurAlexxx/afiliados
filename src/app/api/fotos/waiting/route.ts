import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Posts prontos esperando o Arthur escolher a foto (leve: a tela consulta a cada poucos segundos). */
export async function GET() {
  const rows = db()
    .prepare(
      `SELECT q.id post, q.product_id id, p.name, q.created_at FROM posts q JOIN products p ON p.id = q.product_id
       WHERE q.status = 'photo' ORDER BY q.id DESC LIMIT 50`,
    )
    .all();
  return Response.json({ rows });
}
