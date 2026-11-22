import { db } from "@/lib/db";
import { Evolution } from "@/lib/evolution";
import { getSettings } from "@/lib/settings";
import { extractText } from "@/lib/pipeline";
import { parsePromo } from "@/lib/parser";
import { perfumeInfo } from "@/lib/perfume";
import { extractUrls, isMeliUrl } from "@/lib/links";

export const dynamic = "force-dynamic";

/** Arthur (22/nov): "só o RP lança mais de 40 por hora". Compara o que cada grupo postou com o que gravamos, e por que o resto ficou de fora. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const hours = Number(q.get("hours")) || 1;
  const only = q.get("group") || "";
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const evo = new Evolution(getSettings());
  const groups = db().prepare("SELECT jid, name FROM groups WHERE role = 'source'").all() as { jid: string; name: string }[];
  const out = [];
  for (const g of groups.filter((x) => !only || x.name.toLowerCase().includes(only.toLowerCase()))) {
    const reasons: Record<string, number> = {};
    const samples: Record<string, string[]> = {};
    let msgs = 0, recorded = 0;
    try {
      for (let page = 1; page <= 4; page++) {
        const { list, pages } = await evo.findMessagesSince(g.jid, since, 250, page);
        for (const m of list as { key?: { id?: string }; message?: unknown; messageTimestamp?: number | string }[]) {
          if (Number(m.messageTimestamp) < since) continue;
          msgs++;
          const id = m.key?.id || "";
          const text = extractText(m.message as never);
          let why = "";
          if (db().prepare("SELECT 1 FROM offers WHERE message_id = ?").get(id)) { recorded++; why = "gravada"; }
          else if (!text) why = "sem texto (foto/figurinha/áudio)";
          else {
            const p = parsePromo(text);
            if (p.cupomOnly || !p.titulo) why = "sem produto (cupom/aviso)";
            else if (!perfumeInfo(p.titulo)) why = "sem ml no título";
            else if (!extractUrls(text).some((u) => isMeliUrl(u) && !/\/sec\//.test(u))) why = "sem link de produto do ML";
            else why = "deveria ter gravado (perdida)";
          }
          reasons[why] = (reasons[why] || 0) + 1;
          if (why !== "gravada" && (samples[why]?.length || 0) < 3) (samples[why] ||= []).push((text || "").replace(/\s+/g, " ").slice(0, 140));
        }
        if (page >= pages) break;
      }
    } catch (e) {
      reasons[`erro: ${(e as Error).message.slice(0, 80)}`] = 1;
    }
    out.push({ group: g.name, msgs, recorded, reasons, samples });
  }
  return Response.json({ hours, groups: out.sort((a, b) => b.msgs - a.msgs) });
}
