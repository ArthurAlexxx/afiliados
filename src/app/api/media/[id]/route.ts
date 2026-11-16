import fs from "node:fs";
import { db } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const p = db().prepare("SELECT media_path, media_mime FROM posts WHERE id = ?").get(id) as
    | { media_path: string | null; media_mime: string | null }
    | undefined;
  if (!p?.media_path || !fs.existsSync(p.media_path)) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(p.media_path), {
    headers: { "content-type": p.media_mime || "image/jpeg", "cache-control": "private, max-age=3600" },
  });
}
