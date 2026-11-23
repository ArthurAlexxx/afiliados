import { db } from "./db.ts";

/**
 * Dados da landing page do anúncio (/grupo).
 *
 * Tudo aqui é lido do banco de verdade: o que saiu no grupo, quantos grupos o
 * robô vigia, quantas promoções ele olhou. Número escrito à mão vira mentira
 * na semana seguinte. Quando o banco ainda está vazio (ambiente novo, prévia),
 * a página cai nos posts reais do teste de 17 e 18/11, os mesmos dos anúncios.
 */

export type Oferta = {
  id: number | null; // post (para a foto em /grupo/foto/[id]); null = exemplo sem foto
  nome: string;
  por: number;
  de: number | null;
  pct: number | null;
  quando: string | null; // ISO
};

export type DadosLanding = {
  grupos: number | null; // grupos de origem que o robô vigia
  ofertas24h: number | null; // promoções vistas nas últimas 24 h
  postsHoje: number | null;
  ofertas: Oferta[];
};

// Posts reais do grupo de teste (17 e 18/11). Os mesmos números dos anúncios.
const EXEMPLOS: Oferta[] = [
  { id: null, nome: "Yves Saint Laurent Y EDP 100ml", de: 1200, por: 610, pct: 49, quando: null },
  { id: null, nome: "Lattafa Fahad EDP 100ml", de: 749, por: 257, pct: 66, quando: null },
  { id: null, nome: "Hugo Boss Bottled Infinite 100ml", de: 789, por: 400, pct: 49, quando: null },
  { id: null, nome: "Jean Paul Gaultier Le Male Elixir 125ml", de: 379, por: 288, pct: 24, quando: null },
];

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

export function dadosLanding(): DadosLanding {
  const grupos = contar("SELECT COUNT(*) n FROM groups WHERE role = 'source'");
  const ofertas24h = contar("SELECT COUNT(*) n FROM offers WHERE created_at >= datetime('now', '-1 day')");
  const postsHoje = contar(
    "SELECT COUNT(*) n FROM posts WHERE status = 'sent' AND date(sent_at, '-3 hours') = date('now', '-3 hours')",
  );

  let ofertas: Oferta[] = [];
  try {
    const rows = db()
      .prepare(
        `SELECT q.id, COALESCE(p.name, '') name, q.data_json, q.sent_at
         FROM posts q LEFT JOIN products p ON p.id = q.product_id
         WHERE q.status = 'sent' AND q.media_path IS NOT NULL AND q.sent_at >= datetime('now', '-7 days')
         ORDER BY q.sent_at DESC LIMIT 24`,
      )
      .all() as { id: number; name: string; data_json: string; sent_at: string }[];
    const vistos = new Set<string>();
    for (const r of rows) {
      let j: { curation?: { bestPrice?: number; real?: { ref?: number } | null }; data?: Record<string, unknown> } = {};
      try {
        j = JSON.parse(r.data_json || "{}");
      } catch {}
      const nome = (r.name || String(j.data?.titulo || j.data?.nome || "")).trim();
      const por = num(j.curation?.bestPrice) ?? num(j.data?.preco);
      if (!nome || !por) continue;
      // o "DE" é o que a loja mostrava riscado; sem ele, o preço comum nos grupos
      let de = num(j.data?.preco_antigo) ?? num(j.curation?.real?.ref);
      if (de != null && de <= por) de = null;
      const pct = de ? Math.round((1 - por / de) * 100) : num(j.data?.desconto_pct);
      const chave = nome.toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      ofertas.push({ id: r.id, nome, por, de, pct: pct && pct >= 5 ? Math.round(pct) : null, quando: r.sent_at.replace(" ", "T") + "Z" });
      if (ofertas.length >= 8) break;
    }
  } catch {
    ofertas = [];
  }
  // Exemplo só entra com o banco vazio: misturar post real com exemplo repetia perfume
  // com nome escrito diferente. A grade é de 4 colunas, então corta em múltiplo de 4.
  if (!ofertas.length) ofertas = EXEMPLOS;
  else if (ofertas.length > 4) ofertas = ofertas.slice(0, ofertas.length >= 8 ? 8 : 4);

  return { grupos, ofertas24h, postsHoje, ofertas };
}

/** Mídia de um post para a página pública: só de post que JÁ SAIU no grupo. */
export function midiaPublica(id: number) {
  return db().prepare("SELECT media_path, media_mime FROM posts WHERE id = ? AND status = 'sent'").get(id) as
    | { media_path: string | null; media_mime: string | null }
    | undefined;
}
