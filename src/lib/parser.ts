/** Extração heurística dos campos de uma mensagem de promoção. */

export const DEFAULT_TEMPLATE = `{manchete}

*{titulo}*

❌ ~DE: R\${preco_antigo}~
✅ POR: R\${preco} {frete_tag?}

🏷️ Cupom: \`{cupom}\` ✅

🛒 LOJA: *{loja_nome}*

📎 LINK DO PRODUTO ➡️
{link}`;

/** Modelos padrão antigos: quem ainda usa um deles passa para o novo automaticamente. */
export const OLD_DEFAULT_TEMPLATES = [
  `🏆 *{historico}*
📉 *Baixou {desconto_pct}%*

*{titulo}*

❌ ~DE: R\${preco_antigo}~
✅ POR: R\${preco} {frete_tag?}

🏷️ Cupom: \`{cupom}\` ✅

🛒 LOJA: *{loja_nome}*

📎 LINK DO PRODUTO ➡️
{link}`,
  `📉 *Baixou {desconto_pct}%*

*{titulo}*

❌ ~DE: R\${preco_antigo}~
✅ POR: R\${preco} {frete_tag?}

🏷️ Cupom: \`{cupom}\` ✅

🛒 LOJA: *{loja_nome}*

📎 LINK DO PRODUTO ➡️
{link}`,
  `📉 *BAIXOU {desconto_pct}%* · R$ {economia} a menos

✨ *{titulo}*

De ~R$ {preco_antigo}~
💰 Por *R$ {preco}*
🎟️ Cupom: *{cupom}*
✅ {loja_info}

🛒 {link}`,
];

export type PromoData = {
  titulo: string;
  preco: string;
  preco_antigo: string;
  desconto: string;
  cupom: string;
  frete: string;
  parcelamento: string;
  link: string;
  links: string;
  texto: string;
  grupo_origem: string;
  loja: string;
  desconto_pct: string;
  economia: string;
  loja_info: string;
  loja_nome: string;
  frete_tag: string;
  historico: string;
  /** 1ª linha do post (vai na notificação): selo de menor preço + "Baixou N%" */
  manchete: string;
};

export const TEMPLATE_VARS: { key: keyof PromoData; label: string }[] = [
  { key: "titulo", label: "Título do produto" },
  { key: "preco", label: "Preço atual" },
  { key: "preco_antigo", label: "Preço antigo" },
  { key: "desconto", label: "Desconto, ex: (-25%)" },
  { key: "cupom", label: "Cupom" },
  { key: "frete", label: "Frete grátis / Full" },
  { key: "parcelamento", label: "Parcelamento" },
  { key: "link", label: "Seu link de afiliado (encurtado)" },
  { key: "links", label: "Todos os seus links, um por linha" },
  { key: "texto", label: "Texto original com links trocados" },
  { key: "grupo_origem", label: "Nome do grupo de origem" },
  { key: "loja", label: "Loja (Mercado Livre)" },
  { key: "desconto_pct", label: "Só o número do desconto, ex: 40" },
  { key: "economia", label: "Quanto baixou em R$, ex: 131,00" },
  { key: "loja_info", label: "Loja oficial X / Vendido por X" },
  { key: "loja_nome", label: "Só o nome da loja" },
  { key: "frete_tag", label: "(frete grátis) quando tiver" },
  { key: "historico", label: "Selo de menor preço (30 dias) quando for" },
  { key: "manchete", label: "1ª linha: 🏆 selo · Baixou N% (ou só 📉 Baixou N%)" },
];

const PRICE_RE = /R\$\s*([\d.]+(?:,\d{1,2})?)/gi;

