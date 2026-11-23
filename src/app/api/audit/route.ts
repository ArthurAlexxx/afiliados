import { db } from "@/lib/db";
import { fetchHtml, findOgTitle } from "@/lib/links";
import { sameListing } from "@/lib/perfume";

export const dynamic = "force-dynamic";

const titles = (globalThis as { __auditTitles?: Map<string, string | null> }).__auditTitles ??= new Map();

/**
 * Auditoria (Arthur, 23/nov): posts enviados num período, comparando o nome do post e o perfume da foto
 * com o título do anúncio que o link abre. ?since=2026-11-22 03:00:00&until=...
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const since = q.get("since") || new Date(Date.now() - 24 * 3600e3).toISOString().slice(0, 19).replace("T", " ");
  const until = q.get("until") || "9999";
  const rows = db()
    .prepare(
      `SELECT q.id, q.sent_at, q.dest, q.origin, q.source_name, q.data_json, q.product_id, p.name product, g.name dest_name
       FROM posts q LEFT JOIN products p ON p.id = q.product_id LEFT JOIN groups g ON g.jid = q.dest
       WHERE q.status = 'sent' AND q.sent_at >= ? AND q.sent_at < ? ORDER BY q.sent_at`,
    )
    .all(since, until) as { id: number; sent_at: string; dest: string | null; origin: string; source_name: string; data_json: string; product_id: number | null; product: string | null; dest_name: string | null }[];
  if (q.get("retry")) for (const [k, v] of titles) if (!v) titles.delete(k);
  const errs = new Map<string, string>();
  const out: { sent_at: string; [k: string]: unknown }[] = [];
  const queue = [...rows];
  const work = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      let j: { data?: Record<string, string>; conversions?: { ok: boolean; title?: string | null; canonical?: string }[]; curation?: { image?: string } } = {};
      try { j = JSON.parse(r.data_json || "{}"); } catch { /* */ }
      const conv = (j.conversions || []).find((c) => c.ok) || (j.conversions || [])[0];
      let listing = conv?.title || null;
      if (!listing && conv?.canonical) {
        if (!titles.has(conv.canonical)) {
          let t: string | null = null;
          for (let a = 0; a < 2 && !t; a++) {
            const html = await fetchHtml(conv.canonical, 15000);
            t = findOgTitle(html) || html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || null;
            if (t && /mercado livre$/i.test(t) && t.length < 20) t = null;
            if (!t) errs.set(conv.canonical, `${html.length} bytes: ${html.replace(/\s+/g, " ").slice(0, 120)}`);
            if (!t) await new Promise((x) => setTimeout(x, 1500));
          }
          titles.set(conv.canonical, t);
        }
        listing = titles.get(conv.canonical) ?? null;
      }
      listing = listing ? listing.replace(/\s*\|\s*Mercado\s*Livre.*$/i, "").trim() : null;
      const titulo = j.data?.titulo || "";
      const vsTitle = listing ? sameListing(listing, titulo) : null;
      const vsPhoto = listing && r.product ? sameListing(listing, r.product) : null;
      out.push({
        id: r.id, sent_at: r.sent_at, group: r.dest_name || r.source_name, origin: r.origin, titulo, product: r.product, image: j.curation?.image || null,
        link: conv?.canonical || null, listing, titleOk: vsTitle?.ok ?? null, titleScore: vsTitle?.score ?? null, photoOk: vsPhoto?.ok ?? null, photoScore: vsPhoto?.score ?? null, err: conv?.canonical ? errs.get(conv.canonical) : undefined,
      });
    }
  };
  await Promise.all([work(), work()]);
  out.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  return Response.json({ since, total: out.length, posts: out });
}
