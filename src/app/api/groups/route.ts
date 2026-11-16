import { db } from "@/lib/db";
import { Evolution } from "@/lib/evolution";
import { getSettings } from "@/lib/settings";
import { syncGroups } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export function GET() {
  const rows = db()
    .prepare(
      `SELECT g.jid, g.name, g.size, g.role, g.watermark,
         (SELECT COUNT(*) FROM offers o WHERE o.group_jid = g.jid) offers,
         (SELECT COUNT(*) FROM images i WHERE i.group_jid = g.jid) photos,
         (SELECT COUNT(*) FROM posts p WHERE p.source_jid = g.jid) captured,
         (SELECT COUNT(*) FROM posts p WHERE p.source_jid = g.jid AND p.status='sent') sent
       FROM groups g ORDER BY CASE g.role WHEN 'destination' THEN 0 WHEN 'source' THEN 1 ELSE 2 END, g.name COLLATE NOCASE`,
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

/** Atualiza o papel de um grupo: none | source | destination. Também permite adicionar um JID manual. */
export async function PATCH(req: Request) {
  const { jid, role, name, watermark } = (await req.json()) as { jid: string; role?: string; name?: string; watermark?: boolean };
  if (jid && typeof watermark === "boolean" && !role) {
    db().prepare("UPDATE groups SET watermark = ? WHERE jid = ?").run(watermark ? 1 : 0, jid);
    if (watermark) db().prepare("UPDATE images SET disabled = 1 WHERE group_jid = ?").run(jid);
    else db().prepare("UPDATE images SET disabled = 0 WHERE group_jid = ?").run(jid);
    return Response.json({ ok: true });
  }
  if (!jid || !role || !["none", "source", "destination"].includes(role)) {
    return Response.json({ error: "dados inválidos" }, { status: 400 });
  }
  db()
    .prepare(
      `INSERT INTO groups (jid, name, role) VALUES (?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET role = excluded.role, name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE groups.name END`,
    )
    .run(jid.trim(), name || "", role);
  return Response.json({ ok: true });
}
