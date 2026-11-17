import fs from "node:fs";
import { db, log } from "@/lib/db";
import { sendPost } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Edita texto ou executa ação: approve | send | discard | requeue */
export async function PATCH(req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  const body = (await req.json().catch(() => ({}))) as { action?: string; formatted_text?: string; removeMedia?: boolean };
  const post = db().prepare("SELECT id, status, media_path FROM posts WHERE id = ?").get(id) as
    | { id: number; status: string; media_path: string | null }
    | undefined;
  if (!post) return Response.json({ error: "não encontrado" }, { status: 404 });

  if (typeof body.formatted_text === "string") {
    db().prepare("UPDATE posts SET formatted_text = ? WHERE id = ?").run(body.formatted_text, id);
  }
  if (body.removeMedia && post.media_path) {
    try { fs.unlinkSync(post.media_path); } catch {}
    db().prepare("UPDATE posts SET media_path = NULL, media_mime = NULL WHERE id = ?").run(id);
  }
  switch (body.action) {
    case "approve":
    case "requeue":
      db().prepare("UPDATE posts SET status = 'queued', reason = NULL, attempts = 0 WHERE id = ?").run(id);
      break;
    case "redo": {
      try {
        const { redoPost } = await import("@/lib/curation");
        const r = await redoPost(id);
        log("info", `Refazer post: ${r}`);
        return Response.json({ ok: true, msg: r });
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
      }
    }
    case "discard":
      db().prepare("UPDATE posts SET status = 'skipped', reason = 'Descartado manualmente' WHERE id = ?").run(id);
      break;
    case "send": {
      try {
        const r = await sendPost(id);
        log("info", `Envio manual #${id}: ${r}`);
        if (r !== "enviado") return Response.json({ ok: false, error: `Resultado: ${r}` }, { status: 400 });
      } catch (e) {
        return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
      }
      break;
    }
  }
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id);
  const post = db().prepare("SELECT media_path FROM posts WHERE id = ?").get(id) as { media_path: string | null } | undefined;
  if (post?.media_path) try { fs.unlinkSync(post.media_path); } catch {}
  db().prepare("DELETE FROM posts WHERE id = ?").run(id);
  return Response.json({ ok: true });
}
