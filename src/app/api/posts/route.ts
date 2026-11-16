import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q");
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
  const offset = Number(url.searchParams.get("offset") || 0);
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (status && status !== "all") {
    const list = status.split(",");
    where.push(`status IN (${list.map(() => "?").join(",")})`);
    args.push(...list);
  }
  if (q) {
    where.push("(original_text LIKE ? OR formatted_text LIKE ? OR source_name LIKE ?)");
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db()
    .prepare(
      `SELECT id, source_name, original_text, formatted_text, media_path IS NOT NULL AS has_media, product_key,
              status, reason, attempts, created_at, sent_at, data_json
       FROM posts ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset);
  const total = (db().prepare(`SELECT COUNT(*) c FROM posts ${w}`).get(...args) as { c: number }).c;
  return Response.json({ rows, total });
}
