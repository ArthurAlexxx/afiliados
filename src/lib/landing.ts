import fs from "node:fs";
import sharp from "sharp";
import { db } from "./db.ts";
import { salesBoostFor } from "./sales.ts";

/**
 * Dados da landing page do anúncio (/grupo).
 *
 * Tudo aqui é lido do banco de verdade: o que saiu no grupo, quantos grupos o
 * robô vigia, quantas promoções ele olhou. Número escrito à mão vira mentira
 * na semana seguinte, e foto/oferta inventada na vitrine o Arthur vetou (23/11).
 */

export type Oferta = {
  id: number; // post (foto em /grupo/foto/[id])
  nome: string;
  por: number;
  de: number | null;
  pct: number | null;
  quando: string; // ISO
  texto: string; // o post exatamente como saiu no WhatsApp
  vendas: string | null; // "top 3 vendas ML" / "em alta no ML" (RadarHub)
  largura: number | null;
  altura: number | null;
};

export type DadosLanding = {
  grupos: number | null; // grupos de origem que o robô vigia
  ofertas24h: number | null; // promoções vistas nas últimas 24 h
  postsHoje: number | null;
  ofertas: Oferta[];
  /** o post do celular do topo: o Club de Nuit, o mesmo perfume do anúncio */
  destaque: Oferta | null;
};

/** Perfume do anúncio: é ele que aparece no celular do topo, quando já saiu no grupo. */
const PERFUME_DO_ANUNCIO = /club\s*de\s*nuit/i;

/** Tira a linha do cupom do texto (o Arthur pediu a vitrine sem cupom por enquanto, 23/11). */
function semCupom(texto: string) {
  return texto
    .split("\n")
    .filter((l) => !/cupom/i.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const hojeSP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const diaSP = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);

/** "1.200,00" | "1200" | 1200 → 1200 */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function contar(sql: string): number | null {
  try {
    const r = db().prepare(sql).get() as { n: number } | undefined;
    return r?.n ?? null;
  } catch {
    return null;
  }
}

/**
 * Vitrine = posts que SAÍRAM no grupo (com a foto e o texto de verdade), sem
 * nada inventado. A ordem prioriza o que mais vende no Mercado Livre segundo o
 * RadarHub (mesmo bônus que a curadoria usa), depois o maior desconto, depois o
 * mais recente. Banco sem post enviado = vitrine vazia, e a página esconde a seção.
 */
export async function dadosLanding(limite = 10): Promise<DadosLanding> {
  const grupos = contar("SELECT COUNT(*) n FROM groups WHERE role = 'source'");
  const ofertas24h = contar("SELECT COUNT(*) n FROM offers WHERE created_at >= datetime('now', '-1 day')");
  const postsHoje = contar(
    "SELECT COUNT(*) n FROM posts WHERE status = 'sent' AND date(sent_at, '-3 hours') = date('now', '-3 hours')",
  );

  const candidatas: (Oferta & { boost: number; path: string })[] = [];
  try {
    const rows = db()
      .prepare(
        `SELECT q.id, COALESCE(p.name, '') name, p.ml, q.data_json, q.formatted_text, q.media_path, q.sent_at
         FROM posts q LEFT JOIN products p ON p.id = q.product_id
         WHERE q.status = 'sent' AND q.media_path IS NOT NULL AND q.sent_at >= datetime('now', '-14 days')
         ORDER BY q.sent_at DESC LIMIT 300`,
      )
      .all() as { id: number; name: string; ml: number | null; data_json: string; formatted_text: string; media_path: string; sent_at: string }[];
    const vistos = new Set<string>();
    for (const r of rows) {
      if (!r.formatted_text?.trim() || !fs.existsSync(r.media_path)) continue;
      let j: { curation?: { bestPrice?: number; real?: { ref?: number } | null }; data?: Record<string, unknown> } = {};
      try {
        j = JSON.parse(r.data_json || "{}");
      } catch {}
      const nome = (r.name || String(j.data?.titulo || "")).trim();
      const por = num(j.curation?.bestPrice) ?? num(j.data?.preco);
      if (!nome || !por) continue;
      const chave = nome.toLowerCase();
      if (vistos.has(chave)) continue; // o mesmo perfume uma vez só, o post mais recente
      vistos.add(chave);
      let de = num(j.data?.preco_antigo);
      if (de != null && de <= por) de = null;
      const pct = de ? Math.round((1 - por / de) * 100) : num(j.data?.desconto_pct);
      let vendas: ReturnType<typeof salesBoostFor> = null;
      try {
        vendas = salesBoostFor(nome, r.ml ?? undefined);
      } catch {}
      candidatas.push({
        id: r.id, nome, por, de, pct: pct && pct >= 5 ? Math.round(pct) : null,
        quando: r.sent_at.replace(" ", "T") + "Z", texto: semCupom(r.formatted_text),
        vendas: vendas?.note ?? null, boost: vendas?.boost ?? 0, largura: null, altura: null, path: r.media_path,
      });
    }
  } catch {}

  // "As melhores promoções do dia": só o que saiu hoje; se hoje ainda tem pouco
  // (madrugada), completa com as 48 h anteriores.
  const hoje = hojeSP();
  const doDia = candidatas.filter((c) => diaSP(c.quando) === hoje);
  const ate48h = candidatas.filter((c) => Date.now() - new Date(c.quando).getTime() <= 48 * 3600_000);
  const base = doDia.length >= 4 ? doDia : ate48h.length >= 4 ? ate48h : candidatas;
  const melhores = [...base]
    .sort((a, b) => b.boost - a.boost || (b.pct ?? 0) - (a.pct ?? 0) || b.quando.localeCompare(a.quando))
    .slice(0, limite);

  const comMedidas = async ({ boost: _b, path, ...o }: Oferta & { boost: number; path: string }): Promise<Oferta> => {
    try {
      const m = await sharp(path).metadata();
      o.largura = m.width ?? null;
      o.altura = m.height ?? null;
    } catch {}
    return o;
  };
  const ofertas = await Promise.all(melhores.map(comMedidas));
  const anuncio = candidatas.find((c) => PERFUME_DO_ANUNCIO.test(c.nome)); // candidatas vem do mais recente
  const destaque = anuncio ? await comMedidas(anuncio) : ofertas[0] ?? null;
  return { grupos, ofertas24h, postsHoje, ofertas, destaque };
}

/** Mídia de um post para a página pública: só de post que JÁ SAIU no grupo. */
export function midiaPublica(id: number) {
  return db().prepare("SELECT media_path, media_mime FROM posts WHERE id = ? AND status = 'sent'").get(id) as
    | { media_path: string | null; media_mime: string | null }
    | undefined;
}
