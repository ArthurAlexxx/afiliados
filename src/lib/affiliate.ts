import type { Settings } from "./settings.ts";
import {
  UA,
  canonicalMeliUrl,
  fetchHtml,
  findMeliId,
  findOgImage,
  findOgTitle,
  normalizeUrl,
  resolveRedirects,
} from "./links.ts";

export type ConvertResult = {
  ok: boolean;
  original: string;
  resolved?: string;
  canonical?: string;
  productKey?: string;
  affiliateUrl?: string;
  image?: string | null;
  title?: string | null;
  error?: string;
};

/**
 * Converte qualquer link do Mercado Livre (inclusive links de afiliado de outras pessoas,
 * meli.la / mercadolivre.com/sec) no link de afiliado configurado, já encurtado.
 */
export async function convertMeliLink(url: string, s: Settings, opts: { wantImage?: boolean } = {}): Promise<ConvertResult> {
  const original = normalizeUrl(url);
  const result: ConvertResult = { ok: false, original };
  try {
    const resolved = await resolveRedirects(original);
    result.resolved = resolved;

    let ref = findMeliId(resolved);
    let html = "";
    // Links de afiliado (páginas /social/...) não trazem o ID na URL: procura no HTML.
    if (!ref || opts.wantImage) {
      html = await fetchHtml(resolved);
      if (!ref) ref = findMeliId(html);
    }
    if (!ref) {
      result.error = "Não encontrei o ID do produto (MLB) no link.";
      return result;
    }
    result.productKey = ref.id;
    result.canonical = canonicalMeliUrl(ref);

    if (opts.wantImage) {
      if (!html || !findOgImage(html)) html = await fetchHtml(result.canonical);
      result.image = findOgImage(html);
      result.title = findOgTitle(html);
    }

    let longUrl: string;
    if (s.meliStrategy === "generator") {
      const short = await generatorLink(result.canonical, s);
      result.affiliateUrl = short;
      result.ok = true;
      return result;
    } else {
      longUrl = paramsLink(result.canonical, s);
    }
    result.affiliateUrl = await shorten(longUrl, s);
    result.ok = true;
    return result;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return result;
  }
}

/** Estratégia "parâmetros": anexa matt_word/matt_tool (e extras) à URL limpa do produto. */
export function paramsLink(canonical: string, s: Settings) {
  const u = new URL(canonical);
  if (s.meliTag) u.searchParams.set("matt_word", s.meliTag);
  if (s.meliMattTool) u.searchParams.set("matt_tool", s.meliMattTool);
  if (s.meliExtraParams) {
    const extra = new URLSearchParams(s.meliExtraParams.replace(/^[?&]/, ""));
    extra.forEach((v, k) => u.searchParams.set(k, v));
  }
  return u.toString();
}

/**
 * Estratégia "gerador": usa o mesmo endpoint do Gerador de Links do portal de afiliados
 * (mercadolivre.com.br/afiliados), autenticado com o cookie da sua sessão.
 * Retorna o link curto oficial (meli.la / mercadolivre.com/sec).
 */
export async function generatorLink(canonical: string, s: Settings): Promise<string> {
  if (!s.meliCookie) throw new Error("Cookie do Mercado Livre não configurado (estratégia Gerador).");
  const endpoint =
    process.env.MELI_CREATE_LINK_URL ||
    "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": UA,
    origin: "https://www.mercadolivre.com.br",
    referer: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
    cookie: s.meliCookie,
  };
  if (s.meliCsrf) headers["x-csrf-token"] = s.meliCsrf;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ urls: [canonical], tag: s.meliTag || undefined }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gerador do ML respondeu ${res.status}: ${text.slice(0, 200)}`);
  }
  const short = text.match(/https?:\\?\/\\?\/(?:meli\.la|mercadolivre\.com(?:\.br)?\\?\/sec)\\?\/[A-Za-z0-9_-]+/);
  if (short) return short[0].replace(/\\\//g, "/");
  // fallback: qualquer URL que contenha a tag
  const any = text.match(/https?:\\?\/\\?\/[^"\s]+matt_word[^"\s]*/);
  if (any) return any[0].replace(/\\\//g, "/");
  throw new Error(`Resposta inesperada do gerador do ML: ${text.slice(0, 200)}`);
}

export async function shorten(url: string, s: Settings): Promise<string> {
  try {
    switch (s.shortener) {
      case "tinyurl": {
        const r = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {
          signal: AbortSignal.timeout(10000),
        });
        const t = (await r.text()).trim();
        return r.ok && t.startsWith("http") ? t : url;
      }
      case "isgd": {
        const r = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, {
          signal: AbortSignal.timeout(10000),
        });
        const t = (await r.text()).trim();
        return r.ok && t.startsWith("http") ? t : url;
      }
      case "bitly": {
        if (!s.bitlyToken) return url;
        const r = await fetch("https://api-ssl.bitly.com/v4/shorten", {
          method: "POST",
          headers: { authorization: `Bearer ${s.bitlyToken}`, "content-type": "application/json" },
          body: JSON.stringify({ long_url: url }),
          signal: AbortSignal.timeout(10000),
        });
        const j = (await r.json()) as { link?: string };
        return j.link || url;
      }
      default:
        return url;
    }
  } catch {
    return url;
  }
}
