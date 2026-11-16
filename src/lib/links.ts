/** Utilitários de URL: extração, detecção de links do Mercado Livre e resolução de redirecionamentos. */

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+|\b(?:www\.)?(?:meli\.la|mercadolivre\.com(?:\.br)?|mercadolibre\.com|produto\.mercadolivre\.com\.br|amzn\.to|s\.shopee\.com\.br|shopee\.com\.br)\/[^\s<>"'`]+/gi;

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) || [];
  return [...new Set(found.map((u) => u.replace(/[).,;:!?*_~]+$/, "")))];
}

export function normalizeUrl(u: string) {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

export function isMeliUrl(u: string): boolean {
  try {
    const h = new URL(normalizeUrl(u)).hostname.toLowerCase();
    return (
      h === "meli.la" ||
      h.endsWith(".meli.la") ||
      /(^|\.)mercadolivre\.com(\.br)?$/.test(h) ||
      /(^|\.)mercadolibre\.com(\.[a-z]{2})?$/.test(h) ||
      /(^|\.)mercadolivre\.com\.br$/.test(h)
    );
  } catch {
    return false;
  }
}

/** Segue redirecionamentos (até 8 saltos) e devolve a URL final. */
export async function resolveRedirects(url: string, timeoutMs = 10000): Promise<string> {
  let current = normalizeUrl(url);
  for (let i = 0; i < 8; i++) {
    const ctrl = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", headers: { "user-agent": UA }, signal: ctrl });
    } catch {
      return current;
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return current;
  }
  return current;
}

/** Procura um ID de produto/catálogo MLB numa URL ou num HTML. */
export function findMeliId(s: string): { id: string; kind: "item" | "catalog" } | null {
  const catalog = s.match(/\/p\/(MLB\d{6,})/i);
  if (catalog) return { id: catalog[1].toUpperCase(), kind: "catalog" };
  const item = s.match(/\b(MLB)-?(\d{6,})\b/i);
  if (item) return { id: `MLB${item[2]}`, kind: "item" };
  return null;
}

export function canonicalMeliUrl(ref: { id: string; kind: "item" | "catalog" }) {
  return ref.kind === "catalog"
    ? `https://www.mercadolivre.com.br/p/${ref.id}`
    : `https://produto.mercadolivre.com.br/MLB-${ref.id.replace(/^MLB/i, "")}`;
}

export async function fetchHtml(url: string, timeoutMs = 12000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, "accept-language": "pt-BR,pt;q=0.9" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await res.text();
  } catch {
    return "";
  }
}

export function findOgImage(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m ? m[1] : null;
}

export function findOgTitle(html: string): string | null {
  const m =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  return m ? decodeEntities(m[1]) : null;
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
