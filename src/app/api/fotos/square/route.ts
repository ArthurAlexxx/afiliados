import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, MEDIA_DIR } from "@/lib/db";
import { squareCanvas } from "@/lib/branding";
import { applyCrop, parseCrop } from "@/lib/crop";

export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const V = "v1";

/**
 * Prévia de como a foto sai no grupo: quadrada 1:1, igual ao post.
 * ?img=<id da foto do banco> ou ?frag=<id da foto do Fragrantica>, &w= tamanho (padrão 300).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const img = Number(u.searchParams.get("img") || 0);
  const frag = Number(u.searchParams.get("frag") || 0);
  const w = Math.min(1080, Math.max(80, Number(u.searchParams.get("w") || 300)));
  const dir = path.join(MEDIA_DIR, "square");
  fs.mkdirSync(dir, { recursive: true });
  const crop = img ? parseCrop((db().prepare("SELECT crop FROM images WHERE id = ?").get(img) as { crop: string | null } | undefined)?.crop ?? null) : null;
  const ck = crop ? `-${Math.round(crop.l * 1e4)}_${Math.round(crop.t * 1e4)}_${Math.round(crop.w * 1e4)}` : "";
  const file = path.join(dir, `${V}-${img ? `i${img}` : `f${frag}`}${ck}.jpg`);
  try {
    let sq: Buffer;
    if (fs.existsSync(file)) sq = fs.readFileSync(file);
    else {
      let raw: Buffer;
      if (img) {
        const r = db().prepare("SELECT path FROM images WHERE id = ?").get(img) as { path: string } | undefined;
        if (!r || !fs.existsSync(r.path)) return new Response("not found", { status: 404 });
        raw = await applyCrop(fs.readFileSync(r.path), crop);
      } else {
        const r = db().prepare("SELECT url FROM frag_photos WHERE id = ?").get(frag) as { url: string } | undefined;
        if (!r) return new Response("not found", { status: 404 });
        const res = await fetch(r.url, { headers: { "user-agent": UA, accept: "image/*" }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) return new Response("not found", { status: 404 });
        raw = Buffer.from(await res.arrayBuffer());
      }
      sq = await sharp(await squareCanvas(raw, 1080)).jpeg({ quality: 88 }).toBuffer();
      fs.writeFileSync(file, sq);
    }
    const body = w >= 1080 ? sq : await sharp(sq).resize(w, w).jpeg({ quality: 82 }).toBuffer();
    return new Response(new Uint8Array(body), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
  } catch {
    return new Response("erro", { status: 500 });
  }
}
