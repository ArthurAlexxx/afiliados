import fs from "node:fs";
import sharp from "sharp";
import path from "node:path";
import { MEDIA_DIR } from "@/lib/db";
import { pinFile } from "@/lib/pinterest";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  // ?ref=1: foto de referência do perfume (id = perfume)
  const refFile = path.join(MEDIA_DIR, "pinterest", `ref_${id}.jpg`);
  const p = new URL(req.url).searchParams.get("ref") ? (fs.existsSync(refFile) ? refFile : null) : pinFile(id);
  if (!p) return new Response("not found", { status: 404 });
  const w = Number(new URL(req.url).searchParams.get("w") || 0);
  const buf = fs.readFileSync(p);
  const body = w ? await sharp(buf).resize(Math.min(w, 1200), Math.min(w, 1200), { fit: "inside" }).jpeg({ quality: 82 }).toBuffer() : buf;
  return new Response(new Uint8Array(body), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
}
