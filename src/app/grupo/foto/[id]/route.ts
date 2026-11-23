import fs from "node:fs";
import { midiaPublica } from "@/lib/landing";

/** Foto de um post que já saiu no grupo, para a vitrine da landing page (rota pública). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const p = Number.isInteger(id) ? midiaPublica(id) : undefined;
  if (!p?.media_path || !fs.existsSync(p.media_path)) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(p.media_path), {
    headers: { "content-type": p.media_mime || "image/jpeg", "cache-control": "public, max-age=86400" },
  });
}
