/**
 * Identifica o mesmo perfume escrito de jeitos diferentes em grupos diferentes.
 * Ex: "Perfume Jean Paul Gaultier Le Male Elixir Parfum 75 ml Masculino" = "JPG Le Male Elixir Parfum 75ml".
 * Regra: mesmo volume (ml), mesma concentração (quando as duas informam) e os mesmos nomes de linha,
 * ignorando marca e palavras genéricas.
 */

export type PerfumeInfo = {
  ml: number;
  /** edp | edt | parfum | extrait | colonia | null */
  conc: string | null;
  /** palavras do nome da linha (sem marca e sem palavras genéricas), ordenadas */
  tokens: string[];
  /** chave estável: "bottled night|100|edt" */
  key: string;
};

export const BRAND_WORDS = new Set(
  `emporio lattafa rasasi armaf wataniah lipx boticario natura hugo boss jean paul gaultier jpg azzaro calvin klein ck
  ysl yves saint laurent rabanne paco armani giorgio versace ralph lauren carolina herrera ch french avenue khadlaj
  maison alhambra afnan bidaya mawwal dior chanel prada montblanc mont blanc ferrari antonio banderas givenchy lancome
  kenzo issey miyake diesel dolce gabbana tommy hilfiger lacoste nautica ellis eudora avon jequiti zara mancera
  orientica emper fragrance world fragrances perfume lab ard zaafaran zimaya riiffs nusuk asdaaf ahmed maghribi
  swiss arabian ajmal jacques bogart nina ricci benetton shakira`.split(/\s+/).filter(Boolean),
);

export const STOP = new Set(
  `perfume perfumes eau de du des la le_ toilette parfum edp edt edc extrait colonia colonias desodorante deo
  masculino masculina feminino feminina unissex unisex original originais arabe arabes importado importada lacrado
  refil refillable recarregavel spray natural vaporisateur vapo o a e and com para por no na em men man homme
  pour femme woman women for al el ml lacrada caixa selo novo nova contratipo inspiracao`.split(/\s+/).filter(Boolean),
);

/**
 * Palavras de anúncio que os grupos colam no nome e não são do perfume (agente de nomes, Arthur 17/nov):
 * "Masculino Rasasi Hawas Black 100 ml Amadeirado Oriental", "Arabe Vulcan Feu EDP 100ML Unisex com NF",
 * "Veoquiero French Avenue Royal Blend" (loja). Saem do nome na comparação e na busca do Fragrantica.
 */
export const NOISE = new Set(
  `frasco spray vaporizador vapo lacrado lacrada original originais importado importada novo nova oficial lancamento unidade
  volume masculino masculina feminino feminina unissex unisex perfume perfumes arabe arabes nf nota fiscal com
  amadeirado amadeirada oriental floral frutado frutada citrico citrica aromatico aromatica especiado especiada adocicado
  adocicada almiscarado almiscarada ambarado ambarada gourmand fougere chipre aquatico aquatica olfativo familia
  pronta entrega envio imediato produto caixa selo garantia autentico veoquiero promocao oferta kit? da do`
    .split(/\s+/)
    .filter((w) => w && !w.endsWith("?")),
);

/** Linha da Natura/Boticário sem "Homem" no título do grupo ("Identidad" = "Homem Identidad"). */
const OPTIONAL = new Set(["homem", "mulher"]);

function fuzzyJaccard(a: string[], b: string[]) {
  const A = [...new Set(a)], B = [...new Set(b)];
  let inter = 0;
  const used = new Set<number>();
  for (const x of A) {
    let j = B.findIndex((y, k) => !used.has(k) && y === x);
    // erro de digitação ("Hawass" = "Hawas"): só palavra comprida e sem número
    if (j < 0 && x.length >= 5 && !/\d/.test(x)) j = B.findIndex((y, k) => !used.has(k) && y.length >= 5 && !/\d/.test(y) && x[0] === y[0] && dist(x, y) <= 1);
    if (j >= 0) (used.add(j), inter++);
  }
  return inter / (A.length + B.length - inter);
}

