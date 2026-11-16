/**
 * Escolha automática da foto de cada perfume, aprendendo com o gosto do Arthur.
 *
 * - Toda foto tem algumas medidas: fundo liso, fundo branco, cores, brilho, contraste, formato e resolução.
 * - Cada vez que o Arthur escolhe uma foto principal (tela Fotos), comparamos a escolhida com as outras
 *   fotos daquele perfume: o que ela tem a mais (ou a menos) vira peso.
 * - Nos perfumes sem principal, a foto usada é a de maior nota base + esse gosto aprendido.
 *   Quanto mais escolhas, mais o gosto pesa (até um limite); a escolha manual sempre manda.
 */
import fs from "node:fs";
import { db, log } from "./db.ts";
import { getState, setState } from "./settings.ts";
import { analyzeImage, type ImageInfo } from "./images.ts";

export const FEATS = ["plainBorder", "whiteBorder", "colorfulness", "brightness", "contrast", "square", "res"] as const;
type Feat = Record<(typeof FEATS)[number], number>;
export type PhotoRow = { path: string; score: number; width: number; height: number; feat: string | null };

export const FEAT_LABEL: Record<(typeof FEATS)[number], [string, string]> = {
  plainBorder: ["fundo liso", "fundo com cenário"],
  whiteBorder: ["fundo branco", "fundo não branco"],
  colorfulness: ["mais colorida", "menos colorida"],
  brightness: ["mais clara", "mais escura"],
  contrast: ["mais contraste", "menos contraste"],
  square: ["mais quadrada", "menos quadrada"],
  res: ["resolução maior", "resolução menor"],
};

export function featuresOf(a: Pick<ImageInfo, "width" | "height" | "plainBorder" | "whiteBorder" | "colorfulness" | "brightness" | "contrast">): Feat {
  return {
    plainBorder: a.plainBorder,
    whiteBorder: a.whiteBorder,
    colorfulness: a.colorfulness,
    brightness: a.brightness,
    contrast: a.contrast,
    square: -Math.abs(Math.log(a.width / Math.max(1, a.height))),
    res: Math.log(Math.max(1, (a.width * a.height) / 1e6) + 0.1),
  };
}

type Prefs = { n: number; mean: Feat; std: Feat; w: Feat; at: number };
let cache: Prefs | null = null;

function zero(): Feat {
  return Object.fromEntries(FEATS.map((f) => [f, 0])) as Feat;
}

export function getPrefs(): Prefs | null {
  if (cache) return cache;
  const raw = getState("photoPrefs");
  cache = raw ? (JSON.parse(raw) as Prefs) : null;
  return cache;
}

/** Recalcula o gosto a partir das fotos principais escolhidas. */
export function learnPrefs(): Prefs {
  const all = db().prepare("SELECT product_id, id, feat FROM images WHERE disabled = 0 AND feat IS NOT NULL").all() as {
    product_id: number; id: number; feat: string;
  }[];
  const feats = all.map((r) => JSON.parse(r.feat) as Feat);
  const mean = zero(), std = zero();
  for (const f of FEATS) {
    const v = feats.map((x) => x[f]);
    const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    mean[f] = m;
    std[f] = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length)) || 1;
  }
  const byProduct = new Map<number, { id: number; f: Feat }[]>();
  all.forEach((r, i) => {
    const l = byProduct.get(r.product_id) || [];
    l.push({ id: r.id, f: feats[i] });
    byProduct.set(r.product_id, l);
  });
  const mains = db().prepare("SELECT id, main_image_id FROM products WHERE main_image_id IS NOT NULL").all() as { id: number; main_image_id: number }[];
  const w = zero();
  let n = 0;
  for (const p of mains) {
    const imgs = byProduct.get(p.id) || [];
    const main = imgs.find((i) => i.id === p.main_image_id);
    const others = imgs.filter((i) => i.id !== p.main_image_id);
    if (!main || !others.length) continue;
    n++;
    for (const f of FEATS) {
      const o = others.reduce((a, b) => a + b.f[f], 0) / others.length;
      w[f] += (main.f[f] - o) / std[f];
    }
  }
  if (n) for (const f of FEATS) w[f] = Math.max(-1.5, Math.min(1.5, w[f] / n));
  cache = { n, mean, std, w, at: Date.now() };
  setState("photoPrefs", JSON.stringify(cache));
  return cache;
}

/** Nota da escolha automática: nota base da foto + gosto aprendido. */
export function autoPhotoScore(r: PhotoRow): number {
  const base = r.score - 70 * Math.abs(Math.log(r.width / Math.max(1, r.height)));
  const p = getPrefs();
  if (!p?.n || !r.feat) return base;
  const f = JSON.parse(r.feat) as Feat;
  const strength = Math.min(1, p.n / 8); // com 8 ou mais escolhas, o gosto pesa por inteiro
  let learned = 0;
  for (const k of FEATS) learned += p.w[k] * ((f[k] - p.mean[k]) / p.std[k]);
  return base + 25 * strength * learned;
}

/** O que o sistema aprendeu, em palavras (para a tela Fotos). */
export function prefsSummary(): { n: number; likes: string[] } {
  const p = getPrefs();
  if (!p?.n) return { n: 0, likes: [] };
  const likes = FEATS.map((f) => ({ f, w: p.w[f] }))
    .filter((x) => Math.abs(x.w) >= 0.3)
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .slice(0, 4)
    .map((x) => FEAT_LABEL[x.f][x.w > 0 ? 0 : 1]);
  return { n: p.n, likes };
}

/** Calcula as medidas das fotos antigas (uma vez). */
export async function backfillFeatures() {
  if (getState("photoFeatV1")) return;
  const rows = db().prepare("SELECT id, path FROM images WHERE feat IS NULL").all() as { id: number; path: string }[];
  let n = 0;
  for (const r of rows) {
    if (!fs.existsSync(r.path)) continue;
    try {
      const a = await analyzeImage(fs.readFileSync(r.path));
      db().prepare("UPDATE images SET feat = ? WHERE id = ?").run(JSON.stringify(featuresOf(a)), r.id);
      n++;
    } catch {
      /* foto ruim: fica sem medidas */
    }
  }
  setState("photoFeatV1", "1");
  learnPrefs();
  log("info", `Fotos: medidas calculadas para ${n} foto(s) antigas`);
}
