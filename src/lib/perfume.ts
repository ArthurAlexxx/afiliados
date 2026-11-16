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
