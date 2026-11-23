import { getSettings, getState, setState } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * O botão da landing page nunca aponta direto pro chat.whatsapp.com: passa por aqui.
 * Assim, quando o grupo lotar, troca-se o link em Configurações e todo anúncio no ar
 * já manda pro grupo novo (é o que os grupos grandes fazem com /df/fb01, sndflw etc).
 * E cada clique fica contado, para comparar com os cliques do anúncio.
 */
export function GET(req: Request) {
  const url = getSettings().groupInviteUrl.trim();
  try {
    const n = Number(getState("lpCliques") || 0) + 1;
    setState("lpCliques", String(n));
  } catch {}
  if (!/^https:\/\//.test(url)) return Response.redirect(new URL("/grupo#entrar", req.url), 302);
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
}
