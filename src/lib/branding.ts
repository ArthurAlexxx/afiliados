import sharp, { type OverlayOptions } from "sharp";

export type BrandOptions = {
  /** ex: 32 → etiqueta "-32%" no canto inferior esquerdo. Sem desconto, a etiqueta não aparece. */
  discountPct?: number | null;
  groupName: string;
  instagram?: string;
  /** foto do grupo (qualquer formato). */
  avatar?: Buffer | null;
  /** lado maior da imagem final (px). */
  maxSize?: number;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function roundedMask(w: number, h: number, r: number) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
  );
}

/** Vidro: recorta a área, desfoca, clareia e arredonda (efeito glassmorphism real, não só transparência). */
async function glassTile(base: Buffer, x: number, y: number, w: number, h: number, r: number) {
  const blurred = await sharp(base)
    .extract({ left: x, top: y, width: w, height: h })
    .blur(Math.max(8, Math.round(h * 0.35)))
    .modulate({ brightness: 1.08, saturation: 1.2 })
    .png()
    .toBuffer();
  return sharp(blurred)
    .composite([{ input: roundedMask(w, h, r), blend: "dest-in" }])
    .png()
    .toBuffer();
}

/** Fundo claro pede vidro mais escuro para o texto branco continuar legível. */
async function tintFor(base: Buffer, x: number, y: number, w: number, h: number) {
  const st = await sharp(base).extract({ left: x, top: y, width: w, height: h }).stats();
  const [r, g, b] = st.channels;
  const lum = (0.2126 * r.mean + 0.7152 * g.mean + 0.0722 * b.mean) / 255;
  return 0.16 + 0.34 * Math.max(0, Math.min(1, (lum - 0.45) / 0.45));
}

/** Brilho, borda e sombra do vidro + conteúdo (SVG por cima do tile desfocado). */
function glassChrome(w: number, h: number, r: number, inner: string, s: number, tint = 0.18) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.38"/>
      <stop offset="0.55" stop-color="#ffffff" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.08"/>
    </linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.55"/>
    </linearGradient>
    <filter id="t" x="-20%" y="-50%" width="140%" height="200%">
      <feDropShadow dx="0" dy="${1.5 * s}" stdDeviation="${2.5 * s}" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="rgb(20,20,28)" fill-opacity="${tint.toFixed(2)}"/>
  <rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="url(#g)"/>
  <rect x="${s}" y="${s}" width="${w - 2 * s}" height="${h - 2 * s}" rx="${r - s}" ry="${r - s}" fill="none" stroke="url(#b)" stroke-width="${1.6 * s}"/>
  <g filter="url(#t)">${inner}</g>
</svg>`);
}

/** Sombra suave embaixo da etiqueta, para destacar do fundo. */
function dropShadow(w: number, h: number, r: number, s: number) {
  const pad = Math.round(24 * s);
  return {
    pad,
    svg: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w + pad * 2}" height="${h + pad * 2}">
      <defs><filter id="f"><feGaussianBlur stdDeviation="${10 * s}"/></filter></defs>
      <rect x="${pad}" y="${pad + 6 * s}" width="${w}" height="${h}" rx="${r}" fill="#000" fill-opacity="0.28" filter="url(#f)"/>
    </svg>`),
  };
}

async function circleAvatar(buf: Buffer, size: number) {
  return sharp(buf, { failOn: "none" })
    .resize(size, size, { fit: "cover" })
    .composite([
      {
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
}

/** Mede a largura aproximada de um texto renderizado (para dimensionar a etiqueta). */
async function textWidth(text: string, size: number, weight: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(size * text.length * 0.9 + 20)}" height="${Math.ceil(size * 1.6)}"><text x="0" y="${size}" font-family="Inter, DejaVu Sans, sans-serif" font-size="${size}" font-weight="${weight}" fill="#000">${esc(text)}</text></svg>`;
  const { info } = await sharp(Buffer.from(svg)).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true }).catch(() => ({ info: { width: size * text.length * 0.6 } }));
  return info.width as number;
}

/**
 * Aplica a identidade do grupo na foto:
 * - canto inferior esquerdo: etiqueta de vidro com o desconto (-32%)
 * - canto superior direito: etiqueta de vidro com foto do grupo, nome e @ do Instagram
 */
