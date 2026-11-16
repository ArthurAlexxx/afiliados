import sharp from "sharp";

export type ImageInfo = {
  width: number;
  height: number;
  bytes: number;
  /** 0..1: quanto da borda é fundo liso (branco/cor única). 1 = foto de catálogo em fundo branco. */
  plainBorder: number;
  /** 0..1: fração da borda que é quase branca. */
  whiteBorder: number;
  /** variedade de cores da imagem (0..~1). Cenários produzidos tendem a ser mais altos. */
  colorfulness: number;
  /** hash perceptual (dHash 64 bits) para achar a mesma foto em grupos diferentes. */
  hash: string;
  /** nota final 0..100 usada para escolher a melhor foto do produto. */
  score: number;
};

/** Analisa uma imagem: resolução, fundo liso x produzido e hash perceptual. */
export async function analyzeImage(buf: Buffer): Promise<ImageInfo> {
  const img = sharp(buf, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const width = meta.autoOrient?.width || meta.width || 0;
  const height = meta.autoOrient?.height || meta.height || 0;

  // amostra pequena para estatísticas
  const N = 64;
  const { data } = await img.clone().resize(N, N, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => {
    const i = (y * N + x) * 3;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };

  // borda: 3 pixels em volta
  const border: (readonly [number, number, number])[] = [];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) if (x < 3 || y < 3 || x >= N - 3 || y >= N - 3) border.push(px(x, y));
  const med = [0, 1, 2].map((c) => {
    const v = border.map((p) => p[c]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  });
  const close = border.filter((p) => Math.abs(p[0] - med[0]) + Math.abs(p[1] - med[1]) + Math.abs(p[2] - med[2]) < 30).length;
  const white = border.filter((p) => p[0] > 235 && p[1] > 235 && p[2] > 235).length;
  const plainBorder = close / border.length;
  const whiteBorder = white / border.length;

  // colorfulness (Hasler & Süsstrunk), normalizada
  let sumRg = 0, sumYb = 0, sqRg = 0, sqYb = 0;
  const n = N * N;
  for (let i = 0; i < n; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const rg = r - g, yb = 0.5 * (r + g) - b;
    sumRg += rg; sumYb += yb; sqRg += rg * rg; sqYb += yb * yb;
  }
  const mRg = sumRg / n, mYb = sumYb / n;
  const sdRg = Math.sqrt(Math.max(0, sqRg / n - mRg * mRg)), sdYb = Math.sqrt(Math.max(0, sqYb / n - mYb * mYb));
  const colorfulness = Math.min(1, (Math.sqrt(sdRg ** 2 + sdYb ** 2) + 0.3 * Math.sqrt(mRg ** 2 + mYb ** 2)) / 110);

  // dHash 8x8
  const small = await img.clone().resize(9, 8, { fit: "fill" }).grayscale().raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += small[y * 9 + x] > small[y * 9 + x + 1] ? "1" : "0";
  const hash = BigInt("0b" + bits).toString(16).padStart(16, "0");

  const info = { width, height, bytes: buf.length, plainBorder, whiteBorder, colorfulness, hash, score: 0 };
  info.score = scoreImage(info);
  return info;
}

/**
 * Nota da foto: prioriza resolução alta e fundo produzido (cenário),
 * penaliza foto de catálogo em fundo branco liso e imagens pequenas.
 */
export function scoreImage(i: Omit<ImageInfo, "score" | "hash">): number {
  const mp = (i.width * i.height) / 1e6;
  const res = Math.min(1, mp / 1.5); // 1.5 MP ou mais = nota cheia
  const produced = 1 - Math.max(i.plainBorder * 0.6 + i.whiteBorder * 0.4, 0);
  let s = 45 * res + 40 * produced + 15 * i.colorfulness;
  if (Math.min(i.width, i.height) < 400) s -= 30; // miniaturas (ex: 100x100)
  return Math.max(0, Math.round(s));
}

export function hammingHex(a: string, b: string) {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let c = 0;
  while (x) { c += Number(x & 1n); x >>= 1n; }
  return c;
}

/** Converte para JPEG de boa qualidade (WhatsApp aceita melhor) mantendo resolução. */
export async function toJpeg(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { failOn: "none" }).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
