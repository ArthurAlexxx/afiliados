/**
 * Fotos de grupos com marca d'água, refeitas pela IA.
 *
 * 1. Só entra na fila quando o perfume tem poucas fotos limpas no banco (menos de 2).
 * 2. Detecção: um modelo de visão olha a foto (junto com a marca de referência do grupo, quando já
 *    existe) e diz se tem marca d'água e onde ela está. Sem marca → a foto é ignorada (não gasta edição).
 * 3. Edição: o modelo de imagem recebe a foto, a marca de referência e uma máscara só em volta da marca.
 * 4. O resultado é recolado sobre a original usando a mesma máscara (borda suave): fora da marca,
 *    os pixels continuam exatamente os da foto original. Frasco e rótulo não mudam.
 * 5. Nada vai para o grupo sem aprovação: aprovada, a foto entra no banco do perfume e passa a ser
 *    usada nos próximos posts. Recusada: na próxima oferta do perfume, a IA tenta de novo.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, log, MEDIA_DIR } from "./db.ts";
import { getSettings, getState, setState } from "./settings.ts";
import { addImage } from "./curation.ts";

const FIX_DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, "fix");

export type Corner = "top-right" | "top-left" | "bottom-right" | "bottom-left";
export const CORNERS: Corner[] = ["top-right", "top-left", "bottom-right", "bottom-left"];
/** Caixa da marca em fração da imagem: [x0, y0, x1, y1]. */
type Box = [number, number, number, number];

/** Área do canto usada quando a detecção não devolve caixa. */
const AREA_W = 0.34;
const AREA_H = 0.22;

const editPrompt = (hasRef: boolean, desc: string) => `Remove the watermark from the FIRST image. ${
  hasRef
    ? "The SECOND image is only a reference sample of that exact watermark (the logo/stamp a WhatsApp deals group puts on its photos) so you know precisely what to erase. Do not copy anything from the second image into the result."
    : ""
}${desc ? ` The watermark looks like: ${desc}.` : ""}

Inside the masked area, erase every part of the watermark (logo, icon, @handle, text, its semi-transparent background box and its shadow) and fill it with the natural background that surrounds it, continuing the same colors, gradients, lighting, shadows, sand/sky/table/texture and blur.

Strict rules:
- Edit ONLY the masked area. Everything outside it must stay identical.
- Remove the watermark COMPLETELY: no leftover letters, outlines, ghosting or smudges.
- Do not add any new text, logo, watermark, price, sticker, emoji or border.
- Do not alter, redraw, move or resize the perfume bottle, cap, box, label, brand name or any product text.
- If the masked area overlaps the product, reconstruct the product exactly as it appears in the rest of the image (same shape, color, reflections and text), never invent new details.
- Keep the original framing, perspective and aspect ratio. Do not warp or stretch the background.
- The result must look like an untouched original product photo.`;

const todayKey = () => `imageFixCount:${new Date().toISOString().slice(0, 10)}`;
const keyOf = () => getSettings().openaiApiKey || process.env.OPENAI_API_KEY || "";

function cornerBox(corner: Corner): Box {
  const x0 = corner.endsWith("right") ? 1 - AREA_W : 0;
  const y0 = corner.startsWith("bottom") ? 1 - AREA_H : 0;
  return [x0, y0, x0 + AREA_W, y0 + AREA_H];
}

/** Caixa em pixels, com folga em volta (a detecção nunca é perfeita). */
function pxBox(b: Box, W: number, H: number, padFrac: number) {
  const pw = (b[2] - b[0]) * W * padFrac + W * 0.015;
  const ph = (b[3] - b[1]) * H * padFrac + H * 0.015;
  const x = Math.max(0, Math.floor(b[0] * W - pw));
  const y = Math.max(0, Math.floor(b[1] * H - ph));
  const x1 = Math.min(W, Math.ceil(b[2] * W + pw));
  const y1 = Math.min(H, Math.ceil(b[3] * H + ph));
  return { x, y, w: Math.max(8, x1 - x), h: Math.max(8, y1 - y) };
}

/* ------------------------------------------------------------------ */
/* Fila                                                                 */
/* ------------------------------------------------------------------ */

