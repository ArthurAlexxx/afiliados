import type { Settings } from "./settings.ts";

/**
 * Extração opcional com IA (Claude): melhora título, preços e cupom quando a mensagem é bagunçada.
 * Só roda se "IA" estiver ligada nas configurações e houver ANTHROPIC_API_KEY.
 */
export async function aiExtract(
  text: string,
  s: Settings,
): Promise<Partial<Record<"titulo" | "preco" | "preco_antigo" | "cupom" | "frete" | "parcelamento", string>> | null> {
  if (!s.aiEnabled || !s.anthropicApiKey) return null;
  const prompt = `Extraia os dados desta mensagem de promoção do WhatsApp. Responda APENAS um JSON com as chaves:
titulo (nome curto e claro do produto, sem emojis, máx 90 caracteres),
preco (preço final, formato 1.234,56, sem "R$"),
preco_antigo (preço antes do desconto, mesmo formato, ou ""),
cupom (código do cupom ou ""),
frete ("Frete grátis" se houver, senão ""),
parcelamento (ex: "10x de R$ 12,90 sem juros" ou "").

Mensagem:
"""
${text.slice(0, 3000)}
"""`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": s.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: s.aiModel || "claude-haiku-5-5",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { content?: { type: string; text?: string }[] };
    const out = j.content?.find((c) => c.type === "text")?.text || "";
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as Record<string, unknown>;
    const pick = (k: string) => (typeof parsed[k] === "string" ? (parsed[k] as string).trim() : "");
    return {
      titulo: pick("titulo"),
      preco: pick("preco"),
      preco_antigo: pick("preco_antigo"),
      cupom: pick("cupom"),
      frete: pick("frete"),
      parcelamento: pick("parcelamento"),
    };
  } catch {
    return null;
  }
}
