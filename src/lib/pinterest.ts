/**
 * Fotos de perfume achadas no Pinterest (busca pelo site, sem API oficial).
 * - Busca "nome do perfume" e pega as fotos originais (maior resolução) dos pins.
 * - Confere se o título do pin bate com o perfume (sem misturar Salvo com Salvo Intense).
 * - Guarda como candidata: só entra no banco de fotos do perfume quando o Arthur aprova na tela Fotos.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, log, MEDIA_DIR } from "./db.ts";
import { BRAND_WORDS, FLANKERS, STOP, nameTokens, norm } from "./perfume.ts";
import { analyzeImage } from "./images.ts";

const DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, "pinterest");
const UA_ = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MIN_SIDE = 700;

type Pin = { url: string; title: string };

/**
 * Busca pins pelo Apify (robô "thescrappa/pinterest-search-scraper", ~US$0,0002 por pin).
 * Precisa de APIFY_TOKEN nas variáveis do Railway.
 */
export async function searchPins(query: string, limit = 40): Promise<Pin[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("falta APIFY_TOKEN nas variáveis do Railway");
  const r = await fetch(
    `https://api.apify.com/v2/acts/thescrappa~pinterest-search-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=120`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: [query], limit }), signal: AbortSignal.timeout(150000) },
  );
  if (!r.ok) throw new Error(`Apify respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const items = (await r.json()) as { title?: string; description?: string; image_url?: string; images?: Record<string, { url?: string }> }[];
  return items
    .map((x) => ({ url: x.images?.orig?.url || x.image_url || "", title: [x.title, x.description].filter(Boolean).join(" · ") }))
    .filter((x) => x.url);
}

/** Mesma palavra com até 2 letras de diferença (Shyaaka x Shiyaaka). */
function near(a: string, b: string) {
  if (a === b) return true;
  if (a.length < 5 || a[0] !== b[0] || Math.abs(a.length - b.length) > 2) return false;
  const max = Math.min(a.length, b.length) >= 8 ? 2 : 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= max;
}

/** O título do pin fala do mesmo perfume? (com título vazio, deixa para o Arthur decidir) */
function titleMatches(product: string, title: string) {
  if (!title) return true;
  const want = nameTokens(product);
  const t = new Set(norm(title).split(" "));
  if (!want.length) return true;
  const hit = want.filter((w) => [...t].some((x) => near(w, x))).length;
  if (hit / want.length < 0.6) return false;
  for (const f of FLANKERS) if (want.includes(f) !== t.has(f)) return false;
  return true;
}

/** Busca no Pinterest e guarda até `max` fotos candidatas do perfume. Devolve quantas novas. */
export async function findPinPhotos(productId: number, max = 10): Promise<number> {
  const p = db().prepare("SELECT name FROM products WHERE id = ?").get(productId) as { name: string } | undefined;
  if (!p) return 0;
  const query = `${p.name.replace(/\b\d{2,4}\s*ml\b/gi, "").replace(/\s+/g, " ").trim()} perfume`;
  const pins = (await searchPins(query)).filter((x) => titleMatches(p.name, x.title));
  const n = await savePins(productId, pins, max);
  await checkPins(productId).catch(() => undefined);
  log("info", `Pinterest: "${query}" → ${pins.length} pin(s) do mesmo perfume, ${n} foto(s) boas para você aprovar`);
  return n;
}

/** Baixa as fotos dos pins e guarda como candidatas do perfume. */
export async function savePins(productId: number, pins: Pin[], max = 10): Promise<number> {
  fs.mkdirSync(DIR, { recursive: true });
  let n = 0;
  for (const pin of pins) {
    if (n >= max) break;
    if (db().prepare("SELECT 1 FROM pin_photos WHERE product_id = ? AND url = ?").get(productId, pin.url)) continue;
    try {
      const r = await fetch(pin.url, { headers: { "user-agent": UA_ }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const meta = await sharp(buf).metadata();
      const w = meta.width || 0, h = meta.height || 0;
      if (Math.min(w, h) < MIN_SIDE) continue;
      // muito comprida (montagem, story com texto): fora
      if (Math.max(w, h) / Math.min(w, h) > 1.6) continue;
      const file = path.join(DIR, `${productId}_${Date.now()}_${n}.jpg`);
      const jpg = await sharp(buf).rotate().jpeg({ quality: 92 }).toBuffer();
      fs.writeFileSync(file, jpg);
      // nota: a mesma da escolha automática (fundo, nitidez, enquadramento), quadrada vale mais
      const a = await analyzeImage(jpg).catch(() => null);
      const score = Math.round((a?.score || 0) - 70 * Math.abs(Math.log(w / h)) + (Math.min(w, h) >= 1000 ? 10 : 0));
      db().prepare("INSERT INTO pin_photos (product_id, url, path, width, height, title, score) VALUES (?, ?, ?, ?, ?, ?, ?)").run(productId, pin.url, file, w, h, pin.title.slice(0, 300), score);
      n++;
    } catch {
      /* foto que não baixa: pula */
    }
  }
  return n;
}

/** Teste: perfumes das promoções com menos de 2 fotos no banco. */
export async function pinTestBatch(limit = 10) {
  const { ranking } = await import("./curation.ts");
  const items = ranking()
    .filter((i) => i.best && i.images < 2)
    .slice(0, limit);
  let total = 0;
  for (const it of items) total += await findPinPhotos(it.productId).catch((e) => (log("warn", `Pinterest (${it.name}): ${(e as Error).message}`), 0));
  log("info", `Pinterest (teste): ${total} foto(s) de ${items.length} perfume(s) esperando aprovação na tela Fotos`);
}

export function listPins(status = "pending") {
  return db()
    .prepare(
      `SELECT f.id, f.product_id, p.name, f.width, f.height, f.title, f.status, f.created_at, f.score, f.flags, f.ref_sim,
        f.id = (SELECT x.id FROM pin_photos x WHERE x.product_id = f.product_id AND x.status = 'pending' AND x.flags IS NULL ORDER BY x.score DESC LIMIT 1) pick,
        (SELECT COUNT(*) FROM images i WHERE i.product_id = f.product_id AND i.disabled = 0) bank
       FROM pin_photos f JOIN products p ON p.id = f.product_id WHERE f.status = ? ORDER BY f.product_id, f.flags IS NOT NULL, f.score DESC LIMIT 300`,
    )
    .all(status);
}

export function pinFile(id: number): string | null {
  const r = db().prepare("SELECT path FROM pin_photos WHERE id = ?").get(id) as { path: string } | undefined;
  return r && fs.existsSync(r.path) ? r.path : null;
}

/**
 * Automático (só depois do Arthur autorizar, state pinAuto = "1"): perfume das promoções sem foto principal
 * ganha a melhor foto do Pinterest como principal, para sempre (ele pode trocar na tela Fotos).
 * Um perfume por vez, cada um buscado uma vez só.
 */
export async function pinAutoStep() {
  const { getState } = await import("./settings.ts");
  if (getState("pinAuto") !== "1") return;
  const g = globalThis as { __pinBusy?: boolean };
  if (g.__pinBusy) return;
  g.__pinBusy = true;
  try {
    await pinAutoOne();
  } finally {
    g.__pinBusy = false;
  }
}

async function pinAutoOne() {
  const { ranking } = await import("./curation.ts");
  const item = ranking().find(
    (i) =>
      i.best &&
      !db().prepare("SELECT main_image_id m FROM products WHERE id = ?").get(i.productId)?.m &&
      !db().prepare("SELECT 1 FROM pin_photos WHERE product_id = ?").get(i.productId),
  );
  if (!item) return;
  const n = await findPinPhotos(item.productId);
  if (!n) {
    // marca como buscado, para não repetir
    db().prepare("INSERT OR IGNORE INTO pin_photos (product_id, url, path, width, height, status) VALUES (?, 'none', '', 0, 0, 'rejected')").run(item.productId);
    return;
  }
  const cands = db().prepare("SELECT id, path, score, width, height FROM pin_photos WHERE product_id = ? AND status = 'pending' AND flags IS NULL").all(item.productId) as {
    id: number; path: string; score: number; width: number; height: number;
  }[];
  if (!cands.length) {
    log("info", `Pinterest: nenhuma foto com certeza de ser ${item.name}; fica para você escolher`);
    return;
  }
  const { autoPhotoScore, featuresOf } = await import("./photoprefs.ts");
  let best = cands[0], bestScore = -Infinity;
  for (const c of cands) {
    const a = await analyzeImage(fs.readFileSync(c.path)).catch(() => null);
    const v = autoPhotoScore({ path: c.path, score: c.score, width: c.width, height: c.height, feat: a ? JSON.stringify(featuresOf(a)) : null });
    if (v > bestScore) { bestScore = v; best = c; }
  }
  await chooseMain(best.id);
  log("info", `Pinterest: foto principal escolhida para ${item.name}`);
}

/**
 * O Arthur escolheu a melhor do perfume: ela vira a principal (para sempre, até ele trocar).
 * As outras do perfume entram no banco desligadas: não vão para posts, mas ensinam o gosto dele.
 */
export async function chooseMain(id: number): Promise<string> {
  const r = db().prepare("SELECT product_id FROM pin_photos WHERE id = ?").get(id) as { product_id: number } | undefined;
  if (!r) throw new Error("foto não encontrada");
  const msg = await decidePin(id, true, true);
  const { addImage } = await import("./curation.ts");
  const others = db().prepare("SELECT id, path FROM pin_photos WHERE product_id = ? AND status = 'pending'").all(r.product_id) as { id: number; path: string }[];
  for (const o of others) {
    await addImage(r.product_id, fs.readFileSync(o.path), `pin:${o.id}`).catch(() => "");
    db().prepare("UPDATE images SET disabled = 1 WHERE product_id = ? AND message_id = ?").run(r.product_id, `pin:${o.id}`);
    db().prepare("UPDATE pin_photos SET status = 'rejected' WHERE id = ?").run(o.id);
  }
  const { learnPrefs } = await import("./photoprefs.ts");
  learnPrefs();
  return msg;
}

export async function decidePin(id: number, ok: boolean, asMain = false): Promise<string> {
  const r = db().prepare("SELECT product_id, path FROM pin_photos WHERE id = ? AND status = 'pending'").get(id) as { product_id: number; path: string } | undefined;
  if (!r) throw new Error("foto não encontrada");
  if (!ok) {
    db().prepare("UPDATE pin_photos SET status = 'rejected' WHERE id = ?").run(id);
    return "recusada";
  }
  const { addImage } = await import("./curation.ts");
  const msg = await addImage(r.product_id, fs.readFileSync(r.path), `pin:${id}`);
  db().prepare("UPDATE pin_photos SET status = 'approved' WHERE id = ?").run(id);
  if (asMain) {
    const img = db().prepare("SELECT id FROM images WHERE product_id = ? AND message_id = ?").get(r.product_id, `pin:${id}`) as { id: number } | undefined;
    if (img) db().prepare("UPDATE products SET main_image_id = ? WHERE id = ?").run(img.id, r.product_id);
  }
  return msg;
}

/** Fotos do Pinterest já buscadas (pelo Apify, fora do servidor) para o primeiro teste: entram para aprovação. */
export async function importPinSeed() {
  const { getState, setState } = await import("./settings.ts");
  if (getState("pinSeedV1")) return;
  setState("pinSeedV1", "1");
  const seed = (await import("../data/pin-seed.json")).default as { name: string; pins: Pin[] }[];
  let total = 0, found = 0;
  for (const e of seed) {
    let p = db().prepare("SELECT id FROM products WHERE name = ?").get(e.name) as { id: number } | undefined;
    if (!p) {
      const want = nameTokens(e.name);
      const rows = db().prepare("SELECT id, name FROM products").all() as { id: number; name: string }[];
      let best = 0;
      for (const r of rows) {
        const t = nameTokens(r.name);
        const inter = want.filter((w) => t.includes(w)).length;
        const sc = inter / Math.max(1, new Set([...want, ...t]).size);
        if (sc > best) { best = sc; p = { id: r.id }; }
      }
      if (best < 0.6) p = undefined;
    }
    if (!p) { log("warn", `Pinterest (teste): perfume não achado no banco: ${e.name}`); continue; }
    found++;
    total += await savePins(p.id, e.pins, 10);
    await checkPins(p.id).catch(() => undefined);
  }
  log("info", `Pinterest (teste): ${total} foto(s) de ${found} perfume(s) esperando você na tela Fotos → "Pinterest: aprovar"`);
}

/* ------------------------------------------------------------------ */
/* Precisão: é mesmo ESSE perfume? (nome e cor do frasco)               */
/* ------------------------------------------------------------------ */

/** Palavras que aparecem em título de pin sem mudar o perfume. Qualquer outra palavra a mais indica outro perfume. */
const GENERIC = new Set(
  `by for of the de da do del des le la les los las y and et und with com por para sur en in to from new novo nova
  spray vapo vaporisateur oz fl floz ml mls edp edt parfum perfume perfumes parfums profumo fragrance fragrances fragancia
  fragrancia cologne colonia eau toilette agua water men mens man woman women womens homme femme hombre mujer masculino
  masculina feminino feminina unisex unissex unisexe gift set box caixa original originais originale authentic genuine
  importado importada arabe arabic arabian oriental dubai uae emirates review resenha notes notas longevity duracao
  luxury luxo long lasting lasting duradero duradera duradouro fixacao premium best melhor top sample decant amostra
  limited edition edicao tester shop store loja buy comprar price preco oferta promo promocao sale desconto deal
  pure intenso intensa elegant elegante fresh fresco fresca sweet doce floral woody amadeirado citrico citrus aroma
  scent cheiro presente regalo cadeau x for him her ela ele dele dela pour per seu sua inspired inspiracao clone dupe
  version versao alternative eau de parfum spray natural vaporizador mercado livre mercadolivre amazon shopee
  everyone todos incolor colorless netshoes walmart target ebay jomashop sephora macys shein aliexpress allegro magalu
  americanas casas bahia beleza belezanaweb epoca cosmeticos perfumaria perfumes perfumery spray frasco bottle`.split(/\s+/).filter(Boolean),
);

/** Palavras a mais no título do pin que não são do perfume (ex: "Safeer" num pin de "Al Noble Ameer"). */
export function extraWords(product: string, title: string): string[] {
  if (!title) return [];
  const mine = new Set(norm(product).split(" "));
  return [
    ...new Set(
      norm(title)
        .split(" ")
        .filter((w) => w.length > 2 && !/\d/.test(w) && ![...mine].some((x) => near(w, x)) && !GENERIC.has(w) && !STOP.has(w) && !BRAND_WORDS.has(w)),
    ),
  ];
}

/** Assinatura de cor do centro da foto (onde fica o frasco): matizes das partes coloridas + cores gerais. */
async function colorSig(buf: Buffer): Promise<{ hue: number[]; rgb: number[]; colored: number }> {
  const img = sharp(buf).rotate();
  const m = await img.metadata();
  const w = m.width || 1, h = m.height || 1;
  const cw = Math.round(w * 0.7), ch = Math.round(h * 0.7);
  const { data } = await sharp(buf).rotate().extract({ left: Math.round((w - cw) / 2), top: Math.round((h - ch) / 2), width: cw, height: ch })
    .resize(40, 40, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const hue = new Array(12).fill(0), rgb = new Array(27).fill(0);
  let colored = 0, n = 0;
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mn > 0.88) continue; // fundo branco
    n++;
    rgb[Math.min(2, (r * 3) | 0) * 9 + Math.min(2, (g * 3) | 0) * 3 + Math.min(2, (b * 3) | 0)]++;
    const sat = mx ? (mx - mn) / mx : 0;
    if (sat > 0.3 && mx > 0.2) {
      let hh = 0;
      const d = mx - mn;
      if (mx === r) hh = ((g - b) / d) % 6;
      else if (mx === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      hue[(((hh * 60 + 360) % 360) / 30) | 0]++;
      colored++;
    }
  }
  const nh = hue.reduce((a, b) => a + b, 0) || 1, nr = n || 1;
  return { hue: hue.map((x) => x / nh), rgb: rgb.map((x) => x / nr), colored: colored / nr };
}

function sigSim(a: Awaited<ReturnType<typeof colorSig>>, b: Awaited<ReturnType<typeof colorSig>>) {
  const inter = (x: number[], y: number[]) => x.reduce((s, v, i) => s + Math.min(v, y[i]), 0);
  const rgb = inter(a.rgb, b.rgb);
  // as duas com cor (frasco verde, amarelo…): a matiz manda
  if (a.colored > 0.08 && b.colored > 0.08) return 0.65 * inter(a.hue, b.hue) + 0.35 * rgb;
  // uma colorida e a outra não (frasco preto/transparente): diferença de cor também conta
  if ((a.colored > 0.15) !== (b.colored > 0.15)) return 0.6 * rgb;
  return rgb;
}

/** Foto de referência do perfume certo: a melhor foto dos grupos no banco ou, sem ela, a foto do anúncio do ML. */
export async function refImage(productId: number): Promise<Buffer | null> {
  const file = path.join(DIR, `ref_${productId}.jpg`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  fs.mkdirSync(DIR, { recursive: true });
  const bank = db()
    .prepare("SELECT path FROM images WHERE product_id = ? AND (message_id IS NULL OR message_id NOT LIKE 'pin:%') ORDER BY disabled, score DESC LIMIT 1")
    .get(productId) as { path: string } | undefined;
  let buf: Buffer | null = bank && fs.existsSync(bank.path) ? fs.readFileSync(bank.path) : null;
  if (!buf) {
    const { extractUrls, isMeliUrl, resolveRedirects, fetchHtml, findOgImage } = await import("./links.ts");
    const offers = db().prepare("SELECT text FROM offers WHERE product_id = ? ORDER BY id DESC LIMIT 5").all(productId) as { text: string }[];
    for (const o of offers) {
      const u = extractUrls(o.text).find((x) => isMeliUrl(x));
      if (!u) continue;
      try {
        const img = findOgImage(await fetchHtml(await resolveRedirects(u)));
        if (!img) continue;
        const r = await fetch(img, { headers: { "user-agent": UA_ }, signal: AbortSignal.timeout(15000) });
        if (r.ok) { buf = Buffer.from(await r.arrayBuffer()); break; }
      } catch {
        /* tenta a próxima */
      }
    }
  }
  if (buf) fs.writeFileSync(file, await sharp(buf).rotate().jpeg({ quality: 90 }).toBuffer());
  return buf;
}

/**
 * Confere as candidatas de um perfume: palavras a mais no nome e cor diferente da referência
 * (ou, sem referência, da maioria das candidatas). Marca em `flags`; as marcadas ficam fora do automático.
 */
export async function checkPins(productId: number) {
  const p = db().prepare("SELECT name FROM products WHERE id = ?").get(productId) as { name: string } | undefined;
  if (!p) return;
  const rows = db().prepare("SELECT id, path, title FROM pin_photos WHERE product_id = ? AND status = 'pending'").all(productId) as {
    id: number; path: string; title: string | null;
  }[];
  if (!rows.length) return;
  const sigs = await Promise.all(rows.map((r) => (fs.existsSync(r.path) ? colorSig(fs.readFileSync(r.path)).catch(() => null) : null)));
  const ref = await refImage(productId).catch(() => null);
  const refSig = ref ? await colorSig(ref).catch(() => null) : null;
  rows.forEach((r, i) => {
    const flags: string[] = [];
    const extra = extraWords(p.name, r.title || "");
    if (!r.title) flags.push("pin sem nome");
    else if (extra.length) flags.push(`nome diferente: ${extra.slice(0, 3).join(", ")}`);
    let sim: number | null = null;
    const s = sigs[i];
    if (s && refSig) sim = sigSim(s, refSig);
    else if (s) {
      const others = sigs.filter((x, j) => x && j !== i) as NonNullable<(typeof sigs)[number]>[];
      if (others.length >= 2) {
        const v = others.map((o) => sigSim(s, o)).sort((a, b) => b - a);
        sim = v[Math.floor(v.length / 2)]; // parecida com a maioria?
      }
    }
    if (sim != null && sim < 0.4) flags.push(refSig ? "cor diferente da referência" : "cor diferente das outras");
    db().prepare("UPDATE pin_photos SET ref_sim = ?, flags = ? WHERE id = ?").run(sim, flags.length ? flags.join(" · ") : null, r.id);
  });
}

/** Uma vez: confere as fotos do primeiro teste com as regras de precisão. */
export async function recheckAllPins() {
  const { getState, setState } = await import("./settings.ts");
  if (getState("pinCheckV1")) return;
  setState("pinCheckV1", "1");
  const ids = db().prepare("SELECT DISTINCT product_id FROM pin_photos WHERE status = 'pending'").all() as { product_id: number }[];
  for (const r of ids) await checkPins(r.product_id).catch((e) => log("warn", `Pinterest: conferência falhou: ${(e as Error).message}`));
  const bad = (db().prepare("SELECT COUNT(*) n FROM pin_photos WHERE status = 'pending' AND flags IS NOT NULL").get() as { n: number }).n;
  log("info", `Pinterest: conferi ${ids.length} perfume(s); ${bad} foto(s) marcadas como possivelmente de outro perfume`);
}
