import fs from "node:fs";
import sharp from "sharp";
import { db } from "@/lib/db";

/** Foto do banco em resolução original, ou miniatura com ?w=400. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const r = db().prepare("SELECT path FROM images WHERE id = ?").get(id) as { path: string } | undefined;
  if (!r || !fs.existsSync(r.path)) return new Response("not found", { status: 404 });
  const w = Number(new URL(req.url).searchParams.get("w") || 0);
  const buf = fs.readFileSync(r.path);
  const body = w ? await sharp(buf).resize(Math.min(w, 1200), Math.min(w, 1200), { fit: "inside" }).jpeg({ quality: 80 }).toBuffer() : buf;
  return new Response(new Uint8Array(body), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
}
