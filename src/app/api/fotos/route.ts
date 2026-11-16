import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Galeria: lista de perfumes com fotos (?q=) ou as fotos de um perfume (?id=). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = Number(u.searchParams.get("id") || 0);
  if (id) {
    const product = db().prepare("SELECT id, name FROM products WHERE id = ?").get(id);
    const images = db()
      .prepare(
        `SELECT i.id, i.width, i.height, i.score, i.disabled, i.created_at, i.message_id, COALESCE(g.name, '') group_name
         FROM images i LEFT JOIN groups g ON g.jid = i.group_jid WHERE i.product_id = ? ORDER BY i.disabled, i.score DESC`,
      )
      .all(id);
    return Response.json({ product, images });
  }
  const q = `%${(u.searchParams.get("q") || "").trim()}%`;
  const rows = db()
    .prepare(
      `SELECT p.id, p.name, COUNT(i.id) n, SUM(i.disabled = 0) active,
              (SELECT i2.id FROM images i2 WHERE i2.product_id = p.id AND i2.disabled = 0 ORDER BY i2.score DESC LIMIT 1) cover,
              MAX(i.created_at) last
       FROM products p JOIN images i ON i.product_id = p.id
       WHERE p.name LIKE ? GROUP BY p.id ORDER BY last DESC LIMIT 300`,
    )
    .all(q);
  const total = db().prepare("SELECT COUNT(*) n FROM images WHERE disabled = 0").get() as { n: number };
  return Response.json({ rows, total: total.n });
}

/** { id, disabled } liga ou desliga uma foto (desligada não é usada nos posts). */
export async function PATCH(req: Request) {
  const { id, disabled } = (await req.json()) as { id: number; disabled: boolean };
  db().prepare("UPDATE images SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, id);
  return Response.json({ ok: true });
}
