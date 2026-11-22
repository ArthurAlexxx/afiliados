import fs from "node:fs";
import path from "node:path";
import { db, log, MEDIA_DIR } from "@/lib/db";
import { Evolution } from "@/lib/evolution";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Arthur (22/nov): logo 2R PROMOS na foto dos nossos grupos (principal e ofertas boas) e no perfil do WhatsApp.
 * POST { dry?: boolean, profile?: boolean, names?: boolean } — names: troca também os nomes (grupos e perfil).
 */
const NAMES: Record<string, string> = { destination: "2R PROMOS · Perfumes", deals: "2R PROMOS · Achados" };
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { dry?: boolean; profile?: boolean; names?: boolean; only?: "destination" | "deals" };
  const file = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "brand", "2r-promos-640.jpg");
  if (!fs.existsSync(file)) return Response.json({ ok: false, error: "logo não encontrado no servidor" }, { status: 500 });
  const b64 = fs.readFileSync(file).toString("base64");
  const groups = db().prepare("SELECT jid, name, role FROM groups WHERE role IN ('destination','deals') ORDER BY role").all() as { jid: string; name: string; role: string }[];
  if (b.dry) return Response.json({ ok: true, groups: groups.map((g) => `${g.name} → ${NAMES[g.role]}`), profile: b.profile !== false });
  const evo = new Evolution(getSettings());
  const done: string[] = [];
  const failed: string[] = [];
  for (const g of groups) {
    try {
      await evo.updateGroupPicture(g.jid, b64);
      done.push(g.name);
    } catch (e) {
      failed.push(`${g.name}: ${(e as Error).message}`);
    }
  }
  if (b.names) {
    for (const g of groups.filter((x) => !b.only || x.role === b.only)) {
      try {
        await evo.updateGroupSubject(g.jid, NAMES[g.role]);
        db().prepare("UPDATE groups SET name = ? WHERE jid = ?").run(NAMES[g.role], g.jid);
        done.push(`nome: ${NAMES[g.role]}`);
      } catch (e) {
        failed.push(`nome ${g.name}: ${(e as Error).message}`);
      }
    }
    if (b.profile !== false)
      try {
        await evo.updateProfileName("2R PROMOS");
        done.push("nome do perfil: 2R PROMOS");
      } catch (e) {
        failed.push(`nome do perfil: ${(e as Error).message}`);
      }
  }
  if (b.profile !== false && !b.names) {
    try {
      await evo.updateProfilePicture(b64);
      done.push("perfil do WhatsApp");
    } catch (e) {
      failed.push(`perfil: ${(e as Error).message}`);
    }
  }
  // a etiqueta das fotos usa a foto do grupo principal (guardada por 24h): pega a nova
  try {
    fs.rmSync(path.join(/*turbopackIgnore: true*/ MEDIA_DIR, "brand-avatar.jpg"), { force: true });
  } catch {}
  log("info", `Logo 2R PROMOS aplicado: ${done.join(", ") || "nada"}${failed.length ? ` · falhou: ${failed.join("; ")}` : ""}`);
  return Response.json({ ok: !failed.length, done, failed });
}
