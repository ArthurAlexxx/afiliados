import fs from "node:fs";
import sharp from "sharp";
import { cleanFile } from "@/lib/unwatermark";

/** ?f=src (original com marca) ou ?f=out (limpa). ?w= miniatura. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const u = new URL(req.url).searchParams;
  const p = cleanFile(id, u.get("f") === "src" ? "src" : "out");
  if (!p) return new Response("not found", { status: 404 });
  const w = Number(u.get("w") || 0);
  const buf = fs.readFileSync(p);
  const body = w ? await sharp(buf).resize(Math.min(w, 1200), Math.min(w, 1200), { fit: "inside" }).jpeg({ quality: 82 }).toBuffer() : buf;
  return new Response(new Uint8Array(body), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
}
