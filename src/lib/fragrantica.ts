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

const toks = (s: string) => norm(s).split(" ").filter(Boolean);
const near = (a: string, b: string) => a === b || (a.length >= 5 && a[0] === b[0] && Math.abs(a.length - b.length) <= 2 && dist(a, b) <= (Math.min(a.length, b.length) >= 7 ? 2 : 1));
const FEM = /\b(feminino|feminina|women|woman|femme|her|pour elle)\b/;
const MASC = /\b(masculino|masculina|men|man|homme|him|pour homme)\b/;
const genderOf = (s: string) => (FEM.test(norm(s)) ? "f" : MASC.test(norm(s)) ? "m" : null);
const has = (list: string[], t: string) => list.some((x) => near(x, t));

async function search(q: string): Promise<Hit[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("falta APIFY_TOKEN");
  const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=120`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ searchQueries: [q], scrapeDetails: false, maxResults: 12 }),
    signal: AbortSignal.timeout(150_000),
  });
  if (!r.ok) throw new Error(`Apify ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as Hit[]).filter((h) => h.name && h.brand);
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
    if (brandToks.length && ourHasBrand && !brandToks.some((t) => has(ourAll, t))) continue;
    const nameToks = toks(h.name).filter((t) => !GENERIC.has(t) || VARIANT.has(t));
    const key = nameToks.filter((t) => !GENERIC.has(t));
    if (!key.length) continue;
    // todas as palavras do nome da Fragrantica têm que estar no nosso (gênero só se estiver escrito)
    const missing = nameToks.filter((t) => !has(ourAll, t) && !["men", "women", "her", "him", "femme", "homme", "le", "la"].includes(t));
    if (missing.length) continue;
    // e o nosso não pode ter uma variação que a Fragrantica não tem (Salvo ≠ Salvo Intense)
    const extraVariant = ours.filter((t) => VARIANT.has(t) && !has(nameToks, t) && !has(brandToks, t));
    if (extraVariant.length) continue;
    // a maior parte das nossas palavras explicada pela marca + nome
    const explained = ours.filter((t) => has(nameToks, t) || has(brandToks, t) || isBrand(t)).length;
    if (explained / Math.max(1, ours.length) < 0.6) continue;
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

const CONC: Record<string, string> = { edp: "EDP", edt: "EDT", extrait: "Extrait de Parfum", parfum: "Parfum", deo: "Deo Parfum", colonia: "Colônia" };

export function canonicalName(h: Hit, ml: number, conc: string | null) {
  const brand = h.brand.replace(/\s+(Perfumes|Parfums|Fragrances|Paris)$/i, "").trim();
  let name = h.name.trim();
  if (!norm(name).startsWith(norm(brand))) name = `${brand} ${name}`;
  const c = conc ? CONC[conc] : "";
  const already = c && norm(name).includes(norm(c).split(" ")[0]);
  return `${name}${c && !already ? ` ${c}` : ""} ${ml}ml`.replace(/\s+/g, " ").trim();
}

/** Procura um perfume na Fragrantica e, se achar com certeza, troca o nome dele pelo padrão. */
export async function standardize(productId: number): Promise<string> {
  const p = db().prepare("SELECT id, name, ml, conc FROM products WHERE id = ?").get(productId) as { id: number; name: string; ml: number; conc: string | null } | undefined;
  if (!p) return "perfume não existe";
  const q = core(p.name).join(" ");
  db().prepare("UPDATE products SET frag_checked_at = datetime('now') WHERE id = ?").run(p.id);
  if (!q) return "nome vazio";
  const hits = await search(q);
  const h = pick(p.name, hits);
  if (!h) {
    log("info", `Fragrantica: não achei com certeza "${p.name}" (${hits.slice(0, 3).map((x) => `${x.brand} ${x.name}`).join(" | ") || "nada"})`);
    return "não achei";
  }
  const name = canonicalName(h, p.ml, p.conc);
  db().prepare("UPDATE products SET frag_name = ?, frag_brand = ?, frag_url = ?, name = ? WHERE id = ?").run(h.name, h.brand, h.url, name, p.id);
  if (name !== p.name) log("info", `Fragrantica: "${p.name}" → "${name}"`);
  return name;
}

/** Fila: perfumes ainda não conferidos, os com promoção recente primeiro. Um por vez. */
export async function fragranticaStep(max = 3) {
  if (!process.env.APIFY_TOKEN || process.env.FRAGRANTICA === "0") return;
  const g = globalThis as { __fragBusy?: boolean };
  if (g.__fragBusy) return;
  g.__fragBusy = true;
  try {
    const rows = db()
      .prepare(
        `SELECT p.id FROM products p WHERE p.frag_checked_at IS NULL
         ORDER BY (SELECT MAX(o.created_at) FROM offers o WHERE o.product_id = p.id) DESC LIMIT ?`,
      )
      .all(max) as { id: number }[];
    let changed = 0;
    for (const r of rows) {
      const n = await standardize(r.id).catch((e) => (log("warn", `Fragrantica: ${(e as Error).message}`), ""));
      if (n && n !== "não achei") changed++;
    }
    if (changed) {
      const { mergeDuplicateProducts } = await import("./curation.ts");
      const m = mergeDuplicateProducts();
      if (m) log("info", `Fragrantica: ${m} repetido(s) juntado(s) pelo nome padrão`);
    }
  } finally {
    g.__fragBusy = false;
  }
}