/** Coloca na fila uma foto de grupo com marca d'água, se o perfume precisar de foto. */
export async function queueImageFix(o: { productId: number; image: Buffer; messageId?: string; groupJid: string; groupName?: string }): Promise<string> {
  const s = getSettings();
  if (!s.imageFixEnabled) return "";
  const clean = (db().prepare("SELECT COUNT(*) n FROM images WHERE product_id = ? AND disabled = 0").get(o.productId) as { n: number }).n;
  if (clean >= 2) return "";
  const open = db()
    .prepare("SELECT COUNT(*) n FROM image_fixes WHERE product_id = ? AND status IN ('queued','ready')")
    .get(o.productId) as { n: number };
  if (open.n) return "";
  // recusada: tenta de novo na próxima oferta (com limite, para não gastar à toa num perfume difícil)
  const tries = db()
    .prepare("SELECT COUNT(*) n FROM image_fixes WHERE product_id = ? AND status IN ('rejected','failed')")
    .get(o.productId) as { n: number };
  if (tries.n >= 6) return "";

  const meta = await sharp(o.image, { failOn: "none" }).metadata();
  if (Math.min(meta.width || 0, meta.height || 0) < 500) return "";

  const g = db().prepare("SELECT wm_corner FROM groups WHERE jid = ?").get(o.groupJid) as { wm_corner?: string } | undefined;
  const corner = (CORNERS.includes(g?.wm_corner as Corner) ? g!.wm_corner : "top-right") as Corner;

  fs.mkdirSync(FIX_DIR, { recursive: true });
  const src = path.join(/*turbopackIgnore: true*/ FIX_DIR, `src_${o.productId}_${Date.now()}.jpg`);
  fs.writeFileSync(src, await sharp(o.image, { failOn: "none" }).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer());
  db()
    .prepare("INSERT INTO image_fixes (product_id, group_jid, group_name, message_id, corner, src_path) VALUES (?, ?, ?, ?, ?, ?)")
    .run(o.productId, o.groupJid, o.groupName || null, o.messageId || null, corner, src);
  return "foto do grupo com marca d'água na fila da IA";
}

/* ------------------------------------------------------------------ */
/* Modelos da OpenAI                                                    */
/* ------------------------------------------------------------------ */

async function modelIds(key: string): Promise<string[]> {
  const cached = getState("openaiModels");
  if (cached) {
    const { at, ids } = JSON.parse(cached) as { at: number; ids: string[] };
    if (Date.now() - at < 6 * 3600e3 && ids.length) return ids;
  }
  try {
    const r = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    const j = (await r.json()) as { data?: { id: string }[] };
    const ids = (j.data || []).map((d) => d.id);
    if (ids.length) setState("openaiModels", JSON.stringify({ at: Date.now(), ids }));
    return ids;
  } catch {
    return [];
  }
}

const IMAGE_PREF = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"];
const VISION_PREF = ["gpt-5-mini", "gpt-5.1-mini", "gpt-5.2-mini", "gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-4o"];

async function pickImageModel(key: string, configured?: string) {
  const ids = await modelIds(key);
  if (!ids.length) return configured || "gpt-image-1";
  const m = [configured, ...IMAGE_PREF].filter(Boolean).find((p) => ids.includes(p!)) || ids.find((i) => /^gpt-image/.test(i));
  if (!m) throw new Error("a conta da OpenAI não tem modelo de imagem liberado");
  return m;
}

async function pickVisionModel(key: string) {
  const ids = await modelIds(key);
  if (!ids.length) return "gpt-4.1-mini";
  return VISION_PREF.find((p) => ids.includes(p)) || ids.find((i) => /^gpt-5(\.\d+)?-mini$/.test(i)) || ids.find((i) => /^gpt-4\.1/.test(i)) || "gpt-4o-mini";
}

const dataUrl = (b: Buffer, mime = "image/jpeg") => `data:${mime};base64,${b.toString("base64")}`;

/* ------------------------------------------------------------------ */
/* Detecção                                                             */
/* ------------------------------------------------------------------ */

type Detection = { watermark: boolean; boxes: Box[]; description: string };

