import { db } from "@/lib/db";
import { Evolution } from "@/lib/evolution";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export function GET() {
  const rows = db()
    .prepare(
      `SELECT g.jid, g.name, g.size, g.role,
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
    const list = await new Evolution(getSettings()).fetchAllGroups();
    const stmt = db().prepare(
      `INSERT INTO groups (jid, name, size, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(jid) DO UPDATE SET name = excluded.name, size = excluded.size, updated_at = excluded.updated_at`,
    );
    for (const g of Array.isArray(list) ? list : []) stmt.run(g.id, g.subject || g.id, g.size || 0);
    return Response.json({ ok: true, count: Array.isArray(list) ? list.length : 0 });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}

/** Atualiza o papel de um grupo: none | source | destination. Também permite adicionar um JID manual. */
export async function PATCH(req: Request) {
  const { jid, role, name } = (await req.json()) as { jid: string; role: string; name?: string };
  if (!jid || !["none", "source", "destination"].includes(role)) {
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
