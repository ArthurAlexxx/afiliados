/**
 * Nome padrão dos perfumes pela Fragrantica (pedido do Arthur): cada perfume do banco é procurado lá
 * e passa a se chamar "Marca Nome Concentração Xml" como na Fragrantica. Isso também junta repetidos:
 * dois cadastros que caem na mesma página da Fragrantica (com o mesmo ml) são o mesmo perfume.
 *
 * Busca pelo Apify (unfenced-group/fragrantica-perfume-scraper, só a lista da busca: ~US$ 0,003 por perfume).
 * O scraper do GitHub (jc855/fragrantica-scraper) tem a base só até 2017 e baixa direto do site, que hoje bloqueia.
 */
import { db, log } from "./db.ts";
import { apifyFail, checkApify, overDailyBudget, priceTable, recordCall, refreshTier, tracked } from "./apify.ts";
import { BRAND_WORDS, FLANKERS, STOP, dist, isBrand, norm, notPerfume } from "./perfume.ts";

const ACTOR = "unfenced-group~fragrantica-perfume-scraper";
type Hit = { name: string; brand: string; url: string; ratingCount?: number; year?: number };

const GENERIC = new Set(["for", "men", "women", "man", "woman", "him", "her", "pour", "homme", "femme", "unisex", "eau", "de", "parfum", "toilette", "edp", "edt", "the", "perfumes", "perfume", "fragrances", "parfums", "paris"]);
const VARIANT = new Set([...FLANKERS, "elixir", "intense", "extrait", "parfum", "absolu", "bourbon", "nero", "vintage", "sequoia", "platin", "platinum", "noir", "oud", "gold", "silver", "black", "white", "blue", "red", "pink", "rose", "night", "sport", "edition", "limited", "prive", "privee", "reserve", "dark", "light", "pure", "extreme", "le", "la", "men", "women", "femme", "homme", "her", "him"]);

