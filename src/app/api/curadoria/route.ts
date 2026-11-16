import { db } from "@/lib/db";
import { getSettings, getState } from "@/lib/settings";
import { wishStats } from "@/lib/wishes";
import { brandName, importHistory, pickAndQueue, ranking } from "@/lib/curation";

export const dynamic = "force-dynamic";

/** Ranking dos perfumes + números do banco da curadoria. */
export function GET(req: Request) {
  const s = getSettings();
  const days = Number(new URL(req.url).searchParams.get("days") || 7);
  const list = ranking(s, { days });
  const count = (sql: string) => (db().prepare(sql).get() as { n: number }).n;
  const images = db()
    .prepare("SELECT id, product_id, score, width, height, group_jid, disabled FROM images ORDER BY score DESC")
    .all() as { id: number; product_id: number; score: number; width: number; height: number; group_jid: string; disabled: number }[];
  const imagesBy: Record<number, typeof images> = {};
  for (const i of images) (imagesBy[i.product_id] ||= []).push(i);
  return Response.json({
    mode: s.mode,
    interval: s.curationIntervalMinutes,
    brand: { name: brandName(s), instagram: s.brandInstagram, enabled: s.brandEnabled },
    lastPickAt: Number(getState("lastCurationAt") || 0) || null,
    historyImported: getState("historyImported"),
    wishes: wishStats(),
    totals: {
      offers: count("SELECT COUNT(*) n FROM offers"),
      offers24h: count("SELECT COUNT(*) n FROM offers WHERE created_at >= datetime('now','-1 day')"),
      products: count("SELECT COUNT(*) n FROM products"),
      images: count("SELECT COUNT(*) n FROM images WHERE disabled = 0"),
      curatedSent: count("SELECT COUNT(*) n FROM posts WHERE origin='curated' AND status='sent'"),
    },
    rows: list.slice(0, 80).map((r) => ({
      ...r,
      best: r.best ? { group: r.best.group_name, price: r.best.price, old: r.best.old_price, coupon: r.best.coupon, at: r.best.created_at, title: r.best.title } : null,
      gallery: (imagesBy[r.productId] || []).slice(0, 8),
    })),
  });
}

/**
 * Ações: pick (posta agora o melhor, ou o productId informado), import (lê o histórico dos grupos),
 * image (liga/desliga uma foto do banco).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; productId?: number; imageId?: number; disabled?: boolean };
  try {
    if (body.action === "pick") {
      const r = await pickAndQueue({ productId: body.productId, force: true });
      return Response.json({ ok: true, result: r });
    }
    if (body.action === "import") {
      const r = await importHistory();
      return Response.json({ ok: true, result: r });
    }
    if (body.action === "image" && body.imageId) {
      db().prepare("UPDATE images SET disabled = ? WHERE id = ?").run(body.disabled ? 1 : 0, body.imageId);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "ação inválida" }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
