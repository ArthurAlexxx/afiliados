import { chatMessages, picOf } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/** Mensagens de uma conversa (?jid=), mais antigas primeiro. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const jid = u.searchParams.get("jid") || "";
  if (!jid) return Response.json({ error: "jid obrigatório" }, { status: 400 });
  try {
    const [messages, pic] = await Promise.all([chatMessages(jid, Number(u.searchParams.get("limit") || 60)), picOf(jid)]);
    return Response.json({ messages, pic });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
