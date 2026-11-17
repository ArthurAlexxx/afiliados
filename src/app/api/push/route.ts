import { pushPublicKey, removeSubscription, saveSubscription, sendPush, subscriptionCount } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Chave pública para o celular se cadastrar nos avisos. */
export function GET() {
  return Response.json({ publicKey: pushPublicKey(), devices: subscriptionCount() });
}

/** Cadastra este celular ({ subscription }) ou manda um aviso de teste ({ test: true }). */
export async function POST(req: Request) {
  const b = (await req.json()) as { subscription?: { endpoint: string }; test?: boolean };
  if (b.subscription?.endpoint) saveSubscription(b.subscription, req.headers.get("user-agent") || "");
  if (b.test) await sendPush({ title: "Avisos ligados ✅", body: "Você vai receber aqui os perfumes para aprovar e as fotos que chegarem.", url: "/fila", tag: "teste" });
  return Response.json({ ok: true, devices: subscriptionCount() });
}

export async function DELETE(req: Request) {
  const { endpoint } = (await req.json()) as { endpoint: string };
  if (endpoint) removeSubscription(endpoint);
  return Response.json({ ok: true });
}
