import fs from "node:fs";
import sharp from "sharp";
import { db } from "@/lib/db";
import { brand, ranking } from "@/lib/curation";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET ?id=IMAGEM            → foto do banco (miniatura com &w=400)
 * GET ?product=ID&brand=1   → prévia da melhor foto do perfume já com as etiquetas
 * GET ?sample=1             → prévia das etiquetas numa foto qualquer do banco
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const s = getSettings();
  let row: { path: string; product_id: number } | undefined;
  if (q.get("id")) row = db().prepare("SELECT path, product_id FROM images WHERE id = ?").get(Number(q.get("id"))) as typeof row;
  else if (q.get("product"))
    row = db().prepare("SELECT path, product_id FROM images WHERE product_id = ? AND disabled = 0 ORDER BY score DESC LIMIT 1").get(Number(q.get("product"))) as typeof row;
  else if (q.get("sample"))
    row = db().prepare("SELECT path, product_id FROM images WHERE disabled = 0 ORDER BY score DESC LIMIT 1").get() as typeof row;
  if (!row || !fs.existsSync(row.path)) return new Response("not found", { status: 404 });

  let buf: Buffer = fs.readFileSync(row.path);
  if (q.get("brand") || q.get("sample")) {
    const item = ranking(s).find((r) => r.productId === row!.product_id);
    const pct = item?.declaredPct ?? (item?.pctVsMedian ? Math.round(item.pctVsMedian * 100) : null) ?? 30;
    buf = await brand(buf, pct, { ...s, brandEnabled: true });
  }
  const w = Number(q.get("w") || 0);
  if (w > 0) buf = await sharp(buf).resize(w, w, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=600" } });
}
