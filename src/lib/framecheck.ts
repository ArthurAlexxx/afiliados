import fs from "node:fs";
import sharp from "sharp";
import { db } from "./db.ts";
import { squareCanvas } from "./branding.ts";
import { applyCrop, parseCrop } from "./crop.ts";
import { bestImagePath } from "./curation.ts";

/**
 * Detecta foto que não saiu no quadrado 1:1: a foto ficou no meio e as laterais (ou cima/baixo)
 * foram preenchidas com a própria foto desfocada (squareCanvas, quando a foto é comprida demais).
 * Sinal: faixas dos dois lados opostos, de largura parecida, quase sem detalhe mas com cor variando
 * (fundo liso de estúdio tem cor parelha e não conta).
 */
export async function hasBlurredSides(img: Buffer): Promise<boolean> {
  const N = 216;
  const { data } = await sharp(img, { failOn: "none" }).resize(N, N, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => data[y * N + x];
  const grad = (x: number, y: number) => Math.abs(at(Math.min(N - 1, x + 1), y) - at(x, y)) + Math.abs(at(x, Math.min(N - 1, y + 1)) - at(x, y));
  // ignora os cantos, onde ficam as etiquetas de desconto e do grupo
  const lo = Math.round(N * 0.22), hi = Math.round(N * 0.78);
  const col = (x: number) => { let s = 0; for (let y = lo; y < hi; y++) s += grad(x, y); return s / (hi - lo); };
  const row = (y: number) => { let s = 0; for (let x = lo; x < hi; x++) s += grad(x, y); return s / (hi - lo); };
  // a borda da foto no meio vira um degrau: fora (desfocado) quase sem detalhe, dentro com detalhe.
  // Procura o mesmo degrau dos dois lados, na mesma distância da borda (a foto fica centralizada).
  const mean = (f: (i: number) => number, a: number, b: number) => {
    let t = 0;
    for (let i = a; i <= b; i++) t += f(i);
    return t / Math.max(1, b - a + 1);
  };
  const step = (f: (i: number) => number, p: number, dir: 1 | -1) => {
    // p = primeira coluna/linha da foto; fora = as 14 antes, dentro = as 12 depois (pulando a própria borda)
    const out = dir === 1 ? mean(f, Math.max(0, p - 14), p - 1) : mean(f, p + 1, Math.min(N - 1, p + 14));
    const inn = dir === 1 ? mean(f, p + 2, p + 13) : mean(f, p - 13, p - 2);
    const outer = dir === 1 ? mean(f, 0, p - 1) : mean(f, p + 1, N - 1);
    return { ratio: inn / Math.max(0.5, out), outer, inn };
  };
  const symmetric = (f: (i: number) => number, sp: (p: number) => number) => {
    const min = Math.round(N * 0.04), max = Math.round(N * 0.4);
    for (let p = min; p <= max; p++) {
      const a = step(f, p, 1);
      if (a.ratio < 2.5) continue;
      for (let d = -3; d <= 3; d++) {
        const q = N - 1 - p + d;
        if (q <= p + N * 0.15 || q >= N) continue;
        const b = step(f, q, -1);
        if (b.ratio >= 2.5 && Math.max(a.outer, b.outer) < 0.35 * Math.min(a.inn, b.inn) && sp(p) >= 4) return true;
      }
    }
    return false;
  };
  // variação de cor dentro da faixa (desfocado varia, fundo liso não)
  const spread = (xs: number[], ys: number[]) => {
    let n = 0, s = 0, s2 = 0;
    for (const x of xs) for (const y of ys) { const v = at(x, y); n++; s += v; s2 += v * v; }
    return n ? Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) : 0;
  };
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
  const mid = range(lo, hi);
  if (symmetric(col, (p) => (spread(range(0, p), mid) + spread(range(N - p, N), mid)) / 2)) return true;
  return symmetric(row, (p) => (spread(mid, range(0, p)) + spread(mid, range(N - p, N))) / 2);
}

function table() {
  db().exec("CREATE TABLE IF NOT EXISTS frame_checks (key TEXT PRIMARY KEY, blurred INTEGER NOT NULL, checked_at TEXT NOT NULL DEFAULT (datetime('now')))");
}

async function cached(key: string, run: () => Promise<boolean>): Promise<boolean> {
  table();
  const hit = db().prepare("SELECT blurred FROM frame_checks WHERE key = ?").get(key) as { blurred: number } | undefined;
  if (hit) return !!hit.blurred;
  let v = false;
  try {
    v = await run();
  } catch {
    v = false;
  }
  db().prepare("INSERT OR REPLACE INTO frame_checks (key, blurred) VALUES (?, ?)").run(key, v ? 1 : 0);
  return v;
}

/** A foto que o próximo post desse perfume usaria ainda sai com laterais borradas? */
async function nextPhotoBlurred(productId: number): Promise<boolean> {
  const p = bestImagePath(productId);
  if (!p || !fs.existsSync(p)) return true;
  const r = db().prepare("SELECT id, crop FROM images WHERE path = ?").get(p) as { id: number; crop: string | null } | undefined;
  const crop = parseCrop(r?.crop ?? null);
  const key = `img:${r?.id ?? p}:${r?.crop ?? ""}`;
  return cached(key, async () => hasBlurredSides(await squareCanvas(await applyCrop(fs.readFileSync(p), crop), 540)));
}

/**
 * Perfumes com post enviado hoje (horário de Brasília) cuja foto saiu com laterais borradas,
 * e que ainda não foram arrumados (a foto atual do perfume continua saindo assim).
 */
export async function photosToFix(): Promise<Map<number, { post: number; sentAt: string }>> {
  const posts = db()
    .prepare(
      `SELECT id, product_id, media_path, sent_at FROM posts
       WHERE status = 'sent' AND product_id IS NOT NULL AND media_path IS NOT NULL
         AND date(sent_at, '-3 hours') = date('now', '-3 hours')
       ORDER BY sent_at DESC`,
    )
    .all() as { id: number; product_id: number; media_path: string; sent_at: string }[];
  const out = new Map<number, { post: number; sentAt: string }>();
  for (const p of posts) {
    if (out.has(p.product_id) || !fs.existsSync(p.media_path)) continue;
    const bad = await cached(`post:${p.id}`, async () => hasBlurredSides(fs.readFileSync(p.media_path)));
    if (bad && (await nextPhotoBlurred(p.product_id))) out.set(p.product_id, { post: p.id, sentAt: p.sent_at });
  }
  return out;
}
