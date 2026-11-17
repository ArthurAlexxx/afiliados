import fs from "node:fs";
import sharp from "sharp";
import { pinFile } from "@/lib/pinterest";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = pinFile(Number((await ctx.params).id));
  if (!p) return new Response("not found", { status: 404 });
  const w = Number(new URL(req.url).searchParams.get("w") || 0);
  const buf = fs.readFileSync(p);
  const body = w ? await sharp(buf).resize(Math.min(w, 1200), Math.min(w, 1200), { fit: "inside" }).jpeg({ quality: 82 }).toBuffer() : buf;
  return new Response(new Uint8Array(body), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
}
