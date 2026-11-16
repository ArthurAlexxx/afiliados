import fs from "node:fs";
import { fixFile } from "@/lib/imagefix";

/** Foto original (?v=src) ou refeita (?v=out). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const v = new URL(req.url).searchParams.get("v") === "out" ? "out" : "src";
  const p = fixFile(id, v);
  if (!p) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(p), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=600" } });
}
