import { db } from "@/lib/db";
import { POST_SELECT, postViewer, type P } from "@/lib/postview";

export const dynamic = "force-dynamic";

const PAGE = 24;

/**
 * Posts enviados, com filtros e páginas.
 * ?page=1 &q= (perfume ou texto) &group= (grupo de onde veio) &period= today|7d|30d|all
 * &sort= recent|price|discount &status= sent (padrão) | skipped | failed
 */
export function GET(req: Request) {
  const u = new URL(req.url);
  const page = Math.max(1, Number(u.searchParams.get("page") || 1));
  const q = (u.searchParams.get("q") || "").trim();
  const group = (u.searchParams.get("group") || "").trim();
  const period = u.searchParams.get("period") || "all";
  const sort = u.searchParams.get("sort") || "recent";
  const where: string[] = ["q.status = 'sent'"];
  const args: (string | number)[] = [];
  if (q) {
    where.push("(p.name LIKE ? OR q.formatted_text LIKE ?)");
    args.push(`%${q}%`, `%${q}%`);
  }
  if (group) {
    where.push("EXISTS (SELECT 1 FROM offers o WHERE o.product_id = q.product_id AND o.text = q.original_text AND o.group_name = ?)");
    args.push(group);
  }
  // dia em São Paulo (UTC-3)
  if (period === "today") where.push("date(q.sent_at, '-3 hours') = date('now', '-3 hours')");
  else if (period === "7d") where.push("q.sent_at >= datetime('now', '-7 days')");
  else if (period === "30d") where.push("q.sent_at >= datetime('now', '-30 days')");
  const order =
    sort === "price"
      ? "json_extract(q.data_json, '$.curation.bestPrice') IS NULL, json_extract(q.data_json, '$.curation.bestPrice')"
      : sort === "discount"
        ? "COALESCE(json_extract(q.data_json, '$.curation.discount'), 0) DESC"
        : "q.sent_at DESC";
  const w = `WHERE ${where.join(" AND ")}`;
  const total = (db().prepare(`SELECT COUNT(*) c FROM posts q LEFT JOIN products p ON p.id = q.product_id ${w}`).get(...args) as { c: number }).c;
  const view = postViewer();
  const rows = (db().prepare(`${POST_SELECT} ${w} ORDER BY ${order}, q.id DESC LIMIT ? OFFSET ?`).all(...args, PAGE, (page - 1) * PAGE) as P[]).map((r) => view(r, true));
  // grupos de onde já saiu post (para o filtro)
  const groups = (
    db()
      .prepare(
        `SELECT o.group_name g, COUNT(DISTINCT q.id) n FROM posts q JOIN offers o ON o.product_id = q.product_id AND o.text = q.original_text
         WHERE q.status = 'sent' GROUP BY o.group_name ORDER BY n DESC`,
      )
      .all() as { g: string; n: number }[]
  );
  const today = (db().prepare("SELECT COUNT(*) c FROM posts WHERE status = 'sent' AND date(sent_at, '-3 hours') = date('now', '-3 hours')").get() as { c: number }).c;
  return Response.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE)), groups, today });
}
