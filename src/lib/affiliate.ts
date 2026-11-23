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
      // Arthur (23/nov): a página /social/ do afiliado mostra o produto do link no 1º card e, depois, recomendações.
      // O 1º "/p/MLB" do HTML era uma recomendação (Nautica Voyage, secador...): o post saía com o link de outro produto.
      if (!ref && /\/social\//.test(resolved)) {
        ref = socialItem(html);
        if (!ref) {
          result.error = "Página de afiliado sem o produto em destaque: não dá para saber qual é o produto do link.";
          return result;
        }
      }
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

    // com cookie da sessão: link curto oficial (meli.la); se falhar, cai para etiqueta + encurtador
    if (s.meliCookie || s.meliStrategy === "generator") {
      try {
        result.affiliateUrl = await generatorLink(result.canonical, s);
        console.log(`[afiliados] Link meli.la gerado: ${result.affiliateUrl}`);
        result.ok = true;
        return result;
      } catch (e) {
        if (!s.meliTag) throw e;
        result.error = `meli.la indisponível (${(e as Error).message.slice(0, 120)}), usei o link com etiqueta`;
        console.warn(`[afiliados] Gerador meli.la falhou: ${(e as Error).message.slice(0, 300)}`);
      }
    }
    const longUrl = paramsLink(result.canonical, s);
    result.affiliateUrl = await shorten(longUrl, s.shortener === "none" ? { ...s, shortener: "tinyurl" } : s);
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

/**
 * Descobre a etiqueta (matt_word) e o matt_tool a partir de um link de afiliado seu (ex: meli.la/xxxx),
 * seguindo os redirecionamentos e, se precisar, lendo o HTML da página final.
 */
export async function learnFromSampleLink(url: string): Promise<{ tag: string; tool: string; trail: string[] }> {
  const trail: string[] = [];
  let current = normalizeUrl(url);
  let html = "";
  for (let i = 0; i < 10; i++) {
    trail.push(current);
    const res = await fetch(current, { redirect: "manual", headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    html = await res.text().catch(() => "");
    break;
  }
  const find = (k: string) => {
    for (const u of trail) {
      try {
        const v = new URL(u).searchParams.get(k);
        if (v) return v;
      } catch {
        /* ignora */
      }
    }
    const m = html.match(new RegExp(`${k}(?:=|\\\\u003d|%3D|"\\s*:\\s*")([A-Za-z0-9_.-]+)`));
    return m ? m[1] : "";
  };
  return { tag: find("matt_word"), tool: find("matt_tool"), trail };
}

/** Produto em destaque na página /social/ do afiliado: o 1º card ("polycards") traz o id do anúncio. */
export function socialItem(html: string): { id: string; kind: "item" | "catalog" } | null {
  // sem o produto no título da página (perfil sem destaque, página de bloqueio): não chuta
  if (!/<meta name="title" content="[^"]+"/.test(html)) return null;
  const m = html.match(/"polycards":\[\{[^\]]{0,400}?"metadata":\{"id":"(MLB\d{6,})"/);
  return m ? { id: m[1], kind: "item" } : null;
}