export async function brandImage(input: Buffer, o: BrandOptions): Promise<Buffer> {
  const maxSize = o.maxSize || 1600;
  const base = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(maxSize, maxSize, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const { width: W = 1080, height: H = 1080 } = await sharp(base).metadata();
  const s = Math.min(W, H) / 1080; // escala relativa a uma imagem de 1080px
  const margin = Math.round(36 * s);
  const layers: OverlayOptions[] = [];
  const font = `font-family="Inter, DejaVu Sans, sans-serif"`;

  // ---------- etiqueta do grupo (superior direita)
  {
    const nameSize = Math.round(30 * s);
    const igSize = Math.round(23 * s);
    const avatarSize = Math.round(68 * s);
    const padX = Math.round(16 * s);
    const gap = Math.round(14 * s);
    const name = o.groupName.length > 26 ? o.groupName.slice(0, 25) + "…" : o.groupName;
    const ig = o.instagram ? (o.instagram.startsWith("@") ? o.instagram : `@${o.instagram}`) : "";
    const tw = Math.max(await textWidth(name, nameSize, 700), ig ? await textWidth(ig, igSize, 500) : 0);
    const h = Math.round(avatarSize + 2 * 12 * s);
    const w = Math.min(W - 2 * margin, Math.round(padX + avatarSize + gap + tw + padX * 1.6));
    const r = Math.round(h / 2);
    const x = W - margin - w;
    const y = margin;
    const textX = padX + avatarSize + gap;
    const inner = ig
      ? `<text x="${textX}" y="${h / 2 - 4 * s}" ${font} font-size="${nameSize}" font-weight="700" fill="#fff">${esc(name)}</text>
         <text x="${textX}" y="${h / 2 + igSize + 2 * s}" ${font} font-size="${igSize}" font-weight="500" fill="#fff" fill-opacity="0.9">${esc(ig)}</text>`
      : `<text x="${textX}" y="${h / 2 + nameSize * 0.36}" ${font} font-size="${nameSize}" font-weight="700" fill="#fff">${esc(name)}</text>`;
    const sh = dropShadow(w, h, r, s);
    layers.push({ input: sh.svg, left: Math.max(0, x - sh.pad), top: Math.max(0, y - sh.pad) });
    layers.push({ input: await glassTile(base, x, y, w, h, r), left: x, top: y });
    layers.push({ input: glassChrome(w, h, r, inner, s, await tintFor(base, x, y, w, h)), left: x, top: y });
    const av = o.avatar ? await circleAvatar(o.avatar, avatarSize).catch(() => null) : null;
    const ay = y + Math.round((h - avatarSize) / 2);
    if (av) {
      layers.push({ input: av, left: x + padX, top: ay });
      layers.push({
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${avatarSize}" height="${avatarSize}"><circle cx="${avatarSize / 2}" cy="${avatarSize / 2}" r="${avatarSize / 2 - s}" fill="none" stroke="#fff" stroke-opacity="0.8" stroke-width="${2 * s}"/></svg>`),
        left: x + padX,
        top: ay,
      });
    } else {
      const initials = esc(o.groupName.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "★");
      layers.push({
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${avatarSize}" height="${avatarSize}"><circle cx="${avatarSize / 2}" cy="${avatarSize / 2}" r="${avatarSize / 2}" fill="#ffffff" fill-opacity="0.9"/><text x="50%" y="50%" dy="0.35em" text-anchor="middle" ${font} font-size="${avatarSize * 0.38}" font-weight="800" fill="#111">${initials}</text></svg>`),
        left: x + padX,
        top: ay,
      });
    }
  }

  // ---------- etiqueta de desconto (inferior esquerda): "BAIXOU" em cima, seta + porcentagem embaixo
  if (o.discountPct && o.discountPct > 0) {
    const big = Math.round(66 * s);
    const small = Math.round(20 * s);
    const label = `-${Math.round(o.discountPct)}%`;
    const tw = await textWidth(label, big, 800);
    const padX = Math.round(24 * s);
    const padTop = Math.round(20 * s);
    const arrow = Math.round(46 * s);
    const gap = Math.round(14 * s);
    const rowY = padTop + small + Math.round(12 * s); // topo da linha principal
    const rowH = Math.round(big * 0.95);
    const h = rowY + rowH + Math.round(18 * s);
    const w = Math.round(padX + arrow + gap + tw + padX * 1.1);
    const r = Math.round(28 * s);
    const x = margin;
    const y = H - margin - h;
    const ay = rowY + (rowH - arrow) / 2;
    const inner = `
      <text x="${padX}" y="${padTop + small * 0.85}" ${font} font-size="${small}" font-weight="700" letter-spacing="${2.2 * s}" fill="#fff" fill-opacity="0.9">BAIXOU</text>
      <g transform="translate(${padX},${ay})">
        <circle cx="${arrow / 2}" cy="${arrow / 2}" r="${arrow / 2}" fill="#22c55e"/>
        <path d="M ${arrow / 2} ${arrow * 0.24} L ${arrow / 2} ${arrow * 0.72} M ${arrow * 0.3} ${arrow * 0.52} L ${arrow / 2} ${arrow * 0.74} L ${arrow * 0.7} ${arrow * 0.52}" stroke="#fff" stroke-width="${4.2 * s}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </g>
      <text x="${padX + arrow + gap}" y="${rowY + rowH * 0.86}" ${font} font-size="${big}" font-weight="800" letter-spacing="${-1 * s}" fill="#fff">${esc(label)}</text>`;
    const sh = dropShadow(w, h, r, s);
    layers.push({ input: sh.svg, left: Math.max(0, x - sh.pad), top: Math.max(0, y - sh.pad) });
    layers.push({ input: await glassTile(base, x, y, w, h, r), left: x, top: y });
    layers.push({ input: glassChrome(w, h, r, inner, s, await tintFor(base, x, y, w, h)), left: x, top: y });
  }

  return sharp(base).composite(layers).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