export function parsePrice(s: string): number {
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export function formatPrice(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function clean(line: string) {
  return line
    .replace(/[*_~`]/g, "")
    .replace(/^[\s\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️‍•\-–—>:|]+/u, "")
    .replace(/[\s\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️‍]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

const NOISE =
  /(https?:\/\/|www\.|meli\.la|R\$|cupom|frete|parcel|sem juros|\bx\s*de\b|link|compre|clique|aproveite|corre|promo(ção|cao)?\s*(rel[aâ]mpago)?$|oferta\s*(rel[aâ]mpago)?$|achadinho|^de\s|^por\s|^de:|^por:|grupo|entre no|entre em|chama|vendido por|selecione a loja|^loja\b|estoque|pre[çc]o pode|baixou\s*\d|v[íi]deo review)/i;

/** Linha "gancho" em CAPS (ex: "*OS ÁRABES NÃO SABEM BRINCAR*"): não é título nem preço. */
export function isHookLine(raw: string) {
  const c = clean(raw);
  const letters = c.replace(/[^\p{L}]/gu, "");
  if (letters.length < 6) return false;
  if (/\d+\s*ml\b/i.test(c)) return false;
  return letters === letters.toUpperCase() && /\p{Lu}/u.test(letters);
}

/** Número em formato brasileiro ("1.234,56", "750", "634,23"). */
const NUM = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)`;
const DE_RE = new RegExp(String.raw`(?:^|[^A-Za-zÀ-ÿ0-9])(?:de|era|antes)\s*:?\s*[~*_\s]*(?:R\$)?\s*[~*_\s]*` + NUM, "i");
const POR_RE = new RegExp(String.raw`(?:^|[^A-Za-zÀ-ÿ0-9])(?:por|apenas|agora|s[óo]|hoje)\s*(?:apenas)?\s*:?\s*[~*_\s]*(?:R\$)?\s*[~*_\s]*` + NUM, "i");

export type ParsedPromo = Omit<PromoData, "link" | "links" | "texto" | "grupo_origem" | "loja" | "desconto_pct" | "economia" | "loja_info" | "loja_nome" | "frete_tag" | "historico" | "manchete"> & {
  desconto_pct: string;
  economia: string;
  loja_info: string;
  loja_nome: string;
  frete_tag: string;
  /** preços numéricos (NaN quando não achou) */
  precoNum: number;
  precoAntigoNum: number;
  /** % informado pelo grupo ("Baixou 29%") ou calculado De→Por */
  descontoPct: number | null;
  /** post só de cupom/aviso, sem produto */
  cupomOnly: boolean;
  loja_vendedor: string;
};

export function parsePromo(text: string): ParsedPromo {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // ---- preços
  let preco = NaN;
  let precoAntigo = NaN;
  const all: number[] = [];
  for (const raw of lines) {
    if (isHookLine(raw)) continue; // "MENOS DE 80 CONTO" não é preço
    if (/parcel|\d+\s*x\s*(de)?\s*R\$/i.test(raw) && !/\bpor\b/i.test(raw)) continue; // parcelas
    const plain = raw.replace(/[*_`]/g, "");
    const de = plain.match(DE_RE);
    const por = plain.match(POR_RE);
    if (de && Number.isNaN(precoAntigo)) precoAntigo = parsePrice(de[1]);
    if (por && Number.isNaN(preco)) preco = parsePrice(por[1]);
    const matches = [...plain.matchAll(PRICE_RE)].map((m) => parsePrice(m[1])).filter((n) => n > 0);
    if (!matches.length) continue;
    all.push(...matches);
    if (de || por) continue;
    const struck = /~[^~]*R\$[^~]*~/.test(raw);
    if (struck || /pre[çc]o\s*(antigo|original|normal)/i.test(raw)) {
      if (matches.length >= 2) {
        if (Number.isNaN(precoAntigo)) precoAntigo = matches[0];
        if (Number.isNaN(preco)) preco = matches[1];
      } else if (Number.isNaN(precoAntigo)) precoAntigo = matches[0];
    } else if (/pre[çc]o|💰|🔥|✅/i.test(raw)) {
      if (Number.isNaN(preco)) preco = matches[matches.length - 1];
    }
  }
  if (Number.isNaN(preco) && all.length) {
    const sorted = [...new Set(all)].sort((a, b) => a - b);
    preco = sorted[0];
    if (Number.isNaN(precoAntigo) && sorted.length > 1) precoAntigo = sorted[sorted.length - 1];
  }
  if (!Number.isNaN(precoAntigo) && !Number.isNaN(preco) && precoAntigo <= preco) precoAntigo = NaN;

  let descontoPct: number | null = null;
  const baixou = text.match(/baixou\s*(\d{1,2})\s*%/i);
  const pct = text.match(/(\d{1,2})\s*%\s*(off|de desconto|desc)/i);
  if (baixou) descontoPct = Number(baixou[1]);
  else if (!Number.isNaN(precoAntigo) && !Number.isNaN(preco)) descontoPct = Math.round((1 - preco / precoAntigo) * 100);
  else if (pct) descontoPct = Number(pct[1]);
  const desconto = descontoPct ? `(-${descontoPct}%)` : "";

  // ---- cupom
  let cupom = "";
  const BAD = /^(de|do|da|no|na|para|off|desconto|aplicado|automatico|automático|resgate|ative|ativar|esgotado|surpresa|hoje|pegue|use|dispon[ií]vel|link|abaixo|exclusivo)$/i;
  const cm =
    text.match(/cupom(?:\s+de\s+desconto)?\s*[:\-–]?\s*[*_`"']*([A-Z0-9][A-Z0-9_-]{2,24})[*_`"']*/i) ||
    text.match(/(?:use|c[óo]digo)\s*[:\-–]?\s*[*_`"']*([A-Z0-9][A-Z0-9_-]{3,24})/i);
  if (cm && !BAD.test(cm[1]) && /\d|^[A-Z0-9_-]+$/.test(cm[1])) cupom = cm[1].toUpperCase();

  // ---- frete
  let frete = "";
  if (/frete\s*gr[áa]tis/i.test(text)) frete = "Frete grátis";
  if (/\bfull\b/i.test(text)) frete = frete ? `${frete} (Full)` : "Envio Full";

  // ---- parcelamento
  let parcelamento = "";
  const pm = text.match(/(\d{1,2})\s*x\s*(?:de\s*)?R\$\s*([\d.]+,\d{2})\s*(sem juros)?/i);
  if (pm) parcelamento = `${pm[1]}x de R$ ${pm[2]}${pm[3] ? " sem juros" : ""}`;
  else if (/parcelado sem juros/i.test(text)) parcelamento = "Parcelado sem juros";

  // ---- título: de preferência a 1ª linha com "ml" que não é preço/cupom/link; senão a 1ª linha de conteúdo
  const candidates = lines
    .filter((raw) => !isHookLine(raw))
    .map((raw) => clean(raw.replace(/\bhttps?:\/\/\S+/gi, "").replace(/R\$\s*[\d.,]+/gi, "")))
    .filter((c) => c.length >= 6 && !NOISE.test(c) && !/^\d+([.,]\d+)?%?$/.test(c));
  const titulo = candidates.find((c) => /\d+\s*ml\b/i.test(c)) || candidates[0] || "";

  // ---- loja / vendedor
  const lm =
    text.match(/LOJA:\s*\*?([^*\n]+)\*?/i) ||
    text.match(/Selecione a loja\s*\*?([^*\n.]+)/i) ||
    text.match(/Loja Oficial\s*\*?([^*_\n]+?)\*?_?\s*(?:no (?:Mercado Livre|ML|MELI)|$)/im) ||
    text.match(/Vendido por\s*_?\*?([^*_\n(]+)/i);
  const loja_vendedor = lm ? lm[1].replace(/[*_]/g, "").trim() : "";

  const oficial = /loja\s+oficial/i.test(text);
  const nomeLoja = loja_vendedor.replace(/^loja oficial\s*/i, "").replace(/\s+no\s+(ML|MELI|Mercado Livre)!?$/i, "").trim();
  const loja_info = oficial
    ? `Loja oficial${nomeLoja && !/^(no|do)\b/i.test(nomeLoja) ? ` ${nomeLoja}` : ""}`
    : nomeLoja
      ? `Vendido por ${nomeLoja}`
      : "";
  const economia = !Number.isNaN(precoAntigo) && !Number.isNaN(preco) ? formatPrice(precoAntigo - preco) : "";

  const cupomOnly = Number.isNaN(preco) || (!/\d+\s*ml\b/i.test(text) && !POR_RE.test(text.replace(/[*_`~]/g, "")));

  return {
    titulo,
    preco: Number.isNaN(preco) ? "" : formatPrice(preco),
    preco_antigo: Number.isNaN(precoAntigo) ? "" : formatPrice(precoAntigo),
    desconto,
    cupom,
    frete,
    parcelamento,
    desconto_pct: descontoPct ? String(descontoPct) : "",
    economia,
    loja_info,
    loja_nome: /^loja\s*\d+$/i.test(nomeLoja) || /^(no|do)\b/i.test(nomeLoja) ? "" : nomeLoja,
    frete_tag: /frete\s*gr[áa]tis/i.test(text) ? "(frete grátis)" : /\bfull\b/i.test(text) ? "(Full)" : "",
    precoNum: preco,
    precoAntigoNum: precoAntigo,
    descontoPct,
    cupomOnly,
    loja_vendedor,
  };
}

/** 1ª linha do post, a que aparece na notificação do celular. */
export function manchete(d: Partial<PromoData>): string {
  const pct = (d.desconto_pct || "").trim();
  if (d.historico) return `🏆 *${d.historico}*${pct ? ` · Baixou ${pct}%` : ""}`;
  return pct ? `📉 *Baixou ${pct}%*` : "";
}

/**
 * Renderiza o template.
 * - {var}  obrigatória: se estiver vazia, a linha inteira some (ex: linha do cupom quando não há cupom).
 * - {var?} opcional: se estiver vazia, só ela some e a linha fica.
 */
export function renderTemplate(template: string, data: Partial<PromoData>): string {
  const get = (k: string) => String((data as Record<string, string>)[k] ?? "").trim();
  const out: string[] = [];
  for (const line of template.split("\n")) {
    const required = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (required.some((v) => get(v) === "")) continue;
    const optional = [...line.matchAll(/\{(\w+)\?\}/g)].map((m) => m[1]);
    if (!required.length && optional.length && optional.every((v) => get(v) === "")) continue;
    out.push(
      line
        .replace(/\{(\w+)\??\}/g, (_, k) => get(k))
        .replace(/[ \t]+$/g, ""),
    );
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
