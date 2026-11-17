import sharp from "sharp";

/** Enquadramento 1:1 escolhido pelo Arthur: canto (l, t) e lado w, em fração da largura/altura da foto. */
export type Crop = { l: number; t: number; w: number };

export function parseCrop(v: unknown): Crop | null {
  const c = (typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v) as Crop | null;
  if (!c || ![c.l, c.t, c.w].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return { l: Math.max(0, Math.min(1, c.l)), t: Math.max(0, Math.min(1, c.t)), w: Math.max(0.05, Math.min(1, c.w)) };
}

/** Recorta o quadrado escolhido; sem enquadramento devolve a foto como está. */
export async function applyCrop(buf: Buffer, crop: Crop | null): Promise<Buffer> {
  if (!crop) return buf;
  const img = sharp(buf, { failOn: "none" }).rotate();
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const side = Math.max(16, Math.min(Math.round(crop.w * W), W, H));
  const left = Math.max(0, Math.min(W - side, Math.round(crop.l * W)));
  const top = Math.max(0, Math.min(H - side, Math.round(crop.t * H)));
  return sharp(data).extract({ left, top, width: side, height: side }).jpeg({ quality: 94 }).toBuffer();
}
