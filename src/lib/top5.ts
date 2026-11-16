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

const MEDAL: Record<number, [string, string]> = { 1: ["#f7d774", "#c99a2e"], 2: ["#e6e8ec", "#9aa1ab"], 3: ["#e8b48a", "#a5653a"] };

function roundedMask(w: number, h: number, r: number, onlyTop = false) {
  const path = onlyTop
    ? `<path d="M0 ${r} Q0 0 ${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h} H0 Z" fill="#fff"/>`
    : `<rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${path}</svg>`);
}

/** Foto do perfume inteira (nunca corta), no tamanho w x h, com o fundo completado. */
async function photo(p: Top5Pick, w: number, h: number): Promise<Buffer> {
  try {
    const side = Math.min(w, h);
    const sq = await squareCanvas(fs.readFileSync(p.img!), side);
    const plain = await plainEdgeColor(sq);
    const bg = plain
      ? await sharp({ create: { width: w, height: h, channels: 3, background: plain } }).png().toBuffer()
      : await sharp(sq).resize(w, h, { fit: "cover" }).blur(30).png().toBuffer();
    return await sharp(bg)
      .composite([{ input: sq, left: Math.round((w - side) / 2), top: Math.round((h - side) / 2) }])
      .png()
      .toBuffer();
  } catch {
    return sharp({ create: { width: w, height: h, channels: 3, background: "#ece8e2" } }).png().toBuffer();
  }
}

const clip = (t: string, max: number) => (t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t);

/** Card: foto com cantos arredondados em cima, faixa branca com nome, preço e desconto; medalha com a posição. */
async function card(p: Top5Pick, n: number, w: number, h: number): Promise<Buffer> {
  const R = 26, info = 116, imgH = h - info;
  const img = await sharp(await photo(p, w, imgH)).composite([{ input: roundedMask(w, imgH, R, true), blend: "dest-in" }]).png().toBuffer();
  const [c1, c2] = MEDAL[n] || ["#2b2b2b", "#111"];
  const numColor = MEDAL[n] ? "#2a1d05" : "#fff";
  const name = clip(p.titulo.replace(/\s+\d{2,4}\s*ml$/i, (m) => m), Math.floor(w / 13.6));
  const price = `R$ ${p.preco}`;
  const priceW = price.length * 18.6;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    </defs>
    <rect y="${imgH - R}" width="${w}" height="${info + R}" rx="${R}" fill="#ffffff"/>
    <rect y="${imgH - 1}" width="${w}" height="${R}" fill="#ffffff"/>
    <circle cx="44" cy="44" r="27" fill="url(#m)" stroke="#fff" stroke-opacity="0.85" stroke-width="3"/>
    <text x="44" y="54.5" text-anchor="middle" ${FONT} font-size="29" font-weight="800" fill="${numColor}">${n}</text>
    <text x="20" y="${imgH + 40}" ${FONT} font-size="22" font-weight="700" fill="#1a1a1a">${esc(name)}</text>
    <text x="20" y="${imgH + 88}" ${FONT} font-size="32" font-weight="800" fill="#111">${esc(price)}</text>
    ${p.pct ? `<rect x="${Math.round(20 + priceW + 12)}" y="${imgH + 60}" width="${p.pct.length * 15 + 46}" height="36" rx="18" fill="#16a34a"/>
    <text x="${Math.round(20 + priceW + 12 + (p.pct.length * 15 + 46) / 2)}" y="${imgH + 85}" text-anchor="middle" ${FONT} font-size="21" font-weight="800" fill="#fff">-${esc(p.pct)}%</text>` : ""}
  </svg>`;
  const body = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: img, left: 0, top: 0 }, { input: Buffer.from(svg) }])
    .png()
    .toBuffer();
  return sharp(body).composite([{ input: roundedMask(w, h, R), blend: "dest-in" }]).png().toBuffer();
}

async function shadow(w: number, h: number) {
  const pad = 30;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w + pad * 2}" height="${h + pad * 2}"><rect x="${pad}" y="${pad + 8}" width="${w}" height="${h}" rx="26" fill="#000" fill-opacity="0.55"/></svg>`;
  return { buf: await sharp(Buffer.from(svg)).blur(14).png().toBuffer(), pad };
}

/** Imagem 1080x1350 (formato retrato do WhatsApp): título + 3 cards em cima e 2 embaixo, cantos arredondados. */
export async function top5Image(picks: Top5Pick[], groupName: string): Promise<Buffer> {
  const W = 1080, H = 1350, M = 36, head = 176, gap = 20;
  const tz = getSettings().timezone || "America/Sao_Paulo";
  const date = new Intl.DateTimeFormat("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" }).format(new Date());
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1c1917"/><stop offset="1" stop-color="#0c0a09"/></linearGradient>
      <radialGradient id="glow" cx="0.85" cy="0.05" r="0.6"><stop offset="0" stop-color="#c99a2e" stop-opacity="0.28"/><stop offset="1" stop-color="#c99a2e" stop-opacity="0"/></radialGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f7d774"/><stop offset="1" stop-color="#c99a2e"/></linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    <text x="${M + 4}" y="96" ${FONT} font-size="64" font-weight="800" fill="#fff" letter-spacing="-1">TOP ${picks.length} <tspan fill="url(#gold)">DO DIA</tspan></text>
    <rect x="${M + 4}" y="118" width="64" height="5" rx="2.5" fill="url(#gold)"/>
    <text x="${M + 84}" y="125" ${FONT} font-size="24" font-weight="500" fill="#a8a29e">${esc(groupName)} · ${date} · as melhores ofertas de hoje</text>
  </svg>`);
  const top = picks.slice(0, 3);
  const bottom = picks.slice(3);
  const areaH = H - head - M;
  const rowH = bottom.length ? Math.floor((areaH - gap) / 2) : areaH;
  const layers: OverlayOptions[] = [];
  const place = async (row: Top5Pick[], y: number, offset: number) => {
    const cw = Math.floor((W - 2 * M - gap * (row.length - 1)) / row.length);
    const sh = await shadow(cw, rowH);
    for (let i = 0; i < row.length; i++) {
      const x = M + i * (cw + gap);
      layers.push({ input: sh.buf, left: x - sh.pad, top: y - sh.pad });
      layers.push({ input: await card(row[i], offset + i + 1, cw, rowH), left: x, top: y });
    }
  };
  await place(top, head, 0);
  if (bottom.length) await place(bottom, head + rowH + gap, 3);
  return sharp(bg).composite(layers).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
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
