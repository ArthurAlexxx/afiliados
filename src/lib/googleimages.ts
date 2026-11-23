/**
 * Arthur (23/nov): "buscar imagens boas no Fragrantica ou no Google, sem marca d'água e com qualidade boa".
 * Google Imagens pelo Apify (johnvc/google-images-api, US$ 0,0001 por imagem: ~US$ 0,005 por busca de 50 imagens).
 * Fica só com foto de loja (Amazon, Sephora, ML, sites de perfume e das marcas), nunca de rede social ou grupo
 * (é onde vem marca d'água), cujo título da página é do mesmo perfume, grande (≥ 700px) e de preferência
 * em fundo branco (foto de produto).
 */
import sharp from "sharp";
import { db, log } from "./db.ts";
import { apifyFail, checkApify, tracked } from "./apify.ts";
import { norm, sameListing } from "./perfume.ts";

const ACTOR = "johnvc~google-images-api";
type Item = { imageUrl?: string; imageWidth?: number; imageHeight?: number; domain?: string; link?: string; title?: string };

// redes sociais, bancos de imagem e agregadores: marca d'água, foto de pessoa, montagem
const BLOCK = /(instagram|facebook|fbcdn|pinterest|pinimg|tiktok|youtube|ytimg|twitter|x\.com|threads|whatsapp|telegram|kwai|reddit|tumblr|shutterstock|istockphoto|gettyimages|dreamstime|alamy|depositphotos|freepik|123rf|vecteezy|canva|wallpaper|aliexpress|shopee|temu|olx|enjoei|promo|cupom|ofertas?|achadinhos|radar)/i;
// lojas e sites que costumam ter foto limpa do frasco
const GOOD = /(amazon|sephora|mercadolivre|mlstatic|belezanaweb|epocacosmeticos|notino|fragrancenet|fragrancex|perfumesclub|douglas|boots|macys|nordstrom|ulta|myntra|noon|lattafa|armaf|afnan|rasasi|alhambra|natura|boticario|magazineluiza|magalu|americanas|carrefour|drogasil|drogaraia|paguemenos|giovannaperfumaria|lojasrenner|perfumaria|parfum|perfume)/i;

// versão do perfume: se está no título da loja e não no nosso nome, é outro produto (Salvo ≠ Salvo Intense)
const VARIANTS = new Set("intense intenso elixir extrait absolu absolute noir black gold silver platin platinum night nocturno sport rose red blue white extreme legacy oud privé prive reserve limited supreme exclusivo".split(" "));
function extraVariant(title: string, name: string) {
  const a = new Set(norm(name).split(/[^a-z0-9]+/)), b = new Set(norm(title).split(/[^a-z0-9]+/));
  // nos dois sentidos: Club de Nuit Intense ≠ Club de Nuit
  return [...b].some((w) => VARIANTS.has(w) && !a.has(w)) || [...a].some((w) => VARIANTS.has(w) && !b.has(w));
}

/** Amazon serve a mesma foto em vários tamanhos: pede a de 1500px. */
function upsize(u: string) {
  return u.replace(/\._[A-Z]{2}[^/]*_\.(jpg|jpeg|png|webp)$/i, "._AC_SL1500_.$1");
}

/** Quanto da borda da foto é branco/claro e liso (foto de produto em fundo branco): 0 a 1. */
async function whiteBorder(buf: Buffer): Promise<number> {
  const N = 64;
  const { data } = await sharp(buf, { failOn: "none" }).resize(N, N, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let white = 0, n = 0;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (x > 4 && x < N - 5 && y > 4 && y < N - 5) continue;
      const i = (y * N + x) * 3;
      n++;
      if (data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225) white++;
    }
  return white / n;
}

