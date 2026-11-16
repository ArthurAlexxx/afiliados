import fs from "node:fs";
import { fixFile, refFile } from "@/lib/imagefix";

/** Foto original (?v=src) ou refeita (?v=out). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const q = new URL(req.url).searchParams;
  // marca de referência do grupo: /api/imagens/0?ref=<jid>
  const ref = q.get("ref");
  const p = ref ? refFile(ref) : fixFile(id, q.get("v") === "out" ? "out" : "src");
  if (ref && p) return new Response(fs.readFileSync(p), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  if (!p) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(p), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=600" } });
}
