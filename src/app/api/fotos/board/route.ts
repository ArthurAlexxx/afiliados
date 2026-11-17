import { db } from "@/lib/db";
import { bestImagePath } from "@/lib/curation";
import { notPerfume } from "@/lib/perfume";

export const dynamic = "force-dynamic";

type Row = { id: number; name: string; main: number | null; blocked: number; frag_url: string | null; last: string | null; waiting: string | null };

/**
 * Tela única de escolha: cada perfume com a foto que vai no post e todas as opções
 * (Fragram Photos do Fragrantica, Pinterest esperando e as fotos do banco).
 * ?q= busca, ?f= all | none | fragram | pin, ?offset=
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = `%${(u.searchParams.get("q") || "").trim()}%`;
  const f = u.searchParams.get("f") || "all";
  const one = Number(u.searchParams.get("id") || 0);
  const offset = Math.max(0, Number(u.searchParams.get("offset") || 0));
  const LIMIT = 30;
  const all = db()
    .prepare(
      `SELECT p.id, p.name, p.main_image_id main, COALESCE(p.blocked,0) blocked, p.frag_url,
              MAX(COALESCE((SELECT MAX(o.created_at) FROM offers o WHERE o.product_id = p.id), ''), COALESCE((SELECT MAX(i.created_at) FROM images i WHERE i.product_id = p.id), '')) last,
              (SELECT COUNT(*) FROM frag_photos g WHERE g.frag_url = p.frag_url) nfrag,
              (SELECT COUNT(*) FROM pin_photos x WHERE x.product_id = p.id AND x.status = 'pending' AND x.url NOT IN ('none','searching')) npin,
              (SELECT COUNT(*) FROM images i WHERE i.product_id = p.id AND i.disabled = 0 AND COALESCE(i.message_id,'') NOT LIKE 'frag:%') nimg,
              (SELECT MAX(q.created_at) FROM posts q WHERE q.product_id = p.id AND q.status = 'photo') waiting
       FROM products p WHERE p.name LIKE ?
       ORDER BY waiting IS NULL, waiting DESC, last DESC`,
    )
    .all(q) as (Row & { nfrag: number; npin: number; nimg: number; waiting: string | null })[];
  const list = all
    .filter((r) => !notPerfume(r.name) && (r.nfrag || r.npin || r.nimg || r.waiting))
    .filter((r) => !one || r.id === one)
    .filter((r) => one || (f === "wait" ? !!r.waiting : f === "none" ? !r.main : f === "fragram" ? r.nfrag > 0 : f === "pin" ? r.npin > 0 : true));
  const base = all.filter((r) => !notPerfume(r.name) && (r.nfrag || r.npin || r.nimg || r.waiting));
  const counts = {
    all: base.length,
    wait: base.filter((r) => r.waiting).length,
    none: base.filter((r) => !r.main).length,
    fragram: base.filter((r) => r.nfrag > 0).length,
    pin: base.filter((r) => r.npin > 0).length,
  };
  const idOf = db().prepare("SELECT id FROM images WHERE path = ?");
  const imgs = db().prepare(
    "SELECT id, width, height, message_id FROM images WHERE product_id = ? AND disabled = 0 AND COALESCE(message_id,'') NOT LIKE 'frag:%' ORDER BY score DESC LIMIT 20",
  );
  const pins = db().prepare("SELECT id, width, height FROM pin_photos WHERE product_id = ? AND status = 'pending' AND url NOT IN ('none','searching') ORDER BY score DESC LIMIT 20");
  const frags = db().prepare("SELECT id, url, thumb FROM frag_photos WHERE frag_url = ? ORDER BY id");
  const rows = list.slice(offset, offset + LIMIT).map((r) => {
    const pth = bestImagePath(r.id);
    const cur = pth ? (idOf.get(pth) as { id: number } | undefined)?.id ?? null : null;
    return {
      id: r.id,
      name: r.name,
      main: r.main,
      blocked: r.blocked,
      fragUrl: r.frag_url,
      current: cur,
      waiting: r.waiting,
      bank: imgs.all(r.id),
      pins: pins.all(r.id),
      fragram: r.frag_url ? frags.all(r.frag_url) : [],
    };
  });
  return Response.json({ rows, total: list.length, counts, more: offset + LIMIT < list.length });
}
