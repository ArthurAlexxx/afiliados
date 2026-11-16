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

const BRAND_WORDS = new Set(
  `lattafa rasasi armaf wataniah lipx boticario natura hugo boss jean paul gaultier jpg azzaro calvin klein ck
  ysl yves saint laurent rabanne paco armani giorgio versace ralph lauren carolina herrera ch french avenue khadlaj
  maison alhambra afnan bidaya mawwal dior chanel prada montblanc mont blanc ferrari antonio banderas givenchy lancome
  kenzo issey miyake diesel dolce gabbana tommy hilfiger lacoste nautica ellis eudora avon jequiti zara mancera
  orientica emper fragrance world fragrances perfume lab ard zaafaran zimaya riiffs nusuk asdaaf ahmed maghribi
  swiss arabian ajmal jacques bogart nina ricci benetton shakira`.split(/\s+/).filter(Boolean),
);

const STOP = new Set(
  `perfume perfumes eau de du des la le_ toilette parfum edp edt edc extrait colonia colonias desodorante deo
  masculino masculina feminino feminina unissex unisex original originais arabe arabes importado importada lacrado
  refil refillable recarregavel spray natural vaporisateur vapo o a e and com para por no na em men man homme
  pour femme woman women al el ml lacrada caixa selo novo nova contratipo inspiracao`.split(/\s+/).filter(Boolean),
);

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Palavras do nome (sem marca, sem genéricas, sem volume). Serve para nomes sem "ml", como os do ranking de vendas. */
export function nameTokens(title: string): string[] {
  return [
    ...new Set(
      norm(title)
        .replace(/\b\d{2,4}\s*ml\b/g, " ")
        .split(" ")
        .filter((t) => t && !/^\d+$/.test(t) && !STOP.has(t) && !BRAND_WORDS.has(t)),
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
  else if (/\bparfum\b/.test(n)) conc = "parfum";
  else if (/\b(colonia|edc|eau de cologne)\b/.test(n)) conc = "colonia";

  const tokens = [
    ...new Set(
      n
        .replace(/\b\d{2,4}\s*ml\b/g, " ")
        .split(" ")
        .filter((t) => t && !STOP.has(t) && !BRAND_WORDS.has(t)),
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
  if (a.conc && b.conc && a.conc !== b.conc) {
    // "Colônia" e "EDT" são usados como sinônimos em nacionais (Boticário/Natura)
    const loose = new Set(["colonia", "edt"]);
    if (!(loose.has(a.conc) && loose.has(b.conc))) return false;
  }
  return jaccard(a.tokens, b.tokens) >= 0.75;
}


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
