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
};

export type AgentDecision = { approve: boolean; reason: string; checks: { ok: boolean; label: string }[]; by: "regras" | "claude" };

const brandOf = (name: string) => nameTokens(name)[0] || "";

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

  // preço contra o que os grupos costumam anunciar
  if (i.price && i.medianPrice) {
    const ratio = i.price / i.medianPrice;
    if (!add(ratio <= 1.15, ratio <= 1.15 ? "Preço na média dos grupos ou abaixo" : `Preço ${Math.round((ratio - 1) * 100)}% acima do normal nos grupos`))
      fail("o preço está acima do que os grupos costumam anunciar");
    if (ratio < 0.35) {
      add(false, "Preço baixo demais (provável erro de leitura: kit, miniatura)");
      fail("preço suspeito, provavelmente lido errado");
    }
  }

  if (!add(i.hasImage || i.score >= 70, i.hasImage ? "Tem foto boa" : "Sem foto")) fail("sem foto boa e o perfume não está tão em alta");

  // o que já saiu no nosso grupo: variar marca
  const recent = ourRecentPosts(3);
  const brand = brandOf(i.name);
  const sameBrand = brand ? recent.filter((p) => brandOf(p.name) === brand).length : 0;
  if (!add(sameBrand < 2 || i.historicLow, sameBrand ? `${sameBrand} post(s) da mesma linha nas últimas 3h` : "Variado em relação aos últimos posts"))
    fail("já saíram 2 posts parecidos nas últimas 3h");

  const pluses = [
    i.historicLow && "menor preço histórico",
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
- Preço: R$ ${i.price ?? "?"} | mediana nos grupos: R$ ${i.medianPrice ?? "?"} | menor já visto: R$ ${i.minPrice ?? "?"}
- Menor preço histórico: ${i.historicLow ? "sim" : "não"}
- Grupos que postaram na semana: ${i.groups} | grupos postando agora: ${i.recentGroups} | nota de hype: ${i.score}
- Vendas no ML: ${i.salesNote || "sem dado"}
- Tem foto: ${i.hasImage ? "sim" : "não"}

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
