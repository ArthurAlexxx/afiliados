/**
 * Arthur (23/nov): fotos sem Apify. Busca o perfume direto no catálogo público das lojas (a mesma busca que o site
 * da loja usa: /api/catalog_system/pub/products/search, das lojas feitas em VTEX). É foto oficial do produto,
 * grande, em fundo branco e sem marca d'água. Sem custo.
 */
import sharp from "sharp";
import { db, log } from "./db.ts";
import { norm, sameListing } from "./perfume.ts";

const STORES = [
  "www.epocacosmeticos.com.br",
  "www.sephora.com.br",
  "www.cea.com.br",
  "www.lojasrenner.com.br",
  "www.drogariasaopaulo.com.br",
  "www.drogasil.com.br",
  "www.perfumariasumire.com.br",
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

// versão do perfume: tem que bater nos dois sentidos (Salvo ≠ Salvo Intense; Club de Nuit Intense ≠ Club de Nuit)
const VARIANTS = new Set("intense intenso elixir extrait absolu absolute noir black gold silver platin platinum night nocturno sport rose red blue white extreme legacy oud prive reserve limited supreme exclusivo".split(" "));
function variantClash(title: string, name: string) {
  const a = new Set(norm(name).split(/[^a-z0-9]+/)), b = new Set(norm(title).split(/[^a-z0-9]+/));
  return [...b].some((w) => VARIANTS.has(w) && !a.has(w)) || [...a].some((w) => VARIANTS.has(w) && !b.has(w));
}

/** Palavras para a busca da loja: sem ml, preço, "perfume", gênero e concentração. */
export function storeQuery(name: string) {
  return norm(name)
    .replace(/r\$\s*[\d.,]+/g, " ")
    .replace(/\b\d{2,4}\s*ml\b/g, " ")
    .replace(/\b(perfume|perfumes|arabe|masculino|feminino|unissex|unisex|eau|de|parfum|toilette|edp|edt|for|men|women|pour|homme|femme|por|reais|original|importado|lacrado|com|nf|deo|colonia|desodorante|o)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Hit = { store: string; title: string; url: string };

async function searchStore(host: string, q: string): Promise<{ hits: Hit[]; status: string }> {
  try {
    const r = await fetch(`https://${host}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(q)}&_from=0&_to=9`, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok && r.status !== 206) return { hits: [], status: `HTTP ${r.status}` };
    const j = (await r.json().catch(() => null)) as { productName?: string; brand?: string; items?: { name?: string; images?: { imageUrl?: string }[] }[] }[] | null;
    if (!Array.isArray(j)) return { hits: [], status: "sem JSON" };
    const hits: Hit[] = [];
    for (const p of j)
      for (const it of p.items || []) {
        const img = it.images?.[0]?.imageUrl;
        if (img) hits.push({ store: host, title: `${p.brand || ""} ${p.productName || ""} ${it.name || ""}`.trim(), url: img.replace(/^http:/, "https:") });
      }
    return { hits, status: `${j.length} produto(s)` };
  } catch (e) {
    return { hits: [], status: (e as Error).message.slice(0, 60) };
  }
}

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

async function download(u: string): Promise<Buffer | null> {
  try {
    const r = await fetch(u, { headers: { "user-agent": UA, accept: "image/*" }, signal: AbortSignal.timeout(15000) });
    return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/**
 * Foto oficial do perfume nas lojas, pelo nome real do post. Guarda a escolha por nome (não busca de novo)
 * e, com productId, põe a foto no banco de fotos do perfume (tela Fotos).
 */
export async function storePhoto(realName: string, opts: { productId?: number; listing?: string; debug?: boolean } = {}): Promise<{ buf: Buffer; url: string; label: string; tried?: string[] } | null> {
  db().exec("CREATE TABLE IF NOT EXISTS store_photos (key TEXT PRIMARY KEY, url TEXT, label TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))");
  const name = realName.replace(/R\$\s*[\d.,]+/gi, " ").replace(/\s+/g, " ").trim();
  const q = storeQuery(name);
  if (!q) return null;
  const row = db().prepare("SELECT url, label, at FROM store_photos WHERE key = ?").get(q) as { url: string | null; label: string | null; at: string } | undefined;
  if (row && !opts.debug) {
    if (row.url) {
      const buf = await download(row.url);
      if (buf) return { buf, url: row.url, label: row.label || "" };
    } else if (Date.now() - new Date(row.at.replace(" ", "T") + "Z").getTime() < 2 * 86400e3) return null;
  }
  const tried: string[] = [];
  const all = await Promise.all(STORES.map((h) => searchStore(h, q)));
  all.forEach((r, i) => tried.push(`${STORES[i]}: ${r.status}`));
  const cands = all
    .flatMap((r) => r.hits)
    .filter((h) => sameListing(h.title, name).ok && !variantClash(h.title, name) && (!opts.listing || sameListing(h.title, opts.listing).score >= 0.5));
  let best: { buf: Buffer; url: string; label: string; score: number } | null = null;
  for (const c of cands.slice(0, 6)) {
    const buf = await download(c.url);
    if (!buf) continue;
    const m = await sharp(buf, { failOn: "none" }).metadata().catch(() => null);
    const side = Math.min(m?.width || 0, m?.height || 0);
    if (side < 600) continue;
    const wb = await whiteBorder(buf).catch(() => 0);
    if (wb < 0.55) continue;
    const score = wb * 2 + Math.min(side, 1500) / 1500;
    if (!best || score > best.score) best = { buf, url: c.url, label: `${c.store.replace(/^www\./, "")}: ${c.title.slice(0, 80)}`, score };
  }
  db().prepare("INSERT OR REPLACE INTO store_photos (key, url, label, at) VALUES (?, ?, ?, datetime('now'))").run(q, best?.url ?? null, best?.label ?? null);
  log("info", best ? `Lojas: "${name.slice(0, 60)}" → ${best.label}` : `Lojas: nenhuma foto oficial de "${name.slice(0, 60)}" (${cands.length} produto(s) parecidos)`);
  if (best && opts.productId) {
    const { addImage } = await import("./curation.ts");
    await addImage(opts.productId, best.buf, `loja:${best.url.slice(0, 180)}`, "loja").catch(() => "");
  }
  return best ? { buf: best.buf, url: best.url, label: best.label, tried } : opts.debug ? { buf: Buffer.alloc(0), url: "", label: "nada", tried } : null;
}
