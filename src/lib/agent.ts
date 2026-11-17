/**
 * Agente que decide sozinho se cada post sai ou não (não existe mais aprovação manual).
 *
 * Ele olha:
 * - o que os outros grupos estão postando (hype, preço que costumam anunciar, histórico de preço);
 * - o que já saiu no nosso grupo (não repetir perfume nem marca seguida, variar);
 * - a qualidade do post (nosso link, preço, foto).
 * Com ANTHROPIC_API_KEY configurada, o Claude dá a palavra final em cima dessas informações.
 */
import { db, log } from "./db.ts";
import type { Settings } from "./settings.ts";
import { nameTokens } from "./perfume.ts";

export type AgentInput = {
  productId: number | null;
  name: string;
  price: number | null;
  medianPrice: number | null;
  minPrice: number | null;
  groups: number;
  recentGroups: number;
  score: number;
  link: string;
  hasImage: boolean;
  historicLow: boolean;
  salesNote?: string | null;
  offerAgeMin: number | null;
  text: string;
  origin?: "arabe" | "importado" | "nacional" | null;
  discountPct?: number | null;
  /** preço real (mediana do "POR" nos grupos) e quanto esta oferta está abaixo dele */
  realPrice?: number | null;
  realDiscount?: number | null;
  inflated?: boolean;
  /** menor preço que já postamos hoje desse perfume */
  ourBestToday?: number | null;
};

export type AgentDecision = { approve: boolean; reason: string; checks: { ok: boolean; label: string }[]; by: "regras" | "claude" };

const brandOf = (name: string) => nameTokens(name)[0] || "";

function originOf(postId: number): string {
  const r = db().prepare("SELECT data_json FROM posts WHERE id = ?").get(postId) as { data_json: string } | undefined;
  try {
    return String(JSON.parse(r?.data_json || "{}").curation?.origin || "");
  } catch {
    return "";
  }
}

function ourRecentPosts(hours: number) {
  return db()
    .prepare(
      `SELECT p.id, p.product_id, COALESCE(pr.name, '') name, p.sent_at FROM posts p LEFT JOIN products pr ON pr.id = p.product_id
       WHERE p.status = 'sent' AND p.sent_at >= datetime('now', ?) ORDER BY p.sent_at DESC`,
    )
    .all(`-${hours} hours`) as { id: number; product_id: number | null; name: string; sent_at: string }[];
}

/** Regras fixas: o que nunca pode sair. */
function rules(i: AgentInput, s: Settings): AgentDecision {
  const checks: AgentDecision["checks"] = [];
  const add = (ok: boolean, label: string) => (checks.push({ ok, label }), ok);
  let veto = "";
  const fail = (r: string) => (veto ||= r);

  if (!add(Boolean(i.link), i.link ? "Tem o nosso link de afiliado" : "Sem o nosso link de afiliado")) fail("o link do ML não virou o nosso link");
  if (!add(Boolean(i.price && i.price > 0), i.price ? "Preço identificado" : "Sem preço")) fail("não deu para ler o preço");
  if (i.offerAgeMin != null && !add(i.offerAgeMin <= Math.max(5, s.curationLookbackMinutes), `Oferta de ${Math.round(i.offerAgeMin)} min atrás`))
    fail("a oferta já ficou velha, o preço pode ter mudado");

  // preço real: a oferta precisa estar abaixo do que o perfume custa de verdade nos grupos
  const fmt = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
  if (i.price && i.realPrice && i.realDiscount != null) {
    const pct = Math.round(i.realDiscount * 100);
    const good = i.realDiscount >= 0.08 || i.historicLow;
    add(good, `Preço real ${fmt(i.realPrice)} · esta oferta está ${pct >= 0 ? `${pct}% abaixo` : `${-pct}% acima`}${pct >= 20 ? " (ótima)" : pct >= 8 ? " (boa)" : " (normal)"}`);
    if (!good) fail(pct >= 0 ? `só ${pct}% abaixo do preço real (${fmt(i.realPrice)}), não é promoção de verdade` : `acima do preço real (${fmt(i.realPrice)})`);
    if (i.inflated) add(true, "O grupo inflou o \"DE\" (bem acima do preço real); a decisão usa o preço real");
    if (i.realDiscount < -0.5 || i.price < i.realPrice * 0.35) {
      add(false, "Preço fora da realidade (provável erro de leitura: kit, miniatura)");
      fail("preço suspeito, provavelmente lido errado");
    }
  } else if (i.price && i.medianPrice) {
    // ainda sem preço real confiável: compara com o que os grupos anunciaram na semana
    const ratio = i.price / i.medianPrice;
    // só informativo (Arthur, nov/2026): o banco ainda é pequeno e isso descartava muito anúncio bom
    add(true, `Sem preço real ainda · ${ratio <= 1 ? "na média da semana ou abaixo" : `${Math.round((ratio - 1) * 100)}% acima da média da semana (não bloqueia)`}`);
  }
  // mesmo dia: não postar o mesmo perfume mais caro do que já postamos hoje
  if (i.price && i.ourBestToday && !add(i.price <= i.ourBestToday, `Já postamos hoje por ${fmt(i.ourBestToday)}`))
    fail(`hoje já postamos esse perfume mais barato (${fmt(i.ourBestToday)})`);

  if (!add(i.hasImage || i.score >= 70, i.hasImage ? "Tem foto boa" : "Sem foto")) fail("sem foto boa e o perfume não está tão em alta");

  // o que já saiu no nosso grupo: variar marca
  const recent = ourRecentPosts(3);
  const brand = brandOf(i.name);
  const sameBrand = brand ? recent.filter((p) => brandOf(p.name) === brand).length : 0;
  if (!add(sameBrand < 2 || i.historicLow, sameBrand ? `${sameBrand} post(s) da mesma linha nas últimas 3h` : "Variado em relação aos últimos posts"))
    fail("já saíram 2 posts parecidos nas últimas 3h");

  // foco em árabes e importados; nacional só quando a oferta é muito boa, e no máximo 1 a cada 2h
  if (i.origin === "nacional") {
    const great = i.historicLow || i.recentGroups >= 3 || (i.discountPct || 0) >= 40;
    const nacionais = ourRecentPosts(2).filter((p) => /nacional/.test(originOf(p.id))).length;
    if (!add(great && nacionais === 0, great ? (nacionais ? "Já saiu um nacional nas últimas 2h" : "Nacional com oferta muito boa") : "Nacional sem oferta fora de série"))
      fail(great ? "já saiu um nacional nas últimas 2h (foco em árabes e importados)" : "nacional sem oferta fora de série (foco em árabes e importados)");
  } else if (i.origin) add(true, i.origin === "arabe" ? "Árabe (foco do grupo)" : "Importado (foco do grupo)");

  const pluses = [
    i.historicLow && "menor preço histórico",
    i.realDiscount != null && i.realDiscount >= 0.08 && `${Math.round(i.realDiscount * 100)}% abaixo do preço real`,
    i.recentGroups >= 2 && `${i.recentGroups} grupos postando agora`,
    i.groups >= 4 && `${i.groups} grupos na semana`,
    i.salesNote,
  ].filter(Boolean);
  const reason = veto ? `Descartado: ${veto}` : `Aprovado${pluses.length ? `: ${pluses.join(", ")}` : ""}`;
  return { approve: !veto, reason, checks, by: "regras" };
}