/** Pergunta ao modelo de visão se a foto tem a marca do grupo e onde ela está. */
export async function detectWatermark(src: Buffer, groupName: string, ref: Buffer | null): Promise<Detection> {
  const key = keyOf();
  const model = await pickVisionModel(key);
  const small = await sharp(src, { failOn: "none" }).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  const text = `The FIRST image is a perfume product photo reposted by the WhatsApp deals group "${groupName}". ${
    ref ? "The SECOND image is a sample of the watermark this group usually stamps on its photos. " : ""
  }Does the first image contain a watermark added by a deals group or reseller (a logo, @handle, group name, channel name, profile badge or text stamp overlaid on the photo)? The product's own label, box text, brand name and the store's own product-photo design are NOT watermarks.

Answer only JSON: {"watermark": true|false, "boxes": [[x0,y0,x1,y1], ...], "description": "short description of the watermark"}.
Coordinates are fractions of the first image width/height (0 to 1), top-left origin. Each box must cover the WHOLE watermark (including its background badge, shadow and every letter) with a small margin. Use an empty list when there is no watermark.`;
  const content: unknown[] = [{ type: "text", text }, { type: "image_url", image_url: { url: dataUrl(small), detail: "high" } }];
  if (ref) content.push({ type: "image_url", image_url: { url: dataUrl(ref, "image/png"), detail: "low" } });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(90_000),
  });
  const j = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(`detecção (${model}): ${j.error?.message || res.status}`);
  const raw = JSON.parse(j.choices?.[0]?.message?.content || "{}") as { watermark?: boolean; boxes?: number[][]; description?: string };
  const boxes = (raw.boxes || [])
    .filter((b) => Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number"))
    .map((b) => {
      // aceita também coordenadas em pixels da imagem reduzida
      const norm = b.some((n) => n > 1.5) ? b.map((n, i) => n / (i % 2 ? 1024 : 1024)) : b;
      const [x0, y0, x1, y1] = norm.map((n) => Math.min(1, Math.max(0, n)));
      return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)] as Box;
    })
    .filter((b) => b[2] - b[0] > 0.005 && b[3] - b[1] > 0.005 && (b[2] - b[0]) * (b[3] - b[1]) < 0.35);
  return { watermark: Boolean(raw.watermark) && boxes.length > 0, boxes, description: String(raw.description || "").slice(0, 200) };
}

/* ------------------------------------------------------------------ */
/* Edição                                                               */
/* ------------------------------------------------------------------ */

function apiSize(w: number, h: number): [number, number] {
  const r = w / h;
  if (r > 1.2) return [1536, 1024];
  if (r < 0.83) return [1024, 1536];
  return [1024, 1024];
}

