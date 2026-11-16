import { NextResponse } from "next/server";
import { handleWebhook } from "@/lib/pipeline";
import { getSettings } from "@/lib/settings";
import { log } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recebe eventos da Evolution API.
 * URL: {PUBLIC_URL}/api/webhook/evolution?token=SEU_WEBHOOK_TOKEN
 * (aceita também o sufixo /messages-upsert quando "webhook por eventos" está ligado)
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug?: string[] }> }) {
  const s = getSettings();
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || req.headers.get("x-webhook-token") || "";
  if (s.webhookToken && token !== s.webhookToken) {
    return NextResponse.json({ error: "token inválido" }, { status: 401 });
  }
  const { slug } = await ctx.params;
  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "json inválido" }, { status: 400 });
  if (!payload.event && slug?.length) payload.event = slug.join(".").replace(/-/g, ".");
  // Responde na hora e processa em segundo plano (a conversão de links pode levar alguns segundos).
  void handleWebhook(payload)
    .then((r) => r.info && !r.info.startsWith("evento ignorado") && log("info", `Webhook: ${r.info}`))
    .catch((e) => log("error", `Webhook: ${(e as Error).message}`));
  return NextResponse.json({ ok: true, received: true });
}

export function GET() {
  return NextResponse.json({ ok: true, info: "Webhook da Evolution API ativo. Use POST." });
}
