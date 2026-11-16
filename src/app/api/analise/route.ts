import { Evolution } from "@/lib/evolution";
import { getSettings } from "@/lib/settings";
import { extractText } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Msg = {
  key?: { id?: string; remoteJid?: string; participant?: string };
  pushName?: string;
  messageType?: string;
  messageTimestamp?: number | string;
  message?: Record<string, unknown> & {
    imageMessage?: { caption?: string; width?: number; height?: number; fileLength?: string | number; mimetype?: string };
  };
};

/** Exporta grupos e últimas mensagens de cada um (para análise da curadoria). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 60), 300);
  const only = url.searchParams.get("jid");
  const evo = new Evolution(getSettings());
  const groups = await evo.fetchAllGroups();
  const out: Record<string, unknown>[] = [];
  for (const g of groups) {
    if (only && g.id !== only) continue;
    let msgs: Msg[] = [];
    try {
      msgs = (await evo.findMessages(g.id, limit)) as Msg[];
    } catch (e) {
      out.push({ jid: g.id, subject: g.subject, size: g.size, error: (e as Error).message });
      continue;
    }
    out.push({
      jid: g.id,
      subject: g.subject,
      size: g.size,
      messages: msgs.map((m) => {
        const img = m.message?.imageMessage;
        return {
          id: m.key?.id,
          ts: Number(m.messageTimestamp) || null,
          from: m.pushName,
          type: m.messageType,
          text: extractText(m.message as never),
          image: img ? { w: img.width, h: img.height, bytes: Number(img.fileLength) || null, mime: img.mimetype } : null,
        };
      }),
    });
  }
  return Response.json({ instance: getSettings().evolutionInstance, groups: out });
}
