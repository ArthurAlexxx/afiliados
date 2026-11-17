import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Perfumes que o Arthur marcou para não postar, com o último post e o anúncio de cada um. */
export function GET() {
  const rows = db()
    .prepare(
      `SELECT p.id, p.name, p.main_image_id main,
              (SELECT q.id FROM posts q WHERE q.product_id = p.id ORDER BY q.id DESC LIMIT 1) post,
              (SELECT q.created_at FROM posts q WHERE q.product_id = p.id ORDER BY q.id DESC LIMIT 1) post_at,
              (SELECT q.media_path IS NOT NULL FROM posts q WHERE q.product_id = p.id ORDER BY q.id DESC LIMIT 1) has_media,
              (SELECT o.url FROM offers o WHERE o.product_id = p.id AND o.url IS NOT NULL ORDER BY o.id DESC LIMIT 1) url,
              (SELECT o.group_name FROM offers o WHERE o.product_id = p.id ORDER BY o.id DESC LIMIT 1) grp,
              (SELECT o.price FROM offers o WHERE o.product_id = p.id ORDER BY o.id DESC LIMIT 1) price
       FROM products p WHERE p.blocked = 1 ORDER BY post_at IS NULL, post_at DESC, p.id DESC`,
    )
    .all();
  return Response.json({ rows });
}
