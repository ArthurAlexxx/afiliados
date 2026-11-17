import { listChats } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/** Conversas do nosso número (nosso grupo fixado no topo). */
export async function GET() {
  try {
    return Response.json({ chats: await listChats() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