async function askClaude(i: AgentInput, base: AgentDecision, s: Settings): Promise<AgentDecision | null> {
  const key = s.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const recent = ourRecentPosts(12).slice(0, 15).map((p) => `- ${p.sent_at} ${p.name}`).join("\n") || "(nenhum)";
  const prompt = `Você é o editor de um grupo de WhatsApp de promoções de perfumes (afiliado Mercado Livre).
Decida se esta oferta deve ser postada AGORA. Objetivo: postar o que está em alta e é bom negócio, sem repetir e sem enganar.

Oferta:
- Perfume: ${i.name}
- Preço: R$ ${i.price ?? "?"} | preço real (mediana do "POR" nos grupos, 30 dias): R$ ${i.realPrice ?? "?"} | desconto real: ${i.realDiscount != null ? Math.round(i.realDiscount * 100) + "%" : "?"} | menor já visto: R$ ${i.minPrice ?? "?"}
- Não confie no "DE" dos grupos (alguns inflam). Oferta boa = abaixo do preço real; não precisa ser a melhor de todas, só valer a pena.
- Menor preço histórico: ${i.historicLow ? "sim" : "não"}
- Grupos que postaram na semana: ${i.groups} | grupos postando agora: ${i.recentGroups} | nota de hype: ${i.score}
- Vendas no ML: ${i.salesNote || "sem dado"}
- Tem foto: ${i.hasImage ? "sim" : "não"}
- Origem: ${i.origin || "desconhecida"} (o grupo foca em árabes e importados; nacional só com oferta muito boa)

Checagens automáticas:
${base.checks.map((c) => `${c.ok ? "✔" : "✘"} ${c.label}`).join("\n")}

Últimos posts do nosso grupo (12h):
${recent}

Texto original do grupo de origem:
"""
${i.text.slice(0, 1500)}
"""

Responda só um JSON: {"aprovar": true|false, "motivo": "frase curta em português"}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: s.aiModel || "claude-haiku-5-5", max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { content?: { type: string; text?: string }[] };
    const m = (j.content?.find((c) => c.type === "text")?.text || "").match(/\{[\s\S]*\}/);
    if (!m) return null;
    const out = JSON.parse(m[0]) as { aprovar?: boolean; motivo?: string };
    const approve = Boolean(out.aprovar);
    return { approve, reason: `${approve ? "Aprovado" : "Descartado"}: ${out.motivo || ""}`.trim(), checks: base.checks, by: "claude" };
  } catch (e) {
    log("warn", `Agente (Claude) indisponível, decidi pelas regras: ${(e as Error).message}`);
    return null;
  }
}

/** Decisão final: as regras vetam o que nunca pode sair; o Claude (se configurado) decide o resto. */
export async function judge(i: AgentInput, s: Settings): Promise<AgentDecision> {
  const base = rules(i, s);
  if (!base.approve) return base;
  return (await askClaude(i, base, s)) || base;
}