// "Bade'e" = "Badee"
// "One Million"/"1 Million" = "Million"; "Eau de Parfum Intense" é concentração, não versão "Intense"
const prep = (s: string) =>
  s
    .replace(/['’`´]/g, "")
    .replace(/([a-z])\.([a-z])/gi, "$1$2") // Natura "Evolut.io", "Cor.Agio"
    .replace(/\b(1|one)\s+million\b/gi, "million")
    .replace(/\b(eau de parfum|eau de toilette|edp|edt)\s+intense\b/gi, "$1")
    .replace(/\b(masc|fem|tradicional|original)\b/gi, " ");
const toks = (s: string) => norm(prep(s)).split(" ").filter(Boolean);
const near = (a: string, b: string) => a === b || (a.length >= 5 && a[0] === b[0] && Math.abs(a.length - b.length) <= 2 && dist(a, b) <= (Math.min(a.length, b.length) >= 7 ? 2 : 1));
const FEM = /\b(feminino|feminina|women|woman|femme|her|pour elle)\b/;
const MASC = /\b(masculino|masculina|men|man|homme|him|pour homme)\b/;
const genderOf = (s: string) => (FEM.test(norm(s)) ? "f" : MASC.test(norm(s)) ? "m" : null);
const has = (list: string[], t: string) => list.some((x) => near(x, t));

async function runActor(input: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("falta APIFY_TOKEN");
  checkApify();
  const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=120&memory=256`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(150_000),
  });
  if (!r.ok) throw await apifyFail("Apify", r);
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
  const [d] = (await tracked(
    "frag_details",
    { productId, label: decodeURIComponent(new URL(p.frag_url).pathname.split("/").pop() || "").replace(/-\d+\.html$/, "").replace(/-/g, " ") },
    () => runActor({ startUrls: [{ url: p.frag_url }], scrapeDetails: true, includeCommunityVotes: true, includeReviews: false, maxResults: 1, language: "pt" }),
    (r) => ({ items: r.length, result: r.length ? "ficha lida" : "página sem ficha" }),
  )) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!d) return null;
  return saveDetails(productId, p.frag_url, d);
}

const fragId = (u: string) => (u.match(/-(\d+)\.html/) || [])[1] || "";

/**
 * Fichas de vários perfumes numa execução só do robô (Arthur, 17/nov: "juntar as buscas"):
 * paga 1 abertura do robô para o lote em vez de 1 por perfume.
 */
export async function fetchDetailsBatch(ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = ids
    .map((id) => db().prepare("SELECT id, frag_url FROM products WHERE id = ?").get(id) as { id: number; frag_url: string | null } | undefined)
    .filter((r): r is { id: number; frag_url: string } => !!r?.frag_url);
  if (!rows.length) return 0;
  const urls = [...new Set(rows.map((r) => r.frag_url))];
  const t0 = Date.now();
  let items: Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    items = (await runActor({ startUrls: urls.map((url) => ({ url })), scrapeDetails: true, includeCommunityVotes: true, includeReviews: false, maxResults: urls.length, language: "pt" })) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch (e) {
    if (!/sem saldo/.test((e as Error).message)) for (const r of rows) recordCall({ kind: "frag_details", productId: r.id, label: r.frag_url, ok: false, result: (e as Error).message });
    throw e;
  }
  const pt = priceTable();
  const share = pt.start / rows.length;
  let n = 0;
  for (const r of rows) {
    const d = items.find((x) => fragId(String(x.url || "")) === fragId(r.frag_url) || String(x.perfumeId || "") === fragId(r.frag_url));
    if (d) {
      saveDetails(r.id, r.frag_url, d);
      n++;
    }
    recordCall({ kind: "frag_details", productId: r.id, label: r.frag_url, items: d ? 1 : 0, cost: share + (d ? pt.profile : 0), ms: Date.now() - t0, result: d ? `ficha lida (lote de ${rows.length})` : "página sem ficha" });
  }
  // achou ou não, não pede de novo sozinho: marca a ficha como "tentada"
  for (const r of rows) db().prepare("UPDATE products SET frag_data = COALESCE(frag_data, '{}') WHERE id = ?").run(r.id);
  return n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function saveDetails(productId: number, url: string, d: Record<string, any>): FragData {
  const p = { frag_url: url };
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

/** Busca vários nomes numa execução só (1 abertura do robô por lote). Devolve os resultados de cada busca. */
async function searchBatch(list: { id: number; q: string }[]): Promise<Map<string, Hit[]>> {
  const qs = [...new Set(list.map((x) => x.q))];
  const t0 = Date.now();
  let items: (Hit & { searchQuery?: string })[];
  try {
    items = (await runActor({ searchQueries: qs, scrapeDetails: false, maxResults: 8 * qs.length })) as unknown as (Hit & { searchQuery?: string })[];
  } catch (e) {
    if (!/sem saldo/.test((e as Error).message)) for (const x of list) recordCall({ kind: "frag_search", productId: x.id, label: x.q, ok: false, result: (e as Error).message });
    throw e;
  }
  const out = new Map<string, Hit[]>();
  for (const q of qs) out.set(q, []);
  for (const it of items) if (it.name && it.brand && it.searchQuery && out.has(it.searchQuery)) out.get(it.searchQuery)!.push(it);
  const pt = priceTable();
  for (const x of list) {
    const n = out.get(x.q)?.length || 0;
    recordCall({ kind: "frag_search", productId: x.id, label: x.q, items: n, cost: pt.start / list.length + n * pt.listing, ms: Date.now() - t0, result: `${n} resultado(s) (lote de ${list.length})` });
  }
  return out;
}

async function search(q: string, productId?: number): Promise<Hit[]> {
  const items = await tracked("frag_search", { productId, label: q }, () => runActor({ searchQueries: [q], scrapeDetails: false, maxResults: 8 }), (r) => ({ items: r.length, result: `${r.length} resultado(s)` }));
  return (items as unknown as Hit[]).filter((h) => h.name && h.brand);
}

/** Depois de decidir, escreve na última puxada do perfume o que ela achou (aparece na lista da página Scraping). */
function noteResult(kind: string, productId: number, result: string) {
  db().prepare("UPDATE api_calls SET result = ? WHERE id = (SELECT MAX(id) FROM api_calls WHERE kind = ? AND product_id = ?)").run(result.slice(0, 300), kind, productId);
}

/** Palavras que identificam o perfume no nosso nome (sem ml, concentração, gênero, "árabe"…). */
function core(name: string) {
  return toks(name.replace(/\b\d{2,4}\s*ml\b/gi, " ")).filter((t) => !/^\d+$/.test(t) && !STOP.has(t) && t.length > 1);
}

/** Concentração escrita no nome: colonia | edt | edp | extrait | parfum (sozinho, "Le Parfum") */
function concOf(name: string): string | null {
  const n = norm(name);
  if (/\b(colonia|cologne|eau de cologne|edc)\b/.test(n)) return "colonia";
  if (/\b(eau de toilette|edt)\b/.test(n)) return "edt";
  if (/\b(extrait)\b/.test(n)) return "extrait";
  if (/\b(eau de parfum|edp)\b/.test(n)) return "edp";
  if (/\bparfum\b/.test(n)) return "parfum";
  return null;
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
    // concentração escrita nos dois e diferente: "Code Parfum" ≠ "Code Colonia"
    const hc = concOf(h.name), oc = concOf(ourName);
    if (hc && oc && hc !== oc) continue;
    if (hc === "colonia" && oc !== "colonia") continue;
    const nameToks = toks(h.name).filter((t) => !GENERIC.has(t) || VARIANT.has(t));
    const key = nameToks.filter((t) => !GENERIC.has(t));
    if (!key.length) continue;
    // todas as palavras do nome da Fragrantica têm que estar no nosso (gênero só se estiver escrito)
    // "Emporio Armani Stronger With You": palavra de marca no nome da Fragrantica não precisa estar no nosso
    const missing = nameToks.filter((t) => !has(ourAll, t) && !isBrand(t) && !BRAND_WORDS.has(t) && !has(brandToks, t) && !(STOP.has(t) && !VARIANT.has(t)) && !["men", "women", "her", "him", "femme", "homme", "le", "la"].includes(t));
    if (missing.length) continue;
    // e o nosso não pode ter uma variação que a Fragrantica não tem (Salvo ≠ Salvo Intense)
    const extraVariant = ours.filter((t) => VARIANT.has(t) && !has(nameToks, t) && !has(brandToks, t) && !(t === "royal" && /royal\s+collection/i.test(ourName)));
    if (extraVariant.length) continue;
    // a maior parte das nossas palavras explicada pela marca + nome
    const explained = ours.filter((t) => has(nameToks, t) || has(brandToks, t) || isBrand(t)).length;
    // palavras de anúncio que a Fragrantica não usa ("Belgravia Royal Collection" = "Belgravia") não contam contra
    const soft = ours.filter((t) => !(has(nameToks, t) || has(brandToks, t) || isBrand(t)) && SOFT.has(t)).length;
    if (explained / Math.max(1, ours.length - (brandIn ? soft : 0)) < 0.6) continue;
    // palavra do nosso nome (fora a marca) que a Fragrantica não tem: "Homem Evolutio" ≠ "Homem"
    const unexpl = ours.filter((t) => !(has(nameToks, t) || has(brandToks, t) || isBrand(t) || BRAND_WORDS.has(t)) && !SOFT.has(t));
    if (key.length === 1 && unexpl.length) continue;
    if (unexpl.length > 1) continue;
    // sem a marca no nosso nome: só aceita nome com 2+ palavras e perfume conhecido
    if (!brandIn && (key.length < 2 || (h.ratingCount || 0) < 300)) continue;
    // nosso nome sem gênero: o nome sem "For Her/For Him" é o original ("Million Gold" e não "Million Gold For Her")
    const sc = key.length * 10 + explained + Math.log10(1 + (h.ratingCount || 0)) / 10 - (!ourG && hg ? 15 : 0) - unexpl.length * 3;
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

const SOFT = new Set(["niche", "beauty", "royal", "collection", "colecao", "original", "importado", "lacrado", "novo", "masculino", "feminino", "unissex", "perfume", "fragrance"]);

const CONC: Record<string, string> = { edp: "EDP", edt: "EDT", extrait: "Extrait de Parfum", parfum: "Parfum", deo: "Deo Parfum", colonia: "Colônia" };

/** Nome simples (pedido do Arthur): Marca + nome como está na Fragrantica + ml. */
export function canonicalName(h: Pick<Hit, "brand" | "name">, ml: number, _conc?: string | null) {
  // "MAISON ASRAR" → "Maison Asrar"
  const cap = (s: string) => (s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m) => m.toUpperCase()) : s);
  const brand = cap(h.brand.replace(/\s+(Perfumes|Parfums|Fragrances|Paris)$/i, "").trim());
  let name = h.name.trim();
  // "Armani Code Parfum" já começa com uma palavra da marca (Giorgio Armani): não repete a marca
  // "Emporio Armani Stronger With You" já tem "Armani" (Giorgio Armani): não repete a marca
  const bt = toks(brand).filter((t) => t.length > 2);
  if (!norm(name).startsWith(norm(brand)) && !bt.some((t) => toks(name).includes(t))) name = `${brand} ${name}`;
  return `${name}${ml ? ` ${ml}ml` : ""}`.replace(/\s+/g, " ").trim();
}

const ROMAN = new Set(["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]);

/**
 * Quando o nome não decide entre versões da mesma linha (só muda o número: "Art of Arabia I/II/III"),
 * compara a foto de referência do perfume (a do post que pegamos / anúncio do ML) com o frasco de cada versão.
 */
async function pickByPhoto(productId: number, ourName: string, hits: Hit[]): Promise<Hit | null> {
  const ourAll = toks(ourName);
  const fam = hits.filter((h) => {
    const brandToks = toks(h.brand).filter((t) => !GENERIC.has(t));
    if (brandToks.length && !brandToks.some((t) => has(ourAll, t))) return false;
    const nameToks = toks(h.name).filter((t) => !GENERIC.has(t));
    const key = nameToks.filter((t) => !ROMAN.has(t) && !/^\d+$/.test(t));
    if (!key.length) return false;
    // todas as palavras batem; o que falta é só o número da versão
    return key.every((t) => has(ourAll, t) || STOP.has(t) || has(brandToks, t));
  });
  if (fam.length < 2) return null;
  const { refImage, colorSig, sigSim } = await import("./pinterest.ts");
  const ref = await refImage(productId);
  if (!ref) return null;
  const rs = await colorSig(ref);
  const scored: { h: Hit; sim: number }[] = [];
  for (const h of fam) {
    const id = /-(\d+)\.html/.exec(h.url)?.[1];
    if (!id) continue;
    const r = await fetch(`https://fimgs.net/mdimg/perfume/o.${id}.jpg`, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!r?.ok) continue;
    scored.push({ h, sim: sigSim(rs, await colorSig(Buffer.from(await r.arrayBuffer()))) });
  }
  scored.sort((a, b) => b.sim - a.sim);
  const [a, b] = scored;
  const msg = scored.map((x) => `${x.h.name} ${(x.sim * 100).toFixed(0)}%`).join(", ");
  if (a && a.sim >= 0.55 && (!b || a.sim - b.sim >= 0.12)) {
    log("info", `Fragrantica: "${ourName}" decidido pela foto do anúncio → ${a.h.name} (${msg})`);
    return a.h;
  }
  log("info", `Fragrantica: "${ourName}" foto não decidiu entre as versões (${msg})`);
  return null;
}

/** Hit a partir do link: /perfume/Giorgio-Armani/Emporio-Armani-Stronger-With-You-Intensely-52802.html */
export function hitFromUrl(url: string): Hit | null {
  const m = /fragrantica\.[a-z.]+\/perfume\/([^/]+)\/(.+)-(\d+)\.html/i.exec(url);
  if (!m) return null;
  return { brand: decodeURIComponent(m[1]).replace(/-/g, " "), name: decodeURIComponent(m[2]).replace(/-/g, " "), url: `https://www.fragrantica.com/perfume/${m[1]}/${m[2]}-${m[3]}.html` };
}

/** Busca no Google só dentro do Fragrantica (Apify Web Search), com o nome que veio do anúncio. */
async function searchGoogle(name: string, productId?: number): Promise<Hit[]> {
  if (!process.env.APIFY_TOKEN) return [];
  return tracked("frag_google", { productId, label: name }, () => searchGoogleRaw(name), (r) => ({ items: r.length, result: `${r.length} página(s) do Fragrantica` }));
}

async function searchGoogleRaw(name: string): Promise<Hit[]> {
  checkApify();
  const q = name.replace(/\b\d{2,4}\s*ml\b/gi, " ").replace(/\s+/g, " ").trim();
  const r = await fetch("https://apify--web-search.apify.actor/", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.APIFY_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query: `${q} fragrantica`, maxResults: 8, allowedDomains: ["fragrantica.com"] }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw await apifyFail("Web Search respondeu", r);
  const j = (await r.json()) as { results?: { url: string }[] };
  const out: Hit[] = [];
  for (const x of j.results || []) {
    const h = hitFromUrl(x.url);
    if (h && !out.some((o) => o.url === h.url)) out.push(h);
  }
  return out;
}

/** Procura um perfume na Fragrantica e, se achar com certeza, troca o nome dele pelo padrão. */
export async function standardize(productId: number, pre?: Hit[]): Promise<string> {
  const p = db().prepare("SELECT id, name, ml, conc FROM products WHERE id = ?").get(productId) as { id: number; name: string; ml: number; conc: string | null } | undefined;
  if (!p) return "perfume não existe";
  const q = core(p.name).join(" ");
  db().prepare("UPDATE products SET frag_checked_at = datetime('now') WHERE id = ?").run(p.id);
  if (!q) return "nome vazio";
  let hits: Hit[];
  try {
    hits = pre ?? (await search(q, p.id));
    // procurado (pago): nunca mais procura sozinho; para trocar, só colando o link na tela Fotos
    db().prepare("UPDATE products SET frag_searched = frag_searched + 1 WHERE id = ?").run(p.id);
  } catch (e) {
    // falha do Apify (limite, rede): tenta de novo numa próxima rodada
    db().prepare("UPDATE products SET frag_checked_at = NULL WHERE id = ?").run(p.id);
    throw e;
  }
  let h = pick(p.name, hits);
  noteResult("frag_search", p.id, h ? `achou: ${h.brand} ${h.name}` : `${hits.length} resultado(s), nenhum com certeza`);
  // a busca do Fragrantica se perde com palavras de anúncio ("Armani Beauty ..."): tenta pelo Google, só páginas do Fragrantica
  const waitingPost = !!db().prepare("SELECT 1 FROM posts WHERE product_id = ? AND status = 'photo'").get(p.id);
  if (!h && (waitingPost || !pre)) {
    const g = await searchGoogle(p.name, p.id).catch((e) => (log("warn", `Fragrantica (Google): ${(e as Error).message}`), [] as Hit[]));
    if (g.length) {
      h = pick(p.name, g);
      noteResult("frag_google", p.id, h ? `achou: ${h.brand} ${h.name}` : `${g.length} página(s), nenhuma com certeza`);
      if (h) log("info", `Fragrantica: "${p.name}" achado pelo Google → ${h.brand} ${h.name}`);
      else hits = [...g, ...hits];
    }
  }
  // várias versões do mesmo perfume (Art of Arabia I, II, III): decide pela foto do anúncio original
  if (!h) h = await pickByPhoto(p.id, p.name, hits).catch((e) => (log("warn", `Fragrantica (foto): ${(e as Error).message}`), null));
  if (!h) {
    log("info", `Fragrantica: não achei com certeza "${p.name}" (${hits.slice(0, 3).map((x) => `${x.brand} ${x.name}`).join(" | ") || "nada"})`);
    return "não achei";
  }
  const name = canonicalName(h, p.ml, p.conc);
  db().prepare("UPDATE products SET frag_name = ?, frag_brand = ?, frag_url = ?, name = ? WHERE id = ?").run(h.name, h.brand, h.url, name, p.id);
  if (name !== p.name) log("info", `Fragrantica: "${p.name}" → "${name}"`);
  const known = db().prepare("SELECT frag_data FROM products WHERE frag_url = ? AND frag_data IS NOT NULL AND id != ? LIMIT 1").get(h.url, p.id) as { frag_data: string } | undefined;
  if (known) db().prepare("UPDATE products SET frag_data = ? WHERE id = ?").run(known.frag_data, p.id);
  else if (!pre) await fetchDetails(p.id).catch((e) => log("warn", `Fragrantica (ficha): ${(e as Error).message}`));
  await fetchFragram(p.id).catch((e) => log("warn", `Fragram: ${(e as Error).message}`));
  return name;
}

/** Fila: perfumes ainda não conferidos, os com promoção recente primeiro. Um por vez. */
/**
 * Fotos da seção "Fragram Photos" da página do perfume. O servidor não abre o Fragrantica direto (Cloudflare),
 * então a página vem pelo Web Fetch do Apify (~US$ 0,0015 por página); guarda só as URLs das fotos.
 */
export async function fetchFragram(productId: number, force = false): Promise<number> {
  const p = db().prepare("SELECT frag_url FROM products WHERE id = ?").get(productId) as { frag_url: string | null } | undefined;
  if (!p?.frag_url || !process.env.APIFY_TOKEN) return 0;
  // página já lida (por este ou outro cadastro do mesmo perfume): não paga de novo
  if (!force && db().prepare("SELECT 1 FROM products WHERE frag_url = ? AND fragram_at IS NOT NULL UNION SELECT 1 FROM frag_photos WHERE frag_url = ?").get(p.frag_url, p.frag_url)) {
    db().prepare("UPDATE products SET fragram_at = COALESCE(fragram_at, datetime('now')) WHERE frag_url = ?").run(p.frag_url);
    return (db().prepare("SELECT COUNT(*) n FROM frag_photos WHERE frag_url = ?").get(p.frag_url) as { n: number }).n;
  }
  const label = decodeURIComponent(new URL(p.frag_url).pathname.split("/").pop() || "").replace(/-\d+\.html$/, "").replace(/-/g, " ");
  const url = p.frag_url;
  fragNow().urls.add(url);
  try {
    return await tracked("frag_photos", { productId, label }, () => fetchFragramRaw(url), (n) => ({ items: 1, result: `${n} foto(s)` }));
  } finally {
    fragNow().urls.delete(url);
  }
}

async function fetchFragramRaw(fragUrl: string): Promise<number> {
  const p = { frag_url: fragUrl };
  checkApify();
  const page = "https://www.fragrantica.com" + new URL(p.frag_url).pathname;
  const r = await fetch(`https://apify--web-fetch.apify.actor/?formats=html&url=${encodeURIComponent(page)}`, {
    headers: { authorization: `Bearer ${process.env.APIFY_TOKEN}` },
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) throw await apifyFail("Web Fetch respondeu", r);
  const j = (await r.json()) as { html?: string; fetch?: { httpStatusCode?: number } };
  if (j.fetch?.httpStatusCode && j.fetch.httpStatusCode >= 400) throw new Error(`Fragrantica respondeu ${j.fetch.httpStatusCode}`);
  const html = j.html || "";
  const found = new Map<string, string>(); // url grande -> miniatura
  // fotos dos usuários (Fragram): qualquer tamanho (p180, p600, p1200) vira a de 1200px
  for (const m of html.matchAll(/https:\/\/fimgs\.net\/photogram\/p\d+\/([a-z0-9]{2})\/([a-z0-9]{2})\/([A-Za-z0-9_-]+)\.(jpg|jpeg|png|webp)/g)) {
    const path = `${m[1]}/${m[2]}/${m[3]}.${m[4]}`;
    found.set(`https://fimgs.net/photogram/p1200/${path}`, `https://fimgs.net/photogram/p180/${path}`);
  }
  // perfume sem fotos de usuários: a seção mostra as fotos oficiais da marca ("secundar"), 580px
  for (const m of html.matchAll(/https:\/\/fimgs\.net\/mdimg\/secundar\/[a-z]+\.(\d+)\.jpg/g))
    found.set(`https://fimgs.net/mdimg/secundar/o.${m[1]}.jpg`, `https://fimgs.net/mdimg/secundar/fit.${m[1]}.jpg`);
  const urls = [...found.keys()];
  const ins = db().prepare("INSERT OR IGNORE INTO frag_photos (frag_url, url, thumb) VALUES (?, ?, ?)");
  let n = 0;
  for (const u of urls) n += Number(ins.run(p.frag_url, u, found.get(u)!).changes);
  db().prepare("UPDATE products SET fragram_at = datetime('now') WHERE frag_url = ?").run(p.frag_url);
  log("info", `Fragram: ${urls.length} foto(s) em ${page.split("/").pop()} (${n} nova(s))`);
  return urls.length;
}

/**
 * Arthur (17/nov): nada de reprocessar o banco. Só vai ao Apify o perfume que vai ser postado agora
 * (post esperando foto) e que ainda não tem foto escolhida: procura o nome dele no Fragrantica e lê as fotos da página.
 */
/** O que está indo ao Apify agora, para a tela Fotos mostrar "procurando…" em cada perfume. */
export function fragNow(): { names: Set<number>; urls: Set<string> } {
  const g = globalThis as { __fragNow?: { names: Set<number>; urls: Set<string> } };
  return (g.__fragNow ??= { names: new Set(), urls: new Set() });
}

const WAITING = `p.main_image_id IS NULL AND EXISTS (SELECT 1 FROM posts q WHERE q.product_id = p.id AND q.status = 'photo')`;

export async function fragranticaStep(max = 10) {
  if (!process.env.APIFY_TOKEN || process.env.FRAGRANTICA === "0") return;
  const g = globalThis as { __fragBusy?: boolean };
  if (g.__fragBusy) return;
  g.__fragBusy = true;
  try {
    await refreshTier();
    if (overDailyBudget()) return;
    let rows = db()
      .prepare(
        `SELECT p.id, p.name FROM products p WHERE ${WAITING} AND p.frag_url IS NULL AND p.frag_searched = 0
         ORDER BY p.id DESC LIMIT ?`,
      )
      .all(max * 3) as { id: number; name: string }[];
    // kit, body splash, creme...: não existe no Fragrantica, não gasta procurando
    const skip = db().prepare("UPDATE products SET frag_checked_at = datetime('now') WHERE id = ?");
    for (const r of rows) if (notPerfume(r.name) || /\b(kit|combo|hair mist)\b/i.test(r.name)) skip.run(r.id);
    rows = rows.filter((r) => !notPerfume(r.name) && !/\b(kit|combo|hair mist)\b/i.test(r.name)).slice(0, max);
    // todas as buscas da rodada numa execução só do robô
    const list = rows.map((r) => ({ id: r.id, q: core(r.name).join(" ") })).filter((x) => x.q);
    let found = new Map<string, Hit[]>();
    if (list.length) {
      for (const x of list) fragNow().names.add(x.id);
      try {
        found = await searchBatch(list);
      } catch (e) {
        log("warn", `Fragrantica: ${(e as Error).message}`);
        for (const x of list) fragNow().names.delete(x.id);
        return;
      }
    }
    const res = await Promise.all(
      list.map((x) =>
        standardize(x.id, found.get(x.q) || [])
          .catch((e) => (log("warn", `Fragrantica: ${(e as Error).message}`), ""))
          .finally(() => fragNow().names.delete(x.id)),
      ),
    );
    const changed = res.filter((n) => n && n !== "não achei" && n !== "nome vazio").length;
    // mesma página do Fragrantica já lida por outro cadastro (outro ml): copia, não paga de novo
    db().prepare(
      `UPDATE products SET frag_data = (SELECT p2.frag_data FROM products p2 WHERE p2.frag_url = products.frag_url AND p2.frag_data IS NOT NULL LIMIT 1)
       WHERE frag_data IS NULL AND frag_url IS NOT NULL AND EXISTS (SELECT 1 FROM products p2 WHERE p2.frag_url = products.frag_url AND p2.frag_data IS NOT NULL)`,
    ).run();
    db().prepare(
      `UPDATE products SET fragram_at = datetime('now') WHERE fragram_at IS NULL AND frag_url IS NOT NULL
       AND (EXISTS (SELECT 1 FROM products p2 WHERE p2.frag_url = products.frag_url AND p2.fragram_at IS NOT NULL) OR EXISTS (SELECT 1 FROM frag_photos f WHERE f.frag_url = products.frag_url))`,
    ).run();
    // a ficha (notas, acordes) não vai no post: não é puxada sozinha (Arthur, 17/nov)
    // fotos do Fragrantica: só da página do perfume que está esperando foto para postar
    const gram = db()
      .prepare(`SELECT MIN(p.id) id FROM products p WHERE ${WAITING} AND p.frag_url IS NOT NULL AND p.fragram_at IS NULL GROUP BY p.frag_url LIMIT 5`)
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
