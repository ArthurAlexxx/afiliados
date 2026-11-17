import sharp from "sharp";
import { db, log } from "@/lib/db";
import { addImage, releaseWaiting } from "@/lib/curation";
import { analyzeImage, hammingHex } from "@/lib/images";
import { learnPrefs } from "@/lib/photoprefs";
import { parseCrop } from "@/lib/crop";

export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Foto colocada pelo Arthur (arrastada do Google, colada ou escolhida do computador):
 * { productId, data: "data:image/...;base64,..." } ou { productId, url }.
 * Vira a foto principal do perfume na hora.
 */
export async function POST(req: Request) {
  const b = (await req.json()) as { productId?: number; data?: string; url?: string; crop?: unknown };
  const pid = Number(b.productId);
  if (!pid || !db().prepare("SELECT 1 FROM products WHERE id = ?").get(pid)) return Response.json({ error: "perfume não encontrado" }, { status: 400 });
  try {
    let raw: Buffer;
    const src = b.data || b.url || "";
    if (src.startsWith("data:")) raw = Buffer.from(src.slice(src.indexOf(",") + 1), "base64");
    else if (/^https?:\/\//.test(src)) {
      const r = await fetch(src, { headers: { "user-agent": UA, accept: "image/*,*/*" }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`o site da imagem respondeu ${r.status}`);
      if (!/image\//.test(r.headers.get("content-type") || "image/")) throw new Error("esse link não é de uma imagem (abra a imagem e arraste ela mesma)");
      raw = Buffer.from(await r.arrayBuffer());
    } else throw new Error("nenhuma imagem recebida");
    // qualquer formato (webp, avif, png) vira jpg
    const jpg = await sharp(raw).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
    const meta = await sharp(jpg).metadata();
    if (Math.min(meta.width || 0, meta.height || 0) < 500)
      return Response.json(
        { error: `imagem pequena (${meta.width}×${meta.height}). No Google, clique na foto, espere abrir grande ao lado e arraste a grande` },
        { status: 400 },
      );
    const tag = `manual:${Date.now()}`;
    const msg = await addImage(pid, jpg, tag);
    let img = db().prepare("SELECT id FROM images WHERE product_id = ? AND message_id = ?").get(pid, tag) as { id: number } | undefined;
    if (!img) {
      // igual a uma que já estava no banco: usa ela
      const a = await analyzeImage(jpg);
      const rows = db().prepare("SELECT id, hash FROM images WHERE product_id = ?").all(pid) as { id: number; hash: string }[];
      img = rows.find((r) => hammingHex(r.hash, a.hash) <= 8);
    }
    if (!img) throw new Error(msg);
    db().prepare("UPDATE images SET disabled = 0 WHERE id = ?").run(img.id);
    if (b.crop !== undefined) {
      const c = parseCrop(b.crop);
      db().prepare("UPDATE images SET crop = ? WHERE id = ?").run(c ? JSON.stringify(c) : null, img.id);
    }
    db().prepare("UPDATE products SET main_image_id = ? WHERE id = ?").run(img.id, pid);
    learnPrefs();
    // já estava na fila para sair: refaz a imagem do post com a foto/enquadramento novo
    await import("@/lib/curation").then((m) => m.refreshQueuedMedia(pid!)).catch(() => 0);
    const rel = await releaseWaiting(pid).catch(() => "");
    log("info", `Foto colocada à mão no perfume #${pid} (${meta.width}×${meta.height}) virou a principal`);
    return Response.json({ ok: true, id: img.id, msg: `Foto adicionada e definida como principal (${meta.width}×${meta.height})${rel ? ` · ${rel}` : ""}` });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
