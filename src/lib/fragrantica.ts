/**
 * Nome padrão dos perfumes pela Fragrantica (pedido do Arthur): cada perfume do banco é procurado lá
 * e passa a se chamar "Marca Nome Concentração Xml" como na Fragrantica. Isso também junta repetidos:
 * dois cadastros que caem na mesma página da Fragrantica (com o mesmo ml) são o mesmo perfume.
 *
 * Busca pelo Apify (unfenced-group/fragrantica-perfume-scraper, só a lista da busca: ~US$ 0,003 por perfume).
 * O scraper do GitHub (jc855/fragrantica-scraper) tem a base só até 2017 e baixa direto do site, que hoje bloqueia.
 */
import { db, log } from "./db.ts";
import { BRAND_WORDS, FLANKERS, STOP, dist, isBrand, norm } from "./perfume.ts";

const ACTOR = "unfenced-group~fragrantica-perfume-scraper";
type Hit = { name: string; brand: string; url: string; ratingCount?: number; year?: number };

const GENERIC = new Set(["for", "men", "women", "man", "woman", "him", "her", "pour", "homme", "femme", "unisex", "eau", "de", "parfum", "toilette", "edp", "edt", "the", "perfumes", "perfume", "fragrances", "parfums", "paris"]);
const VARIANT = new Set([...FLANKERS, "elixir", "intense", "extrait", "parfum", "absolu", "bourbon", "nero", "vintage", "sequoia", "platin", "platinum", "noir", "oud", "gold", "silver", "black", "white", "blue", "red", "pink", "rose", "night", "sport", "edition", "limited", "prive", "privee", "reserve", "dark", "light", "pure", "extreme", "le", "la", "men", "women", "femme", "homme", "her", "him"]);

