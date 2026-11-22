import { db, log } from "@/lib/db";
import { Evolution } from "@/lib/evolution";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const CODE = /chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{18,24})/g;

/** Convites de grupos que aparecem nas mensagens dos grupos que já seguimos ("entre no nosso grupo 2"…). */
export function GET() {
  const rows = db().prepare("SELECT text, group_name FROM offers WHERE text LIKE '%chat.whatsapp.com%' ORDER BY id DESC LIMIT 3000").all() as { text: string; group_name: string }[];
  const found = new Map<string, { code: string; from: string; n: number }>();
  for (const r of rows) for (const m of r.text.matchAll(CODE)) {
    const f = found.get(m[1]) || { code: m[1], from: r.group_name, n: 0 };
    f.n++;
    found.set(m[1], f);
  }
  return Response.json({ codes: [...found.values()] });
}

/**
 * Arthur (22/nov): "entre em mais quantos grupos precisar". Para cada convite: lê o nome, entra
 * e marca como origem (preço e promoções). `check` só lê os nomes, sem entrar.
 */
export async function POST(req: Request) {
  const { codes, check } = (await req.json()) as { codes: string[]; check?: boolean };
  const evo = new Evolution(getSettings());
  const out: { code: string; subject?: string; size?: number; jid?: string; status: string }[] = [];
  for (const raw of (codes || []).slice(0, 40)) {
    const code = raw.replace(/.*chat\.whatsapp\.com\/(invite\/)?/, "").replace(/[^A-Za-z0-9].*$/, "");
    try {
      const info = await evo.inviteInfo(code);
      const jid = String(info.id || "");
      const subject = String(info.subject || "");
      if (check) {
        out.push({ code, subject, size: Number(info.size) || undefined, jid, status: "lido" });
        continue;
      }
      const known = jid ? (db().prepare("SELECT role FROM groups WHERE jid = ?").get(jid) as { role: string } | undefined) : undefined;
      if (!known || known.role === "none") {
        await evo.acceptInvite(code);
        await new Promise((r) => setTimeout(r, 4000)); // devagar, para o WhatsApp não estranhar
      }
      if (jid) {
        db()
          .prepare(
            `INSERT INTO groups (jid, name, role, promo, follow) VALUES (?, ?, 'source', 1, 0)
             ON CONFLICT(jid) DO UPDATE SET role = CASE WHEN groups.role IN ('destination','deals') THEN groups.role ELSE 'source' END, name = excluded.name`,
          )
          .run(jid, subject);
      }
      out.push({ code, subject, size: Number(info.size) || undefined, jid, status: known && known.role !== "none" ? "já estava" : "entrou" });
    } catch (e) {
      out.push({ code, status: `erro: ${(e as Error).message.slice(0, 160)}` });
    }
  }
  const joined = out.filter((o) => o.status === "entrou");
  if (joined.length) log("info", `Entrei em ${joined.length} grupo(s) novo(s): ${joined.map((o) => o.subject).join(", ")}`);
  return Response.json({ ok: true, out });
}