async function runSearch(q: string, productId?: number): Promise<Item[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return [];
  checkApify();
  return tracked(
    "google_images",
    { productId, label: q },
    async () => {
      const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=90&memory=256`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries: [q], maxResultsPerQuery: 30, gl: "br", hl: "pt-br" }),
        signal: AbortSignal.timeout(110_000),
      });
      if (!r.ok) throw await apifyFail("Google Imagens (Apify)", r);
      return (await r.json()) as Item[];
    },
    (r) => ({ items: r.length, result: `${r.length} imagem(ns)` }),
  );
}

/** Melhor foto de loja do perfume pelo nome real (como veio da fonte). Guarda a escolha por nome. */
export async function googlePhoto(realName: string, opts: { productId?: number; listing?: string } = {}): Promise<{ buf: Buffer; url: string; label: string } | null> {
  db().exec("CREATE TABLE IF NOT EXISTS google_photos4 (key TEXT PRIMARY KEY, url TEXT, label TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))");
  const name = realName.replace(/R\$\s*[\d.,]+/gi, " ").replace(/\b(por|reais|apenas|só|so)\b/gi, " ").replace(/[^\p{L}\p{N}'&.\s-]/gu, " ").replace(/\s+/g, " ").trim();
  const key = norm(name);
  if (!key) return null;
  const row = db().prepare("SELECT url, label, at FROM google_photos4 WHERE key = ?").get(key) as { url: string | null; label: string | null; at: string } | undefined;
  const fresh = row && Date.now() - new Date(row.at.replace(" ", "T") + "Z").getTime() < 3 * 86400e3;
  if (row?.url) {
    const buf = await download(row.url);
    if (buf) return { buf, url: row.url, label: row.label || "" };
  } else if (fresh) return null;
  let items: Item[];
  try {
    items = await runSearch(`${name} perfume`, opts.productId);
  } catch (e) {
    log("warn", `Google Imagens: ${(e as Error).message}`);
    return null;
  }
  const cands = items
    .filter((i) => i.imageUrl && !BLOCK.test(`${i.domain || ""} ${i.link || ""} ${i.imageUrl}`))
    // título da página tem que ser do mesmo perfume (Fakhar ≠ Fakhar Black) e, se tiver, do anúncio do ML
    .filter((i) => sameListing(i.title || "", name).ok && !extraVariant(i.title || "", name) && (!opts.listing || sameListing(i.title || "", opts.listing).score >= 0.5))
    .map((i) => ({ ...i, url: /amazon|media-amazon/.test(i.imageUrl!) ? upsize(i.imageUrl!) : i.imageUrl!, good: GOOD.test(`${i.domain} ${i.link}`) }))
    .sort((a, b) => Number(b.good) - Number(a.good) || Math.min(b.imageWidth || 0, b.imageHeight || 0) - Math.min(a.imageWidth || 0, a.imageHeight || 0))
    .slice(0, 8);
  let best: { buf: Buffer; url: string; label: string; score: number } | null = null;
  for (const c of cands) {
    const buf = await download(c.url);
    if (!buf) continue;
    const m = await sharp(buf, { failOn: "none" }).metadata().catch(() => null);
    const side = Math.min(m?.width || 0, m?.height || 0);
    if (side < 700) continue;
    const wb = await whiteBorder(buf).catch(() => 0);
    // só foto de produto em fundo claro: arte de loja (fundo cinza, logo, texto) tem marca de quem fez
    if (wb < 0.55) continue;
    // fundo branco (foto de produto) pesa mais; depois loja conhecida; depois tamanho
    const score = wb * 3 + (c.good ? 1 : 0) + Math.min(side, 1500) / 1500;
    if (!best || score > best.score) best = { buf, url: c.url, label: `${c.domain || ""}: ${(c.title || "").slice(0, 80)}`, score };
    if (wb > 0.85 && c.good) break;
  }
  db().prepare("INSERT OR REPLACE INTO google_photos4 (key, url, label, at) VALUES (?, ?, ?, datetime('now'))").run(key, best?.url ?? null, best?.label ?? null);
  log("info", best ? `Google Imagens: "${name.slice(0, 60)}" → ${best.label}` : `Google Imagens: nenhuma foto boa de loja para "${name.slice(0, 60)}" (${items.length} resultado(s))`);
  return best ? { buf: best.buf, url: best.url, label: best.label } : null;
}

async function download(u: string): Promise<Buffer | null> {
  try {
    const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", accept: "image/*" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok || !/image/.test(r.headers.get("content-type") || "image")) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}