// "Bade'e" = "Badee"
const toks = (s: string) => norm(s.replace(/['’`´]/g, "")).split(" ").filter(Boolean);
const near = (a: string, b: string) => a === b || (a.length >= 5 && a[0] === b[0] && Math.abs(a.length - b.length) <= 2 && dist(a, b) <= (Math.min(a.length, b.length) >= 7 ? 2 : 1));
const FEM = /\b(feminino|feminina|women|woman|femme|her|pour elle)\b/;
const MASC = /\b(masculino|masculina|men|man|homme|him|pour homme)\b/;
const genderOf = (s: string) => (FEM.test(norm(s)) ? "f" : MASC.test(norm(s)) ? "m" : null);
const has = (list: string[], t: string) => list.some((x) => near(x, t));

async function runActor(input: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("falta APIFY_TOKEN");
  const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=120&memory=256`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(150_000),
  });
  if (!r.ok) throw new Error(`Apify ${r.status}: ${(await r.text()).replace(/\s+/g, " ").slice(0, 300)}`);
  return (await r.json()) as Record<string, unknown>[];
}

export type FragData = {
  url: string; name: string; brand: string; year: number | null; gender: string | null; family: string | null;
  description: string; top: string[]; middle: string[]; base: string[]; accords: { name: string; strength: number; color: string }[];
  seasons: Record<string, number>; longevity: number | null; sillage: number | null; rating: number | null; ratingCount: number | null;
  image: string | null; at: string;
};

/** Ficha completa do perfume (em português): descrição, pirâmide de notas, acordes, estações, fixação, projeção e foto. */
export async function fetchDetails(productId: number): Promise<FragData | null> {
  const p = db().prepare("SELECT frag_url FROM products WHERE id = ?").get(productId) as { frag_url: string | null } | undefined;
  if (!p?.frag_url) return null;
  const [d] = (await runActor({ startUrls: [{ url: p.frag_url }], scrapeDetails: true, includeCommunityVotes: true, includeReviews: false, maxResults: 1, language: "pt" })) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!d) return null;
  const notes = (l: unknown) => (Array.isArray(l) ? l.map((n: { name?: string }) => String(n.name || "")).filter(Boolean) : []);
  const data: FragData = {
    url: p.frag_url,
    name: String(d.name || ""),
    brand: String(d.brand || ""),
    year: Number(d.year) || null,
    gender: d.genderLabel || null,
    family: d.fragranceFamily || null,
    description: String(d.descriptionText || ""),
    top: notes(d.notesTop),
    middle: notes(d.notesMiddle),
    base: notes(d.notesBase),
    accords: Array.isArray(d.mainAccords) ? d.mainAccords.map((a: { name: string; strength: number; color: string }) => ({ name: a.name, strength: Math.round(a.strength), color: a.color })) : [],
    seasons: d.seasonVotes || {},
    longevity: d.longevity?.average ?? null,
    sillage: d.sillage?.average ?? null,
    rating: d.ratingValue ?? null,
    ratingCount: d.ratingCount ?? null,
    image: d.imageUrlLarge || d.imageUrl || null,
    at: new Date().toISOString(),
  };
  db().prepare("UPDATE products SET frag_data = ? WHERE id = ?").run(JSON.stringify(data), productId);
  // Arthur (nov/2026): a foto de capa do Fragrantica NÃO entra no banco; só as do "Fragram Photos" (api/fragram)
  return data;
}

async function search(q: string): Promise<Hit[]> {
  return ((await runActor({ searchQueries: [q], scrapeDetails: false, maxResults: 12 })) as unknown as Hit[]).filter((h) => h.name && h.brand);
}

/** Palavras que identificam o perfume no nosso nome (sem ml, concentração, gênero, "árabe"…). */
function core(name: string) {
  return toks(name.replace(/\b\d{2,4}\s*ml\b/gi, " ")).filter((t) => !/^\d+$/.test(t) && !STOP.has(t) && t.length > 1);
}

/** Escolhe o resultado da Fragrantica que é exatamente esse perfume (ou nenhum). */
export function pick(ourName: string, hits: Hit[]): Hit | null {
  const ours = core(ourName);
  const ourAll = toks(ourName);
  const ourG = genderOf(ourName);
  let best: Hit | null = null, bestScore = -1;
  const ok: Hit[] = [];
  for (const h of hits) {
    const hg = genderOf(h.name);
    if (ourG && hg && ourG !== hg) continue; // feminino ≠ For Men
    const brandToks = toks(h.brand).filter((t) => !GENERIC.has(t));
    // a marca tem que aparecer no nosso nome (ou o nosso nome não ter marca nenhuma)
    const ourHasBrand = ourAll.some((t) => isBrand(t) || BRAND_WORDS.has(t));
    const brandIn = brandToks.some((t) => has(ourAll, t));
    if (brandToks.length && ourHasBrand && !brandIn) continue;
    // números do nosso nome (212, 1 Million, 9pm) têm que estar no da Fragrantica: "212 NYC" ≠ "Nutrimetics NYC"
    const nums = toks(ourName.replace(/\b\d{2,4}\s*ml\b/gi, " ")).filter((t) => /^\d+$/.test(t));
    const theirs = toks(`${h.brand} ${h.name}`);
    if (nums.some((n) => !theirs.includes(n))) continue;
    const nameToks = toks(h.name).filter((t) => !GENERIC.has(t) || VARIANT.has(t));
    const key = nameToks.filter((t) => !GENERIC.has(t));
    if (!key.length) continue;
    // todas as palavras do nome da Fragrantica têm que estar no nosso (gênero só se estiver escrito)
    // "Emporio Armani Stronger With You": palavra de marca no nome da Fragrantica não precisa estar no nosso
    const missing = nameToks.filter((t) => !has(ourAll, t) && !isBrand(t) && !BRAND_WORDS.has(t) && !has(brandToks, t) && !(STOP.has(t) && !VARIANT.has(t)) && !["men", "women", "her", "him", "femme", "homme", "le", "la"].includes(t));
    if (missing.length) continue;
    // e o nosso não pode ter uma variação que a Fragrantica não tem (Salvo ≠ Salvo Intense)
    const extraVariant = ours.filter((t) => VARIANT.has(t) && !has(nameToks, t) && !has(brandToks, t));
    if (extraVariant.length) continue;
    // a maior parte das nossas palavras explicada pela marca + nome
    const explained = ours.filter((t) => has(nameToks, t) || has(brandToks, t) || isBrand(t)).length;
    // palavras de anúncio que a Fragrantica não usa ("Belgravia Royal Collection" = "Belgravia") não contam contra
    const soft = ours.filter((t) => !(has(nameToks, t) || has(brandToks, t) || isBrand(t)) && SOFT.has(t)).length;
    if (explained / Math.max(1, ours.length - (brandIn ? soft : 0)) < 0.6) continue;
    // sem a marca no nosso nome: só aceita nome com 2+ palavras e perfume conhecido
    if (!brandIn && (key.length < 2 || (h.ratingCount || 0) < 300)) continue;
    const sc = key.length * 10 + explained + Math.log10(1 + (h.ratingCount || 0)) / 10;
    ok.push(h);
    if (sc > bestScore) (bestScore = sc), (best = h);
  }
  // sem gênero no nosso nome e a Fragrantica tem versão masculina e feminina: não dá para saber qual é
  if (best && !ourG && genderOf(best.name)) {
    const base = norm(best.name).replace(MASC, "").replace(FEM, "").replace(/\bfor\b/g, "").trim();
    if (ok.some((h) => h !== best && genderOf(h.name) && genderOf(h.name) !== genderOf(best!.name) && norm(h.name).replace(MASC, "").replace(FEM, "").replace(/\bfor\b/g, "").trim() === base)) return null;
  }
  return best;
}

const SOFT = new Set(["royal", "collection", "colecao", "original", "importado", "lacrado", "novo", "masculino", "feminino", "unissex", "perfume", "fragrance"]);

const CONC: Record<string, string> = { edp: "EDP", edt: "EDT", extrait: "Extrait de Parfum", parfum: "Parfum", deo: "Deo Parfum", colonia: "Colônia" };

/** Nome simples (pedido do Arthur): Marca + nome como está na Fragrantica + ml. */
export function canonicalName(h: Pick<Hit, "brand" | "name">, ml: number, _conc?: string | null) {
  // "MAISON ASRAR" → "Maison Asrar"
  const cap = (s: string) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m) => m.toUpperCase()) : s);
  const brand = cap(h.brand.replace(/\s+(Perfumes|Parfums|Fragrances|Paris)$/i, "").trim());
  let name = h.name.trim();
  if (!norm(name).startsWith(norm(brand))) name = `${brand} ${name}`;
  return `${name}${ml ? ` ${ml}ml` : ""}`.replace(/\s+/g, " ").trim();
}

/** Procura um perfume na Fragrantica e, se achar com certeza, troca o nome dele pelo padrão. */
export async function standardize(productId: number): Promise<string> {
  const p = db().prepare("SELECT id, name, ml, conc FROM products WHERE id = ?").get(productId) as { id: number; name: string; ml: number; conc: string | null } | undefined;
  if (!p) return "perfume não existe";
  const q = core(p.name).join(" ");
  db().prepare("UPDATE products SET frag_checked_at = datetime('now') WHERE id = ?").run(p.id);
  if (!q) return "nome vazio";
  let hits: Hit[];
  try {
    hits = await search(q);
  } catch (e) {
    // falha do Apify (limite, rede): tenta de novo numa próxima rodada
    db().prepare("UPDATE products SET frag_checked_at = NULL WHERE id = ?").run(p.id);
    throw e;
  }
  const h = pick(p.name, hits);
  if (!h) {
    log("info", `Fragrantica: não achei com certeza "${p.name}" (${hits.slice(0, 3).map((x) => `${x.brand} ${x.name}`).join(" | ") || "nada"})`);
    return "não achei";
  }
  const name = canonicalName(h, p.ml, p.conc);
  db().prepare("UPDATE products SET frag_name = ?, frag_brand = ?, frag_url = ?, name = ? WHERE id = ?").run(h.name, h.brand, h.url, name, p.id);
  if (name !== p.name) log("info", `Fragrantica: "${p.name}" → "${name}"`);
  await fetchDetails(p.id).catch((e) => log("warn", `Fragrantica (ficha): ${(e as Error).message}`));
  await fetchFragram(p.id).catch((e) => log("warn", `Fragram: ${(e as Error).message}`));
  return name;
}

/** Fila: perfumes ainda não conferidos, os com promoção recente primeiro. Um por vez. */
/**
 * Fotos da seção "Fragram Photos" da página do perfume. O servidor não abre o Fragrantica direto (Cloudflare),
 * então a página vem pelo Web Fetch do Apify (~US$ 0,0015 por página); guarda só as URLs das fotos.
 */
export async function fetchFragram(productId: number): Promise<number> {
  const p = db().prepare("SELECT frag_url FROM products WHERE id = ?").get(productId) as { frag_url: string | null } | undefined;
  if (!p?.frag_url || !process.env.APIFY_TOKEN) return 0;
  const page = "https://www.fragrantica.com" + new URL(p.frag_url).pathname;
  const r = await fetch(`https://apify--web-fetch.apify.actor/?formats=links&url=${encodeURIComponent(page)}`, {
    headers: { authorization: `Bearer ${process.env.APIFY_TOKEN}` },
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) throw new Error(`Web Fetch respondeu ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = (await r.json()) as { links?: string[]; fetch?: { httpStatusCode?: number } };
  if (j.fetch?.httpStatusCode && j.fetch.httpStatusCode >= 400) throw new Error(`Fragrantica respondeu ${j.fetch.httpStatusCode}`);
  const urls = [...new Set((j.links || []).filter((u) => /^https:\/\/fimgs\.net\/photogram\/p1200\//.test(u)))];
  const ins = db().prepare("INSERT OR IGNORE INTO frag_photos (frag_url, url, thumb) VALUES (?, ?, ?)");
  let n = 0;
  for (const u of urls) n += Number(ins.run(p.frag_url, u, u.replace("/p1200/", "/p180/")).changes);
  db().prepare("UPDATE products SET fragram_at = datetime('now') WHERE frag_url = ?").run(p.frag_url);
  log("info", `Fragram: ${urls.length} foto(s) em ${page.split("/").pop()} (${n} nova(s))`);
  return urls.length;
}

export async function fragranticaStep(max = 4) {
  if (!process.env.APIFY_TOKEN || process.env.FRAGRANTICA === "0") return;
  const g = globalThis as { __fragBusy?: boolean };
  if (g.__fragBusy) return;
  g.__fragBusy = true;
  try {
    const rows = db()
      .prepare(
        `SELECT p.id FROM products p WHERE p.frag_checked_at IS NULL
         ORDER BY EXISTS (SELECT 1 FROM posts q WHERE q.product_id = p.id AND q.status = 'photo') DESC, (SELECT MAX(o.created_at) FROM offers o WHERE o.product_id = p.id) DESC LIMIT ?`,
      )
      .all(max) as { id: number }[];
    // várias buscas ao mesmo tempo (auditoria rápida do banco)
    const res = await Promise.all(rows.map((r) => standardize(r.id).catch((e) => (log("warn", `Fragrantica: ${(e as Error).message}`), ""))));
    const changed = res.filter((n) => n && n !== "não achei" && n !== "nome vazio").length;
    // já achados antes desta versão: busca a ficha completa (2 por rodada)
    const old = db().prepare("SELECT id FROM products WHERE frag_url IS NOT NULL AND frag_data IS NULL LIMIT 2").all() as { id: number }[];
    await Promise.all(old.map((r) => fetchDetails(r.id).catch((e) => log("warn", `Fragrantica (ficha): ${(e as Error).message}`))));
    // Fragram Photos dos que ainda não foram lidos (posts esperando foto primeiro), 3 por rodada
    const gram = db()
      .prepare(
        `SELECT MIN(p.id) id FROM products p WHERE p.frag_url IS NOT NULL AND p.fragram_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM frag_photos f WHERE f.frag_url = p.frag_url)
         GROUP BY p.frag_url ORDER BY MAX(EXISTS (SELECT 1 FROM posts q WHERE q.product_id = p.id AND q.status = 'photo')) DESC, MAX(p.id) DESC LIMIT 3`,
      )
      .all() as { id: number }[];
    await Promise.all(gram.map((r) => fetchFragram(r.id).catch((e) => log("warn", `Fragram: ${(e as Error).message}`))));
    if (changed) {
      const { mergeDuplicateProducts } = await import("./curation.ts");
      const m = mergeDuplicateProducts();
      if (m) log("info", `Fragrantica: ${m} repetido(s) juntado(s) pelo nome padrão`);
    }
  } finally {
    g.__fragBusy = false;
  }
}
