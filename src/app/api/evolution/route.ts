import { Evolution } from "@/lib/evolution";
import { getSettings, webhookUrl, evolutionManagedByEnv } from "@/lib/settings";
import { ensureEvolution } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

/** Status da conexão e do webhook. */
export async function GET() {
  const s = getSettings();
  const evo = new Evolution(s);
  const managed = evolutionManagedByEnv();
  if (!evo.configured) return Response.json({ configured: false, managed, webhookUrl: webhookUrl(s) });
  const out: Record<string, unknown> = { configured: true, managed, instance: s.evolutionInstance, webhookUrl: webhookUrl(s) };
  try {
    const st = await evo.connectionState();
    out.state = st?.instance?.state || "desconhecido";
  } catch (e) {
    const msg = (e as Error).message;
    if (/404|not exist/i.test(msg)) out.state = "close"; // instância ainda não criada: o botão de QR cria
    else out.error = msg;
  }
  try {
    const wh = await evo.findWebhook();
    out.webhook = wh;
  } catch {}
  return Response.json(out);
}

/** Ações: setWebhook | testSend */
export async function POST(req: Request) {
  const s = getSettings();
  const evo = new Evolution(s);
  const { action, number, text } = (await req.json()) as { action: string; number?: string; text?: string };
  try {
    if (action === "connect") {
      try {
        const st = await evo.connectionState();
        if (st?.instance?.state === "open") return Response.json({ ok: true, state: "open" });
      } catch (e) {
        // instância ainda não existe: cria
        if (/404|not found|não encontrad|does not exist/i.test((e as Error).message)) {
          const created = await evo.createInstance(number);
          if (created?.qrcode?.base64 || created?.qrcode?.pairingCode) {
            return Response.json({ ok: true, created: true, ...created.qrcode });
          }
        } else throw e;
      }
      void ensureEvolution().catch(() => {});
      const r = await evo.connect(number);
      return Response.json({ ok: true, base64: r.base64, code: r.code, pairingCode: r.pairingCode, state: r.instance?.state });
    }
    if (action === "bootstrap") {
      return Response.json({ ok: true, result: await ensureEvolution() });
    }
    if (action === "logout") {
      await evo.logout();
      return Response.json({ ok: true });
    }
    if (action === "setWebhook") {
      const url = webhookUrl(s);
      if (!url) throw new Error("Defina a URL pública do painel antes.");
      await evo.setWebhook(url);
      return Response.json({ ok: true, url });
    }
    if (action === "testSend") {
      if (!number) throw new Error("Informe o grupo/número");
      await evo.sendText(number, text || "✅ Teste do painel de afiliados");
      return Response.json({ ok: true });
    }
    return Response.json({ error: "ação desconhecida" }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
