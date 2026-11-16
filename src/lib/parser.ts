/** Extração heurística dos campos de uma mensagem de promoção. */

export const DEFAULT_TEMPLATE = `🔥 *{titulo}*

~De R$ {preco_antigo}~
💰 *Por R$ {preco}* {desconto?}
🎟️ Cupom: *{cupom}*
🚚 {frete}

🛒 *Compre aqui:* {link}

⚠️ _Preço e estoque podem mudar a qualquer momento._`;


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
    .replace(/^[\s\p{Extended_Pictographic}️‍•\-–—>:|]+/u, "")
    .replace(/[\s\p{Extended_Pictographic}️‍]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

const NOISE =
  /(https?:\/\/|www\.|meli\.la|R\$|cupom|frete|parcel|sem juros|\bx\s*de\b|link|compre|clique|aproveite|corre|promo(ção|cao)?\s*(rel[aâ]mpago)?$|oferta\s*(rel[aâ]mpago)?$|achadinho|^de\s|^por\s|grupo|entre no|chama|vendido por|estoque|pre[çc]o pode)/i;

export function parsePromo(text: string): Omit<PromoData, "link" | "links" | "texto" | "grupo_origem" | "loja"> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // ---- preços
  let preco = NaN;
  let precoAntigo = NaN;
  const all: number[] = [];
  for (const raw of lines) {
    const line = raw.toLowerCase();
    const matches = [...raw.matchAll(PRICE_RE)].map((m) => parsePrice(m[1])).filter((n) => n > 0);
    if (!matches.length) continue;
    if (/parcel|\d+\s*x\s*(de)?\s*r\$/i.test(raw)) continue; // ignora parcelas
    all.push(...matches);
    const struck = /~[^~]*R\$[^~]*~/.test(raw);
    if (struck || /(^|\s)(de|era|antes)[:\s]/.test(line) || /pre[çc]o\s*(antigo|original|normal)/.test(line)) {
      if (matches.length >= 2) {
        precoAntigo = matches[0];
        preco = matches[1];
      } else precoAntigo = matches[0];
    } else if (/(^|\s)(por|apenas|agora|só|hoje)[:\s]|pre[çc]o/.test(line) || /💰|🔥|✅/.test(raw)) {
      if (Number.isNaN(preco)) preco = matches[matches.length - 1];
    }
  }
  if (Number.isNaN(preco) && all.length) {
    const sorted = [...new Set(all)].sort((a, b) => a - b);
    preco = sorted[0];
    if (Number.isNaN(precoAntigo) && sorted.length > 1) precoAntigo = sorted[sorted.length - 1];
  }
  if (!Number.isNaN(precoAntigo) && !Number.isNaN(preco) && precoAntigo <= preco) precoAntigo = NaN;

  let desconto = "";
  const pct = text.match(/(\d{1,2})\s*%\s*(off|de desconto|desc)/i);
  if (!Number.isNaN(precoAntigo) && !Number.isNaN(preco)) {
    desconto = `(-${Math.round((1 - preco / precoAntigo) * 100)}%)`;
  } else if (pct) desconto = `(-${pct[1]}%)`;

  // ---- cupom
  let cupom = "";
  const cm =
    text.match(/cupom(?:\s+de\s+desconto)?\s*[:\-–]?\s*[*_`"']*([A-Z0-9][A-Z0-9_-]{2,24})/i) ||
    text.match(/(?:use|c[óo]digo)\s*[:\-–]?\s*[*_`"']*([A-Z0-9][A-Z0-9_-]{3,24})/i);
  if (cm && !/^(de|do|da|no|na|para|off|desconto|aplicado|automatico|automático)$/i.test(cm[1])) {
    cupom = cm[1].toUpperCase();
  }

  // ---- frete
  let frete = "";
  if (/frete\s*gr[áa]tis/i.test(text)) frete = "Frete grátis";
  if (/\bfull\b/i.test(text)) frete = frete ? `${frete} (Full)` : "Envio Full";

  // ---- parcelamento
  let parcelamento = "";
  const pm = text.match(/(\d{1,2})\s*x\s*(?:de\s*)?R\$\s*([\d.]+,\d{2})\s*(sem juros)?/i);
  if (pm) parcelamento = `${pm[1]}x de R$ ${pm[2]}${pm[3] ? " sem juros" : ""}`;

  // ---- título: primeira linha "de conteúdo"
  let titulo = "";
  for (const raw of lines) {
    const c = clean(raw.replace(/\bhttps?:\/\/\S+/gi, "").replace(/R\$\s*[\d.,]+/gi, ""));
    if (c.length < 6) continue;
    if (NOISE.test(c)) continue;
    if (/^\d+([.,]\d+)?%?$/.test(c)) continue;
    titulo = c;
    break;
  }

  return {
    titulo,
    preco: Number.isNaN(preco) ? "" : formatPrice(preco),
    preco_antigo: Number.isNaN(precoAntigo) ? "" : formatPrice(precoAntigo),
    desconto,
    cupom,
    frete,
    parcelamento,
  };
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
