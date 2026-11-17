import { db } from "@/lib/db";
import { chosenImagePath } from "@/lib/curation";
import { fragNow } from "@/lib/fragrantica";
import { notPerfume } from "@/lib/perfume";
import { apifyOff, dailyLimitUsd, spentTodayUsd } from "@/lib/apify";

export const dynamic = "force-dynamic";

type Row = {
  id: number;
  name: string;
  main: number | null;
  blocked: number;
  frag_url: string | null;
  fragram_at: string | null;
  frag_searched: number;
  last: string | null;
  waiting: string | null;
};

/** Situação do perfume no Fragrantica, em palavras, para cada card. */
type Frag = { state: "ready" | "busy" | "queued" | "found" | "nophotos" | "notfound" | "skip" | "paused" | "idle"; text: string; call?: string | null };

/**
 * Tela única de escolha: cada perfume com a foto que vai no post e todas as opções
 * (Fragram Photos do Fragrantica, Pinterest esperando e as fotos do banco).
 * ?q= busca, ?f= all | none | fragram | pin, ?offset=
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = `%${(u.searchParams.get("q") || "").trim()}%`;
  const f = u.searchParams.get("f") || "all";
  const one = Number(u.searchParams.get("id") || 0);
  const offset = Math.max(0, Number(u.searchParams.get("offset") || 0));
  const LIMIT = 30;
  const all = db()
    .prepare(
      `SELECT p.id, p.name, p.main_image_id main, COALESCE(p.blocked,0) blocked, p.frag_url, p.fragram_at, p.frag_searched,
              MAX(COALESCE((SELECT MAX(o.created_at) FROM offers o WHERE o.product_id = p.id), ''), COALESCE((SELECT MAX(i.created_at) FROM images i WHERE i.product_id = p.id), '')) last,
              (SELECT COUNT(*) FROM frag_photos g WHERE g.frag_url = p.frag_url) nfrag,
              (SELECT COUNT(*) FROM pin_photos x WHERE x.product_id = p.id AND x.status = 'pending' AND x.url NOT IN ('none','searching')) npin,
              (SELECT COUNT(*) FROM images i WHERE i.product_id = p.id AND i.disabled = 0 AND COALESCE(i.message_id,'') NOT LIKE 'frag:%') nimg,
              (SELECT MAX(q.created_at) FROM posts q WHERE q.product_id = p.id AND q.status = 'photo') waiting
       FROM products p WHERE p.name LIKE ?
       ORDER BY waiting IS NULL, waiting DESC, last DESC`,
    )
    .all(q) as (Row & { nfrag: number; npin: number; nimg: number; waiting: string | null })[];
  const list = all
    .filter((r) => !notPerfume(r.name) && (r.nfrag || r.npin || r.nimg || r.waiting))
    .filter((r) => !one || r.id === one)
    .filter((r) => one || (f === "wait" ? !!r.waiting : f === "none" ? !r.main : f === "fragram" ? r.nfrag > 0 : f === "pin" ? r.npin > 0 : true));
  const base = all.filter((r) => !notPerfume(r.name) && (r.nfrag || r.npin || r.nimg || r.waiting));
  const counts = {
    all: base.length,
    wait: base.filter((r) => r.waiting).length,
    none: base.filter((r) => !r.main).length,
    fragram: base.filter((r) => r.nfrag > 0).length,
    pin: base.filter((r) => r.npin > 0).length,
  };
  const idOf = db().prepare("SELECT id FROM images WHERE path = ?");
  const imgs = db().prepare(
    "SELECT id, width, height, message_id FROM images WHERE product_id = ? AND disabled = 0 AND COALESCE(message_id,'') NOT LIKE 'frag:%' ORDER BY score DESC LIMIT 20",
  );
  const pins = db().prepare("SELECT id, width, height FROM pin_photos WHERE product_id = ? AND status = 'pending' AND url NOT IN ('none','searching') ORDER BY score DESC LIMIT 20");
  const frags = db().prepare("SELECT id, url, thumb FROM frag_photos WHERE frag_url = ? ORDER BY id");
  const now = fragNow();
  const paused = apifyOff() || (spentTodayUsd() >= dailyLimitUsd() ? `Teto do dia do Apify atingido (US$ ${dailyLimitUsd().toFixed(2)}): busca volta amanhã` : null);
  const lastCall = db().prepare(
    `SELECT at, kind, cost_usd, ok, result FROM api_calls WHERE product_id = ? AND kind IN ('frag_search','frag_google','frag_photos') ORDER BY id DESC LIMIT 1`,
  );
  const ago = (at: string) => {
    const m = Math.max(0, Math.round((Date.now() - new Date(at.replace(" ", "T") + "Z").getTime()) / 60000));
    return m < 1 ? "agora" : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} d`;
  };
  const fragOf = (r: Row & { nfrag: number }): Frag => {
    const c = lastCall.get(r.id) as { at: string; kind: string; cost_usd: number; ok: number; result: string | null } | undefined;
    const call = c ? `Última consulta ${ago(c.at)} · US$ ${c.cost_usd.toFixed(4)}${c.ok ? "" : " · falhou"}` : null;
    if (r.nfrag) return { state: "ready", text: `${r.nfrag} foto(s) do Fragrantica`, call };
    if (now.names.has(r.id)) return { state: "busy", text: "Procurando o perfume no Fragrantica…", call };
    if (r.frag_url && now.urls.has(r.frag_url)) return { state: "busy", text: "Perfume achado. Lendo as fotos da página…", call };
    if (r.frag_url && r.fragram_at) return { state: "nophotos", text: "Achado no Fragrantica, mas a página não tem fotos", call };
    if (!r.frag_url && r.frag_searched) return { state: "notfound", text: "Não achado no Fragrantica", call };
    if (!r.frag_url && (notPerfume(r.name) || /\b(kit|combo|hair mist)\b/i.test(r.name))) return { state: "skip", text: "Kit ou combo: não existe no Fragrantica", call };
    if (r.waiting && !r.main && paused) return { state: "paused", text: paused, call };
    if (r.waiting && !r.main) return { state: "queued", text: r.frag_url ? "Na fila para ler as fotos (segundos)" : "Na fila para procurar no Fragrantica (segundos)", call };
    if (r.frag_url) return { state: "found", text: "Achado no Fragrantica. Fotos só são buscadas quando for postar", call };
    return { state: "idle", text: "Ainda não procurado. Só busca quando for postar", call };
  };
  const rows = list.slice(offset, offset + LIMIT).map((r) => {
    const pth = chosenImagePath(r.id);
    const cur = pth ? (idOf.get(pth) as { id: number } | undefined)?.id ?? null : null;
    return {
      id: r.id,
      name: r.name,
      main: r.main,
      blocked: r.blocked,
      fragUrl: r.frag_url,
      current: cur,
      waiting: r.waiting,
      expires: r.waiting ? new Date(new Date(r.waiting.replace(" ", "T") + "Z").getTime() + 3 * 3600e3).toISOString() : null,
      frag: fragOf(r),
      bank: imgs.all(r.id),
      pins: pins.all(r.id),
      fragram: r.frag_url ? frags.all(r.frag_url) : [],
    };
  });
  return Response.json({ rows, total: list.length, counts, apifyOff: apifyOff(), more: offset + LIMIT < list.length });
}
