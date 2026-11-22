import { db } from "@/lib/db";
import { Evolution } from "@/lib/evolution";
import { getSettings } from "@/lib/settings";
import { syncGroups } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export function GET() {
  const rows = db()
    .prepare(
      `SELECT g.jid, g.name, g.size, g.role, g.watermark, g.promo, g.follow, g.photo_priority,
         (SELECT COUNT(*) FROM offers o WHERE o.group_jid = g.jid) offers,
         (SELECT COUNT(*) FROM images i WHERE i.group_jid = g.jid) photos,
         (SELECT COUNT(*) FROM posts p WHERE p.source_jid = g.jid) captured,
         (SELECT COUNT(*) FROM posts p WHERE p.source_jid = g.jid AND p.status='sent') sent
       FROM groups g ORDER BY CASE g.role WHEN 'destination' THEN 0 WHEN 'deals' THEN 1 WHEN 'source' THEN 2 ELSE 3 END, g.name COLLATE NOCASE`,
    )
    .all();
  return Response.json({ rows });
}

/** Sincroniza a lista de grupos da instância na Evolution API. */
export async function POST() {
  try {
    const count = await syncGroups(getSettings());
    return Response.json({ ok: true, count });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

/** Atualiza o papel de um grupo: none | source | destination | deals (ofertas boas, teste 2). Também permite adicionar um JID manual. */
export async function PATCH(req: Request) {
  const { jid, role, name, watermark, wmCorner, promo, follow, leave } = (await req.json()) as {
    jid: string; role?: string; name?: string; watermark?: boolean; wmCorner?: string; promo?: boolean; follow?: boolean; leave?: boolean;
  };
  if (jid && leave) {
    const g = db().prepare("SELECT role FROM groups WHERE jid = ?").get(jid) as { role: string } | undefined;
    if (g?.role === "destination" || g?.role === "deals") return Response.json({ error: "não sai do grupo de destino" }, { status: 400 });
    try {
      await new Evolution(getSettings()).leaveGroup(jid);
    } catch (e) {
      return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
    }
    db().prepare("UPDATE groups SET role = 'none', follow = 0, promo = 0 WHERE jid = ?").run(jid);
    db().prepare("DELETE FROM groups WHERE jid = ? AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.group_jid = groups.jid) AND NOT EXISTS (SELECT 1 FROM images i WHERE i.group_jid = groups.jid)").run(jid);
    return Response.json({ ok: true });
  }
  if (jid && typeof follow === "boolean" && !role) {
    // grupo copiado precisa poder ter a oferta postada: liga "Promoções: sim" junto (senão a cópia sai "sem oferta com link")
    db().prepare("UPDATE groups SET follow = ?, promo = CASE WHEN ? = 1 THEN 1 ELSE promo END WHERE jid = ?").run(follow ? 1 : 0, follow ? 1 : 0, jid);
    return Response.json({ ok: true });
  }
  if (jid && typeof promo === "boolean" && !role) {
    db().prepare("UPDATE groups SET promo = ? WHERE jid = ?").run(promo ? 1 : 0, jid);
    return Response.json({ ok: true });
  }
  if (jid && wmCorner && !role) {
    if (!["top-right", "top-left", "bottom-right", "bottom-left"].includes(wmCorner)) return Response.json({ error: "canto inválido" }, { status: 400 });
    db().prepare("UPDATE groups SET wm_corner = ? WHERE jid = ?").run(wmCorner, jid);
    return Response.json({ ok: true });
  }
  if (jid && typeof watermark === "boolean" && !role) {
    db().prepare("UPDATE groups SET watermark = ? WHERE jid = ?").run(watermark ? 1 : 0, jid);
    if (watermark) db().prepare("UPDATE images SET disabled = 1 WHERE group_jid = ? AND (message_id IS NULL OR message_id NOT LIKE 'lama:%')").run(jid);
    else db().prepare("UPDATE images SET disabled = 0 WHERE group_jid = ?").run(jid);
    return Response.json({ ok: true });
  }
  if (!jid || !role || !["none", "source", "destination", "deals"].includes(role)) {
    return Response.json({ error: "dados inválidos" }, { status: 400 });
  }
  // só um grupo de ofertas boas por vez
  if (role === "deals") db().prepare("UPDATE groups SET role = 'none' WHERE role = 'deals' AND jid <> ?").run(jid.trim());
  db()
    .prepare(
      `INSERT INTO groups (jid, name, role) VALUES (?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET role = excluded.role, name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE groups.name END`,
    )
    .run(jid.trim(), name || "", role);
  return Response.json({ ok: true });
}
