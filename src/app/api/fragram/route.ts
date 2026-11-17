import { db, log } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Fotos do "Fragram Photos" do Fragrantica. O servidor não abre o Fragrantica (bloqueio do Cloudflare),
 * então quem lê as páginas é o Chrome do Arthur e manda só as URLs pra cá.
 * Protegido por ?t=FRAG_IMPORT_TOKEN (é chamado a partir da página do Fragrantica, sem o login do painel).
 */
const ORIGIN = "https://www.fragrantica.com";
const cors = { "access-control-allow-origin": ORIGIN, "access-control-allow-methods": "GET,POST", "access-control-allow-headers": "content-type" };

function ok(req: Request) {
  const t = new URL(req.url).searchParams.get("t") || "";
  return !!process.env.FRAG_IMPORT_TOKEN && t === process.env.FRAG_IMPORT_TOKEN;
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

/** Perfumes com página no Fragrantica, os sem fotos primeiro. */
export async function GET(req: Request) {
  if (!ok(req)) return Response.json({ error: "não autorizado" }, { status: 401, headers: cors });
  const rows = db()
    .prepare(
      `SELECT p.frag_url url, MIN(p.name) name, (SELECT COUNT(*) FROM frag_photos f WHERE f.frag_url = p.frag_url) n
       FROM products p WHERE p.frag_url IS NOT NULL AND p.frag_url != '' AND COALESCE(p.blocked,0) = 0
       GROUP BY p.frag_url ORDER BY n, MAX(p.id) DESC`,
    )
    .all();
  return Response.json(rows, { headers: cors });
}

/** { items: [{ fragUrl, photos: [{ url, thumb }] }] } — corpo em text/plain pra não precisar de preflight. */
export async function POST(req: Request) {
  if (!ok(req)) return Response.json({ error: "não autorizado" }, { status: 401, headers: cors });
  const b = JSON.parse(await req.text()) as { items?: { fragUrl: string; photos: { url: string; thumb?: string }[] }[] };
  const ins = db().prepare("INSERT OR IGNORE INTO frag_photos (frag_url, url, thumb) VALUES (?, ?, ?)");
  let n = 0;
  for (const it of b.items || []) {
    if (!/^https:\/\/(www\.)?fragrantica\.[a-z.]+\/perfume\//.test(it.fragUrl || "")) continue;
    for (const p of it.photos || []) {
      if (!/^https:\/\/fimgs\.net\/photogram\//.test(p.url || "")) continue;
      n += Number(ins.run(it.fragUrl, p.url, p.thumb && /^https:\/\/fimgs\.net\//.test(p.thumb) ? p.thumb : null).changes);
    }
  }
  log("info", `fragram: ${n} foto(s) do Fragrantica guardadas (${(b.items || []).length} perfume(s))`);
  return Response.json({ saved: n }, { headers: cors });
}
