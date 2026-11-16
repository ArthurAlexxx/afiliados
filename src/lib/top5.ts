/**
 * Top 5 do dia (21h): um post só, com uma imagem montada com os 5 perfumes e a lista curta com os links.
 * Uma notificação, não cinco (evita o grupo ser silenciado ou denunciado como spam).
 * Os 5 são as melhores promoções que postamos no dia (desconto real, selo de menor preço e hype).
 */
import fs from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { db, log, MEDIA_DIR } from "./db.ts";
import { getSettings, getState, setState } from "./settings.ts";
import { plainEdgeColor, squareCanvas } from "./branding.ts";
import { bestImagePath, brandName } from "./curation.ts";

export type Top5Pick = {
  postId: number;
  productId: number;
  titulo: string;
  preco: string;
  pct: string;
  link: string;
  seal: string;
  img: string | null;
  rank: number;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const todayTz = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const nowTz = (tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", "."));

export function top5Picks(): Top5Pick[] {
  const rows = db()
    .prepare(
      `SELECT id, product_id, data_json, media_path FROM posts
       WHERE origin='curated' AND status='sent' AND product_id IS NOT NULL
         AND date(created_at,'-3 hours') = date('now','-3 hours') ORDER BY id DESC`,
    )
    .all() as { id: number; product_id: number; data_json: string; media_path: string | null }[];
  const by = new Map<number, Top5Pick>();
  for (const r of rows) {
    try {
      const j = JSON.parse(r.data_json);
      const d = j.data || {};
      if (!d.link || !d.titulo || !d.preco) continue;
      const real = j.curation?.real?.discount as number | null | undefined;
      const declared = Number(d.desconto_pct || 0) / 100;
      const rank = (real ?? declared * 0.5) + (d.historico ? 0.15 : 0) + (j.curation?.score || 0) / 1000;
      const cur = by.get(r.product_id);
      // mesmo perfume postado 2x no dia: fica o mais barato
      if (cur && num(cur.preco) <= num(d.preco)) continue;
      by.set(r.product_id, {
        postId: r.id,
        productId: r.product_id,
        titulo: d.titulo,
        preco: d.preco,
        pct: d.desconto_pct || "",
        link: d.link,
        seal: d.historico || "",
        img: bestImagePath(r.product_id) || r.media_path,
        rank,
      });
    } catch {
      /* ignora */
    }
  }
  return [...by.values()].sort((a, b) => b.rank - a.rank).slice(0, 5);
}

const FONT = `font-family="Inter, DejaVu Sans, sans-serif"`;

async function tile(p: Top5Pick, n: number, w: number, h: number): Promise<Buffer> {
  let base: Buffer;
  try {
    // nunca corta o perfume: foto quadrada inteira no centro; sobras com a própria foto desfocada (fundo liso fica liso)
    const side = Math.min(w, h);
    const sq = await squareCanvas(fs.readFileSync(p.img!), side);
    const plain = await plainEdgeColor(sq);
    const bg = plain
      ? await sharp({ create: { width: w, height: h, channels: 3, background: plain } }).png().toBuffer()
      : await sharp(sq).resize(w, h, { fit: "cover" }).blur(30).png().toBuffer();
    base = await sharp(bg)
      .composite([{ input: sq, left: Math.round((w - side) / 2), top: Math.round((h - side) / 2) }])
      .png()
      .toBuffer();
  } catch {
    base = await sharp({ create: { width: w, height: h, channels: 3, background: "#e9e5df" } }).png().toBuffer();
  }
  const price = `R$ ${p.preco}`;
  const priceW = price.length * 16.5;
  const pill = Math.round(priceW + (p.pct ? 86 : 0) + 36);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <circle cx="46" cy="46" r="28" fill="#111" fill-opacity="0.88"/>
    <text x="46" y="56" text-anchor="middle" ${FONT} font-size="30" font-weight="800" fill="#fff">${n}</text>
    <rect x="16" y="${h - 66}" width="${pill}" height="48" rx="24" fill="#fff" fill-opacity="0.96"/>
    <text x="34" y="${h - 33}" ${FONT} font-size="28" font-weight="800" fill="#111">${esc(price)}</text>
    ${p.pct ? `<text x="${Math.round(34 + priceW + 14)}" y="${h - 33}" ${FONT} font-size="24" font-weight="800" fill="#16a34a">-${esc(p.pct)}%</text>` : ""}
  </svg>`;
  return sharp(base).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

/** Imagem 1080x1080: faixa do título + 3 perfumes em cima e 2 embaixo. */
export async function top5Image(picks: Top5Pick[], groupName: string): Promise<Buffer> {
  const W = 1080, H = 1080, head = 150, gap = 8;
  const tz = getSettings().timezone || "America/Sao_Paulo";
  const date = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" }).format(new Date());
  const header = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${head}">
    <rect width="${W}" height="${head}" fill="#111"/>
    <text x="40" y="82" ${FONT} font-size="54" font-weight="800" fill="#fff">TOP ${picks.length} DO DIA</text>
    <text x="40" y="124" ${FONT} font-size="26" font-weight="500" fill="#bbb">${esc(groupName)} · ${date} · as melhores ofertas de hoje</text>
  </svg>`);
  const top = picks.slice(0, 3);
  const bottom = picks.slice(3);
  const rowH = bottom.length ? Math.floor((H - head - gap) / 2) : H - head;
  const layers: OverlayOptions[] = [{ input: header, left: 0, top: 0 }];
  const place = async (row: Top5Pick[], y: number, offset: number) => {
    const tw = Math.floor((W - gap * (row.length - 1)) / row.length);
    for (let i = 0; i < row.length; i++) layers.push({ input: await tile(row[i], offset + i + 1, tw, rowH), left: i * (tw + gap), top: y });
  };
  await place(top, head, 0);
  if (bottom.length) await place(bottom, head + rowH + gap, 3);
  return sharp({ create: { width: W, height: H, channels: 3, background: "#111" } })
    .composite(layers)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

const NUMS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

export function top5Caption(picks: Top5Pick[]): string {
  const lines = [`🏆 *TOP ${picks.length} DO DIA* · as melhores ofertas de hoje`, ""];
  picks.forEach((p, i) => {
    lines.push(`${NUMS[i]} *${p.titulo}*`);
    lines.push(`R$${p.preco}${p.pct ? ` (-${p.pct}%)` : ""}${p.seal ? " · 🏆 menor preço" : ""}`);
    lines.push(p.link, "");
  });
  lines.push("_Preços podem mudar a qualquer momento._");
  return lines.join("\n");
}

/** Monta e coloca na fila o Top 5 (uma vez por dia, a partir das 21h). force = monta agora; dryRun = só prévia. */
export async function runTop5(opts: { force?: boolean; dryRun?: boolean } = {}): Promise<{ msg: string; image?: Buffer; caption?: string }> {
  const s = getSettings();
  const tz = s.timezone || "America/Sao_Paulo";
  const today = todayTz(tz);
  if (!opts.force && (nowTz(tz) < "21:00" || getState("top5Date") === today)) return { msg: "ainda não é hora" };
  const picks = top5Picks();
  if (picks.length < 3) {
    if (!opts.dryRun && !opts.force) setState("top5Date", today);
    return { msg: `poucos posts hoje (${picks.length}), sem Top 5` };
  }
  const image = await top5Image(picks, brandName(s));
  const caption = top5Caption(picks);
  if (opts.dryRun) return { msg: "prévia", image, caption };
  const file = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, `top5_${today}.jpg`);
  fs.writeFileSync(file, image);
  const info = db()
    .prepare(
      `INSERT INTO posts (message_id, source_name, original_text, formatted_text, data_json, media_path, media_mime, origin, status, reason)
       VALUES (?, 'Top 5 do dia', '', ?, ?, ?, 'image/jpeg', 'top5', 'queued', 'Resumo diário das melhores ofertas')`,
    )
    .run(`top5-${today}-${Date.now()}`, caption, JSON.stringify({ top5: picks.map((p) => ({ postId: p.postId, titulo: p.titulo, preco: p.preco })) }), file);
  setState("top5Date", today);
  log("info", `Top 5 do dia montado (post #${info.lastInsertRowid}): ${picks.map((p) => p.titulo).join(", ")}`);
  return { msg: `post #${info.lastInsertRowid}` };
}
