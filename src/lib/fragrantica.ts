/**
 * Nome padrão dos perfumes pela Fragrantica (pedido do Arthur): cada perfume do banco é procurado lá
 * e passa a se chamar "Marca Nome Concentração Xml" como na Fragrantica. Isso também junta repetidos:
 * dois cadastros que caem na mesma página da Fragrantica (com o mesmo ml) são o mesmo perfume.
 *
 * Busca pelo Apify (unfenced-group/fragrantica-perfume-scraper, só a lista da busca: ~US$ 0,003 por perfume).
 * O scraper do GitHub (jc855/fragrantica-scraper) tem a base só até 2017 e baixa direto do site, que hoje bloqueia.
 */
import { db, log } from "./db.ts";
import { apifyFail, checkApify } from "./apify.ts";
import { BRAND_WORDS, FLANKERS, STOP, dist, isBrand, norm } from "./perfume.ts";

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
  return ((await runActor({ searchQueries: [q], scrapeDetails: false, maxResults: 8 })) as unknown as Hit[]).filter((h) => h.name && h.brand);
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
async function searchGoogle(name: string): Promise<Hit[]> {
  if (!process.env.APIFY_TOKEN) return [];
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
  let h = pick(p.name, hits);
  // a busca do Fragrantica se perde com palavras de anúncio ("Armani Beauty ..."): tenta pelo Google, só páginas do Fragrantica
  if (!h) {
    const g = await searchGoogle(p.name).catch((e) => (log("warn", `Fragrantica (Google): ${(e as Error).message}`), [] as Hit[]));
    if (g.length) {
      h = pick(p.name, g);
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
         GROUP BY p.frag_url ORDER BY MAX(EXISTS (SELECT 1 FROM posts q WHERE q.product_id = p.id AND q.status = 'photo')) DESC, MAX(p.id) DESC LIMIT 5`,
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