/** Chama a OpenAI e devolve a foto final (já recolada sobre a original) e o uso de tokens. */
export async function fixImage(srcBuf: Buffer, boxes: Box[], ref: Buffer | null, desc: string): Promise<{ out: Buffer; usage: unknown; model: string }> {
  const s = getSettings();
  const key = keyOf();
  if (!key) throw new Error("sem chave da OpenAI");

  const orig = sharp(srcBuf, { failOn: "none" });
  const { width: W = 0, height: H = 0 } = await orig.metadata();
  const model = await pickImageModel(key, s.imageModel);
  const [aw, ah] = apiSize(W, H);

  // máscara no tamanho da API: transparente = pode editar (só em volta da marca)
  const holes = await Promise.all(
    boxes.map(async (b) => {
      const r = pxBox(b, aw, ah, 0.2);
      return {
        input: await sharp({ create: { width: r.w, height: r.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(),
        left: r.x,
        top: r.y,
        blend: "dest-out" as const,
      };
    }),
  );
  const maskPng = await sharp({ create: { width: aw, height: ah, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(holes)
    .png()
    .toBuffer();
  const imgPng = await sharp(srcBuf).resize(aw, ah, { fit: "fill" }).png().toBuffer();

  const form = new FormData();
  form.append("model", model);
  form.append("prompt", editPrompt(Boolean(ref), desc));
  form.append("n", "1");
  form.append("size", `${aw}x${ah}`);
  form.append("quality", "medium");
  form.append("image[]", new Blob([new Uint8Array(imgPng)], { type: "image/png" }), "image.png");
  if (ref) form.append("image[]", new Blob([new Uint8Array(ref)], { type: "image/png" }), "watermark.png");
  form.append("mask", new Blob([new Uint8Array(maskPng)], { type: "image/png" }), "mask.png");

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string }; usage?: unknown };
  if (!res.ok || !j.data?.[0]?.b64_json) throw new Error(j.error?.message || `OpenAI respondeu ${res.status}`);
  const out = Buffer.from(j.data[0].b64_json, "base64");

  // recola só a área da marca: fora dela fica a foto original, pixel a pixel
  const feather = Math.max(3, Math.round(Math.min(W, H) * 0.008));
  const rects = boxes
    .map((b) => {
      const r = pxBox(b, W, H, 0.2);
      return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="white"/>`;
    })
    .join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/>${rects}</svg>`);
  const alpha = await sharp(svg).resize(W, H).blur(feather).extractChannel(0).raw().toBuffer();
  // (o sharp aplica removeAlpha depois do joinChannel, então tira o alfa num passo separado)
  const rgb = await sharp(out).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const patch = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
  const final = await orig.rotate().flatten({ background: "#ffffff" }).composite([{ input: patch }]).jpeg({ quality: 92 }).toBuffer();
  return { out: final, usage: j.usage || null, model };
}

/* ------------------------------------------------------------------ */
/* Marca de referência por grupo                                        */
/* ------------------------------------------------------------------ */

function groupRef(jid: string | null): Buffer | null {
  if (!jid) return null;
  const g = db().prepare("SELECT wm_ref FROM groups WHERE jid = ?").get(jid) as { wm_ref?: string | null } | undefined;
  return g?.wm_ref && fs.existsSync(g.wm_ref) ? fs.readFileSync(g.wm_ref) : null;
}

/** Recorta a marca detectada nesta foto e guarda como referência do grupo. */
async function saveGroupRef(jid: string, src: Buffer, box: Box) {
  const { width: W = 0, height: H = 0 } = await sharp(src).metadata();
  const r = pxBox(box, W, H, 0.08);
  const crop = await sharp(src).extract({ left: r.x, top: r.y, width: Math.min(r.w, W - r.x), height: Math.min(r.h, H - r.y) }).png().toBuffer();
  fs.mkdirSync(FIX_DIR, { recursive: true });
  const file = path.join(/*turbopackIgnore: true*/ FIX_DIR, `ref_${jid.replace(/\W/g, "")}.png`);
  fs.writeFileSync(file, crop);
  db().prepare("UPDATE groups SET wm_ref = ? WHERE jid = ?").run(file, jid);
}

/** Usar a marca desta foto como referência do grupo (botão na tela Imagens). */
export async function setRefFromFix(id: number) {
  const r = db().prepare("SELECT group_jid, src_path, box FROM image_fixes WHERE id = ?").get(id) as
    | { group_jid: string; src_path: string; box: string | null }
    | undefined;
  if (!r?.box) throw new Error("essa foto não tem marca detectada");
  const boxes = JSON.parse(r.box) as Box[];
  await saveGroupRef(r.group_jid, fs.readFileSync(r.src_path), boxes[0]);
}

export function refFile(jid: string): string | null {
  const g = db().prepare("SELECT wm_ref FROM groups WHERE jid = ?").get(jid) as { wm_ref?: string | null } | undefined;
  return g?.wm_ref && fs.existsSync(g.wm_ref) ? g.wm_ref : null;
}

/* ------------------------------------------------------------------ */
/* Worker                                                               */
/* ------------------------------------------------------------------ */

/** Processa um item da fila por vez (o limite diário conta só as edições, que são o que custa). */
export async function processImageFixes() {
  const w = globalThis as { __afiliadosImageFixBusy?: boolean };
  if (w.__afiliadosImageFixBusy) return;
  const s = getSettings();
  if (!s.imageFixEnabled || !keyOf()) return;
  const done = Number(getState(todayKey()) || 0);
  if (done >= (s.imageFixDaily || 15)) return;
  const row = db()
    .prepare("SELECT id, group_jid, group_name, src_path, corner, box FROM image_fixes WHERE status = 'queued' ORDER BY id LIMIT 1")
    .get() as { id: number; group_jid: string; group_name: string | null; src_path: string; corner: Corner; box: string | null } | undefined;
  if (!row) return;
  w.__afiliadosImageFixBusy = true;
  try {
    const src = fs.readFileSync(row.src_path);
    let ref = groupRef(row.group_jid);
    // 1) detecção: tem marca? onde?
    let boxes: Box[];
    let desc = "";
    const det = await detectWatermark(src, row.group_name || "grupo", ref).catch((e) => {
      log("warn", `Detecção de marca falhou (#${row.id}): ${(e as Error).message}`);
      return null;
    });
    if (det && !det.watermark) {
      db().prepare("UPDATE image_fixes SET status = 'clean', error = 'sem marca d''água', updated_at = datetime('now') WHERE id = ?").run(row.id);
      log("info", `Foto #${row.id} de ${row.group_name} não tem marca d'água: não precisa refazer`);
      return;
    }
    if (det) {
      boxes = det.boxes;
      desc = det.description;
      if (!ref) {
        await saveGroupRef(row.group_jid, src, boxes[0]).catch(() => {});
        log("info", `Marca d'água de referência de ${row.group_name} guardada a partir da foto #${row.id}`);
        ref = null; // na primeira vez a referência é a própria foto: não precisa mandar de novo
      }
    } else {
      boxes = [cornerBox(row.corner)];
    }
    // 2) edição só em volta da marca
    setState(todayKey(), String(done + 1));
    const r = await fixImage(src, boxes, ref, desc);
    const file = row.src_path.replace(/src_/, "out_");
    fs.writeFileSync(file, r.out);
    db()
      .prepare("UPDATE image_fixes SET status = 'ready', out_path = ?, box = ?, usage = ?, error = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(file, JSON.stringify(boxes), JSON.stringify({ model: r.model, usage: r.usage }), row.id);
    log("info", `IA refez a foto #${row.id} (${r.model}, uso ${JSON.stringify(r.usage)}). Aguardando aprovação na tela Imagens.`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/model/i.test(msg)) setState("openaiModels", "");
    db().prepare("UPDATE image_fixes SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?").run(msg.slice(0, 300), row.id);
    log("warn", `IA não conseguiu refazer a foto #${row.id}: ${msg}`);
  } finally {
    w.__afiliadosImageFixBusy = false;
  }
}

/* ------------------------------------------------------------------ */
/* Aprovação                                                            */
/* ------------------------------------------------------------------ */

/** Aprovar: a foto refeita entra no banco de fotos do perfume (e já vale para os próximos posts). */
export async function approveFix(id: number): Promise<string> {
  const r = db().prepare("SELECT product_id, out_path, status FROM image_fixes WHERE id = ?").get(id) as
    | { product_id: number; out_path: string | null; status: string }
    | undefined;
  if (!r?.out_path || !fs.existsSync(r.out_path)) throw new Error("foto refeita não encontrada");
  const msg = await addImage(r.product_id, fs.readFileSync(r.out_path), `fix:${id}`);
  db().prepare("UPDATE image_fixes SET status = 'approved', updated_at = datetime('now') WHERE id = ?").run(id);
  log("info", `Foto refeita #${id} aprovada: ${msg}`);
  return msg;
}

export function rejectFix(id: number) {
  db().prepare("UPDATE image_fixes SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(id);
}

/** Tentar de novo: volta para a fila (com outro canto, se informado). */
export function retryFix(id: number, corner?: Corner) {
  db()
    .prepare("UPDATE image_fixes SET status = 'queued', corner = COALESCE(?, corner), error = NULL, updated_at = datetime('now') WHERE id = ?")
    .run(corner && CORNERS.includes(corner) ? corner : null, id);
}

export function listFixes(status: string) {
  const where = status === "all" ? "1=1" : status === "failed" ? "f.status IN ('failed','rejected')" : "f.status = ?";
  const args = status === "all" || status === "failed" ? [] : [status];
  const rows = db()
    .prepare(
      `SELECT f.id, f.product_id, p.name, f.group_jid, f.group_name, f.corner, f.status, f.error, f.created_at, f.updated_at,
              (f.box IS NOT NULL) detected, (g.wm_ref IS NOT NULL) has_ref,
              (SELECT COUNT(*) FROM images i WHERE i.product_id = f.product_id AND i.disabled = 0) photos
       FROM image_fixes f LEFT JOIN products p ON p.id = f.product_id LEFT JOIN groups g ON g.jid = f.group_jid
       WHERE ${where} ORDER BY f.id DESC LIMIT 100`,
    )
    .all(...args);
  const counts = Object.fromEntries(
    (db().prepare("SELECT status, COUNT(*) n FROM image_fixes GROUP BY status").all() as { status: string; n: number }[]).map((c) => [c.status, c.n]),
  );
  return { rows, counts, today: Number(getState(todayKey()) || 0) };
}

export function fixFile(id: number, which: "src" | "out"): string | null {
  const r = db().prepare("SELECT src_path, out_path FROM image_fixes WHERE id = ?").get(id) as { src_path: string; out_path: string | null } | undefined;
  const p = which === "out" ? r?.out_path : r?.src_path;
  return p && fs.existsSync(p) ? p : null;
}
