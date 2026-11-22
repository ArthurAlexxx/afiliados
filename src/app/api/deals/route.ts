import { db, log } from "@/lib/db";
import { Evolution } from "@/lib/evolution";
import { getSettings } from "@/lib/settings";
import { dealRules, dealsGroup, repostMissingLine, setDealRules, simulateDeals, type DealRules } from "@/lib/deals";

export const dynamic = "force-dynamic";

/** Grupo de ofertas boas: regras, o que saiu e a simulação das últimas 48h com as regras atuais. */
export function GET(req: Request) {
  const group = dealsGroup() || null;
  // simulação com outras regras: ?minPct=0.08&nearMin=9&hours=24
  const q = new URL(req.url).searchParams;
  const rules = { ...dealRules() } as DealRules;
  for (const k of Object.keys(rules) as (keyof DealRules)[]) if (q.get(k)) rules[k] = Number(q.get(k));
  const hours = Number(q.get("hours")) || 48;
  const posts = group
    ? db()
        .prepare("SELECT id, status, reason, source_name, created_at, sent_at, data_json FROM posts WHERE dest = ? ORDER BY id DESC LIMIT 20")
        .all(group.jid)
        .map((p) => {
          const r = p as { id: number; status: string; reason: string | null; source_name: string; created_at: string; sent_at: string | null; data_json: string };
          let name = "", price = null as number | null, ref = null as number | null;
          try {
            const j = JSON.parse(r.data_json);
            name = j.data?.titulo || "";
            price = j.curation?.bestPrice ?? null;
            ref = j.curation?.medianPrice ?? null;
          } catch {}
          return { id: r.id, status: r.status, reason: r.reason, via: r.source_name, created_at: r.created_at, sent_at: r.sent_at, name, price, ref };
        })
    : [];
  const prices = db()
    .prepare("SELECT COUNT(*) n, COUNT(DISTINCT product_id) p, COUNT(DISTINCT group_jid) g FROM offers WHERE price > 0 AND created_at >= datetime('now','-30 days')")
    .get() as { n: number; p: number; g: number };
  const sim = simulateDeals(hours, rules);
  const perHour = db().prepare("SELECT COUNT(*) n FROM offers WHERE price > 0 AND url IS NOT NULL AND created_at >= datetime('now', ?)").get(`-${hours} hours`) as { n: number };
  return Response.json({ group, rules, posts, prices, sim: { hours, checked: sim.checked, offersPerHour: Math.round(perHour.n / hours), deals: sim.deals.slice(0, 30), total: sim.deals.length } });
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as Partial<DealRules> & { repost?: { hours?: number; dry?: boolean } };
  if (body.repost) return Response.json(await repostMissingLine(body.repost.hours || 24, !!body.repost.dry));
  return Response.json({ ok: true, rules: setDealRules(body) });
}

/**
 * Cria o grupo de ofertas boas no WhatsApp (Arthur pediu em 22/nov: "crie o grupo e configure ele completo"):
 * mesmas pessoas do grupo de destino atual, os mesmos admins, mesma foto, só admins mandam mensagem,
 * e já marca o grupo como "Ofertas boas" no painel.
 */
export async function POST(req: Request) {
  const { subject, dry, exclude } = (await req.json().catch(() => ({}))) as { subject?: string; dry?: boolean; exclude?: string[] };
  if (dealsGroup()) return Response.json({ ok: false, error: "já existe um grupo de ofertas boas" }, { status: 400 });
  const dest = db().prepare("SELECT jid, name FROM groups WHERE role = 'destination' ORDER BY name LIMIT 1").get() as { jid: string; name: string } | undefined;
  if (!dest) return Response.json({ ok: false, error: "sem grupo de destino para copiar as pessoas" }, { status: 400 });
  const evo = new Evolution(getSettings());
  const steps: string[] = [];
  try {
    const info = await evo.groupInfo(dest.jid);
    const owner = (await evo.ownerJid().catch(() => "")).replace(/@.*/, "").replace(/:.*/, "");
    const num = (p: { id: string; phoneNumber?: string; jid?: string }) => {
      const j = [p.phoneNumber, p.jid, p.id].find((x) => x && /@s\.whatsapp\.net$/.test(x)) || "";
      return j.replace(/@.*/, "").replace(/:.*/, "");
    };
    const people = (info.participants || []).map((p) => ({ n: num(p), admin: Boolean(p.admin) })).filter((p) => p.n && p.n !== owner && !(exclude || []).some((x) => x && p.n.endsWith(x.replace(/\D/g, ""))));
    steps.push(`grupo atual: ${info.participants?.length || 0} participantes, ${people.length} para adicionar`);
    if (dry) return Response.json({ ok: true, dry: true, owner, people, announce: info.announce, raw: (info.participants || []).slice(0, 5) });
    if (!people.length) return Response.json({ ok: false, error: "não consegui ler os números do grupo atual", steps, info }, { status: 400 });
    const name = subject || "Radar Ofertas · Achados (teste 2)";
    const desc = "Só as melhores promoções de perfume: preço bem abaixo do normal dos grupos.";
    const g = await evo.createGroup(name, people.map((p) => p.n), desc);
    const jid = String(g.id || g.groupJid || "");
    if (!jid) return Response.json({ ok: false, error: "a Evolution não devolveu o id do grupo", steps, g }, { status: 400 });
    steps.push(`criado: ${name}`);
    db()
      .prepare(`INSERT INTO groups (jid, name, role) VALUES (?, ?, 'deals') ON CONFLICT(jid) DO UPDATE SET role = 'deals', name = excluded.name`)
      .run(jid, name);
    steps.push("marcado como Ofertas boas no painel");
    const admins = people.filter((p) => p.admin).map((p) => p.n);
    if (admins.length) await evo.updateParticipants(jid, "promote", admins).then(() => steps.push(`admins: ${admins.length}`)).catch((e) => steps.push(`admins falhou: ${(e as Error).message}`));
    if (info.announce) await evo.updateGroupSetting(jid, "announcement").then(() => steps.push("só admins mandam mensagem")).catch((e) => steps.push(`só admins falhou: ${(e as Error).message}`));
    await evo.updateGroupSetting(jid, "locked").then(() => steps.push("só admins editam o grupo")).catch((e) => steps.push(`travar edição falhou: ${(e as Error).message}`));
    const pic = await evo.profilePictureUrl(dest.jid).catch(() => null);
    if (pic) await evo.updateGroupPicture(jid, pic).then(() => steps.push("foto copiada do grupo atual")).catch((e) => steps.push(`foto falhou: ${(e as Error).message}`));
    log("info", `Grupo de ofertas boas criado: ${name} (${jid}) · ${steps.join(" · ")}`);
    return Response.json({ ok: true, jid, name, steps });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message, steps }, { status: 400 });
  }
}
