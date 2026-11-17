import { db } from "@/lib/db";
import { bestImagePath } from "@/lib/curation";
import { learnPrefs, prefsSummary } from "@/lib/photoprefs";
import { notPerfume } from "@/lib/perfume";

export const dynamic = "force-dynamic";

/** Galeria: lista de perfumes com fotos (?q=) ou as fotos de um perfume (?id=). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = Number(u.searchParams.get("id") || 0);
  if (id) {
    const product = db().prepare("SELECT id, name, main_image_id FROM products WHERE id = ?").get(id);
    const images = db()
      .prepare(
        `SELECT i.id, i.path, i.width, i.height, i.score, i.disabled, i.created_at, i.message_id, COALESCE(g.name, '') group_name
         FROM images i LEFT JOIN groups g ON g.jid = i.group_jid WHERE i.product_id = ? ORDER BY i.disabled, i.score DESC`,
      )
      .all(id) as { id: number; path?: string }[];
    const usedPath = bestImagePath(id);
    const used = images.find((i) => i.path === usedPath)?.id ?? null;
    for (const i of images) delete i.path;
    return Response.json({ product, images, used, learned: prefsSummary() });
  }
  const q = `%${(u.searchParams.get("q") || "").trim()}%`;
  const rows = db()
    .prepare(
      `SELECT p.id, p.name, COUNT(i.id) n, SUM(i.disabled = 0) active,
              COALESCE(p.main_image_id, (SELECT i2.id FROM images i2 WHERE i2.product_id = p.id AND i2.disabled = 0 ORDER BY i2.score DESC LIMIT 1)) cover,
              p.main_image_id main,
              (SELECT m.message_id LIKE 'pin:%' FROM images m WHERE m.id = p.main_image_id) main_pin,
              (SELECT COUNT(*) FROM pin_photos f WHERE f.product_id = p.id AND f.status = 'pending' AND f.url NOT IN ('none','searching')) pin_pending,
              (SELECT COUNT(*) FROM pin_photos f WHERE f.product_id = p.id) pin_searched,
              MAX(i.created_at) last
       FROM products p JOIN images i ON i.product_id = p.id
       WHERE p.name LIKE ? GROUP BY p.id ORDER BY last DESC LIMIT 300`,
    )
    .all(q)
    // só perfume: creme, loção, body splash… não aparecem
    .filter((r) => !notPerfume((r as { name: string }).name)) as { id: number; cover: number | null }[];
  // capa = a foto que vai nos posts (principal ou a escolha automática)
  const idOf = db().prepare("SELECT id FROM images WHERE path = ?");
  for (const r of rows) {
    const pth = bestImagePath(r.id);
    const hit = pth ? (idOf.get(pth) as { id: number } | undefined) : undefined;
    if (hit) r.cover = hit.id;
  }
  const total = db().prepare("SELECT COUNT(*) n FROM images WHERE disabled = 0").get() as { n: number };
  return Response.json({ rows, total: total.n, learned: prefsSummary() });
}

/**
 * { id, disabled }: liga ou desliga uma foto (desligada não é usada nos posts).
 * { productId, mainImageId }: define a foto principal do perfume (null volta para a escolha automática).
 */
export async function PATCH(req: Request) {
  const b = (await req.json()) as { id?: number; disabled?: boolean; productId?: number; mainImageId?: number | null };
  if (b.productId) {
    db().prepare("UPDATE products SET main_image_id = ? WHERE id = ?").run(b.mainImageId ?? null, b.productId);
    if (b.mainImageId) db().prepare("UPDATE images SET disabled = 0 WHERE id = ?").run(b.mainImageId);
    learnPrefs(); // cada escolha ensina a escolha automática
    return Response.json({ ok: true, learned: prefsSummary() });
  }
  db().prepare("UPDATE images SET disabled = ? WHERE id = ?").run(b.disabled ? 1 : 0, b.id!);
  if (b.disabled) db().prepare("UPDATE products SET main_image_id = NULL WHERE main_image_id = ?").run(b.id!);
  return Response.json({ ok: true });
}