export function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Palavras do nome (sem marca, sem genéricas, sem volume). Serve para nomes sem "ml", como os do ranking de vendas. */
/** distância de edição (com troca de letras vizinhas) */
export function dist(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

const brandCache = new Map<string, boolean>();
/** Marca, mesmo escrita errada pelos grupos ("Lataffa", "Latafa", "Armaff"). */
export function isBrand(t: string): boolean {
  if (BRAND_WORDS.has(t)) return true;
  if (t.length < 5) return false;
  let r = brandCache.get(t);
  if (r === undefined) {
    r = false;
    for (const b of BRAND_WORDS) {
      if (b.length < 5 || b[0] !== t[0] || Math.abs(b.length - t.length) > 2) continue;
      if (dist(t, b) <= (Math.min(b.length, t.length) >= 7 ? 2 : 1)) { r = true; break; }
    }
    brandCache.set(t, r);
  }
  return r;
}

export function nameTokens(title: string): string[] {
  return [
    ...new Set(
      norm(title)
        .replace(/\b\d{2,4}\s*ml\b/g, " ")
        .split(" ")
        .filter((t) => t && !/^\d+$/.test(t) && !STOP.has(t) && !isBrand(t)),
    ),
  ].sort();
}

export function tokenSimilarity(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  return jaccard(a, b);
}

export function perfumeInfo(title: string): PerfumeInfo | null {
  const n = norm(title);
  const mlm = n.match(/\b(\d{2,4})\s*ml\b/);
  if (!mlm) return null;
  const ml = Number(mlm[1]);

  let conc: string | null = null;
  if (/\beau de parfum\b|\bedp\b/.test(n)) conc = "edp";
  else if (/\beau de toilette\b|\bedt\b/.test(n)) conc = "edt";
  else if (/\bextrait\b/.test(n)) conc = "extrait";
  else if (/\bdeo[\s-]*parfum\b/.test(n)) conc = "deo";
  else if (/\bparfum\b/.test(n)) conc = "parfum";
  else if (/\b(colonia|edc|eau de cologne)\b/.test(n)) conc = "colonia";
  // Natura/Boticário chamam o "Deo Parfum" só de "Parfum" nos grupos: é a mesma coisa
  if (conc === "parfum" && perfumeOrigin(title) === "nacional") conc = "deo";

  const tokens = [
    ...new Set(
      n
        .replace(/\b\d{2,4}\s*ml\b/g, " ")
        .split(" ")
        .filter((t) => t && !STOP.has(t) && !NOISE.has(t) && !isBrand(t)),
    ),
  ].sort();
  if (!tokens.length) return null;
  return { ml, conc, tokens, key: `${tokens.join(" ")}|${ml}|${conc || ""}` };
}

function jaccard(a: string[], b: string[]) {
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function samePerfume(a: PerfumeInfo, b: PerfumeInfo) {
  if (a.ml !== b.ml) return false;
  // "Parfum" é outro produto (212 Men ≠ 212 Men Parfum), mesmo quando o outro título não diz a concentração
  // Exceção: linha que só existe em Parfum (1 Million Royal, Le Male Elixir Absolu), quando o outro título não diz a concentração.
  if ((a.conc === "parfum") !== (b.conc === "parfum")) {
    const other = a.conc === "parfum" ? b : a;
    if (other.conc || !FLANKERS.some((f) => a.tokens.includes(f) && b.tokens.includes(f))) return false;
  }
  if (a.conc && b.conc && a.conc !== b.conc) {
    // "Colônia" e "EDT" são usados como sinônimos em nacionais (Boticário/Natura)
    const loose = new Set(["colonia", "edt"]);
    if (!(loose.has(a.conc) && loose.has(b.conc))) return false;
  }
  // palavras que mudam o perfume (212 Men ≠ 212 VIP Wins, Sauvage ≠ Sauvage Elixir): têm que bater dos dois lados
  const ta = new Set(a.tokens), tb = new Set(b.tokens);
  for (const f of FLANKERS) if (ta.has(f) !== tb.has(f)) return false;
  if (jaccard(a.tokens, b.tokens) >= 0.75 || fuzzyJaccard(a.tokens, b.tokens) >= 0.75) return true;
  // "Identidad" = "Homem Identidad": sem as palavras opcionais, tem que bater inteiro
  const ca = a.tokens.filter((t) => !OPTIONAL.has(t)), cb = b.tokens.filter((t) => !OPTIONAL.has(t));
  return ca.length > 0 && cb.length > 0 && (ca.length !== a.tokens.length || cb.length !== b.tokens.length) && fuzzyJaccard(ca, cb) === 1;
}

export const FLANKERS = [
  "vip", "wins", "heroes", "black", "white", "gold", "silver", "rose", "red", "blue", "noir", "night", "nyc", "sexy",
  "elixir", "intense", "intensely", "absolu", "absolute", "extreme", "sport", "fresh", "aqua", "legend", "royal", "lucky",
  "party", "kiss", "privee", "oud", "tobacco", "leather", "fusion", "pure", "platinum", "onyx", "ruby", "sapphire", "bourbon",
  "ice", "cool", "wild", "lover", "addict", "bloom", "collector", "edition", "limited", "summer", "winter", "candy",
];


/* ------------------------------------------------------------------ */
/* Origem: árabe, importado ou nacional                                 */
/* ------------------------------------------------------------------ */

export type Origin = "arabe" | "importado" | "nacional";

// marcas e linhas conhecidas (frases separadas por vírgula, comparadas sem acento)
const ARABE = `lattafa, rasasi, armaf, al wataniah, wataniah, maison alhambra, afnan, french avenue, fragrance world, khadlaj,
zimaya, riiffs, orientica, emper, ard al zaafaran, asdaaf, nusuk, swiss arabian, ajmal, al haramain, ahmed al maghribi, mawwal,
paris corner, arabiyat, khamrah, asad, yara, club de nuit, fakhar, badee al oud, hawas, odyssey, 9pm, qaed al fursan,
ameerat al arab, sheikh al shuyukh, ana abiyedh, attar al wesal, shaghaf, bharara, al noble, noble safeer, fahad, oud, arabe, arabes`;
const IMPORTADO = `dior, chanel, yves saint laurent, ysl, paco rabanne, rabanne, giorgio armani, armani, versace, carolina herrera,
jean paul gaultier, jpg, azzaro, calvin klein, hugo boss, prada, montblanc, mont blanc, givenchy, lancome, kenzo, issey miyake,
diesel, dolce gabbana, tommy hilfiger, lacoste, nautica, ferrari, antonio banderas, mancera, montale, creed, tom ford, valentino,
burberry, gucci, bvlgari, mugler, nina ricci, benetton, shakira, jacques bogart, ralph lauren, ellis, 212, good girl, sauvage,
bleu de chanel, one million, 1 million, invictus, stronger with you, acqua di gio, la vie est belle, le male, boss bottled,
ck one, olympea, phantom, idole, importado, importados`;
const NACIONAL = `boticario, natura, eudora, avon, jequiti, quem disse berenice, granado, phebo, mahogany, lacqua di fiori, ciclo,
malbec, egeo, lily, kaiak, floratta, quasar, zaad, uomini, arbo, glamour, nativa spa, biografia, ekos, portinari, make b,
connexion, thaty, wepink, vult, phytoderm, fiorucci, hinode, mary kay, contratipo, inspiracao, inspirado`;

const toRe = (list: string) =>
  new RegExp(`\\b(${list.split(",").map((w) => norm(w)).filter(Boolean).join("|")})\\b`);
const ARABE_RE = toRe(ARABE);
const IMPORTADO_RE = toRe(IMPORTADO);
const NACIONAL_RE = toRe(NACIONAL);

/** Classifica pelo nome e pelo texto da oferta. null = não deu para saber. */
export function perfumeOrigin(text: string): Origin | null {
  const n = norm(text);
  if (NACIONAL_RE.test(n)) return "nacional";
  if (ARABE_RE.test(n)) return "arabe";
  if (IMPORTADO_RE.test(n)) return "importado";
  return null;
}

const GENERIC_BRAND = new Set(["perfume", "lab", "fragrance", "fragrances", "world", "ard", "ch", "ck", "jpg"]);

/**
 * Nota do nome para exibição: queremos o nome completo como os grupos escrevem
 * (marca + linha + concentração + ml), ex: "O Boticário Clash 100ml", não só "Clash 100ml".
 */
export function nameQuality(title: string): number {
  const n = norm(title);
  const words = n.split(" ");
  const brand = words.some((w) => BRAND_WORDS.has(w) && !GENERIC_BRAND.has(w)) || perfumeOrigin(title) !== null;
  let q = 0;
  if (brand) q += 40;
  if (/\b(eau de parfum|eau de toilette|edp|edt|parfum|extrait|colonia|elixir|intense)\b/.test(n)) q += 10;
  if (/\b\d{2,4}\s*ml\b/.test(n)) q += 10;
  const len = title.length;
  if (len > 70) q -= (len - 70) * 0.8; // título de anúncio enorme
  if (len < 12) q -= 10;
  if (/[\u{1F300}-\u{1FAFF}]/u.test(title)) q -= 15;
  q += Math.min(10, words.length); // um pouco mais de informação ajuda
  return q;
}


/**
 * Regra do Arthur: o grupo é só de perfume. Body splash, creme, loção, hidratante, sabonete, desodorante
 * (aerossol/roll-on) etc. ficam de fora. "Deo parfum" e "deo colônia" são perfume e passam.
 */
export function notPerfume(text: string): string | null {
  const n = norm(text);
  const m = n.match(
    /\b(body (splash|mist|lotion|cream|wash)|splash|locao|hidratante|creme|cream|lotion|sabonete|shampoo|condicionador|gel de banho|shower gel|oleo corporal|desodorante (aerosol|antitranspirante|roll on|rollon|stick)|antitranspirante|roll on|pos barba|after shave|aftershave|balm|batom|esmalte|maquiagem|base liquida|protetor solar|talco|creme de barbear|espuma de barbear)\b/,
  );
  return m ? m[0] : null;
}
