/**
 * Fotos de grupos com marca d'água, refeitas pela IA.
 *
 * - Só entra na fila quando o perfume tem poucas fotos limpas no banco (menos de 2).
 * - A IA (OpenAI, edição com máscara) repinta SÓ o canto onde fica a marca do grupo.
 * - Depois o resultado é recolado sobre a foto original usando a mesma máscara (com borda suave):
 *   fora do canto, os pixels continuam exatamente os da foto original. Frasco e rótulo não mudam.
 * - Nada vai para o grupo sem aprovação: a foto refeita aparece na tela Imagens e só entra no
 *   banco de fotos do perfume quando o Arthur aprova.
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

/** Tamanho da área que a IA pode mexer, em fração da imagem. */
const AREA_W = 0.34;
const AREA_H = 0.22;

export const FIX_PROMPT = `Remove the watermark / logo / text inside the masked area and fill it with the natural background that surrounds it, continuing the same colors, gradients, lighting, shadows and texture.

Strict rules:
- Edit ONLY the masked area. Do not change anything outside it.
- Do not add any new text, logo, watermark, price, sticker, emoji or border.
- Do not alter, redraw, move or resize the perfume bottle, cap, box, label, brand name or any product text.
- Keep the original framing and aspect ratio.
- If the masked area overlaps the product, reconstruct the product exactly as it appears in the rest of the image (same shape, color, reflections and text), never invent new details.
- The result must look like an untouched original product photo.`;

const todayKey = () => `imageFixCount:${new Date().toISOString().slice(0, 10)}`;

function rect(corner: Corner, w: number, h: number) {
  const rw = Math.round(w * AREA_W);
  const rh = Math.round(h * AREA_H);
  const x = corner.endsWith("right") ? w - rw : 0;
  const y = corner.startsWith("bottom") ? h - rh : 0;
  return { x, y, w: rw, h: rh };
}

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
  const rejected = db()
    .prepare("SELECT COUNT(*) n FROM image_fixes WHERE product_id = ? AND status IN ('rejected','failed')")
    .get(o.productId) as { n: number };
  if (rejected.n >= 3) return "";

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
  return "foto com marca d'água na fila da IA";
}

/** Tamanho aceito pela API mais próximo do formato da foto. */
function apiSize(w: number, h: number): [number, number] {
  const r = w / h;
  if (r > 1.2) return [1536, 1024];
  if (r < 0.83) return [1024, 1536];
  return [1024, 1024];
}

/** Modelos de edição de imagem, do melhor para o mais simples. */
const MODEL_PREF = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini", "dall-e-2"];

/** Escolhe um modelo de imagem que a conta da OpenAI tem liberado (guarda a escolha por 6h). */
async function pickModel(key: string, configured?: string): Promise<string> {
  const cached = getState("imageModelPicked");
  if (cached) {
    const [m, at] = cached.split("|");
    if (Date.now() - Number(at) < 6 * 3600e3) return m;
  }
  let ids: string[] = [];
  try {
    const r = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    const j = (await r.json()) as { data?: { id: string }[] };
    ids = (j.data || []).map((d) => d.id);
  } catch {
    /* sem lista: usa o configurado */
  }
  const imageIds = ids.filter((i) => /image|dall-e/.test(i));
  const pref = [configured, ...MODEL_PREF].filter(Boolean) as string[];
  const m = ids.length ? pref.find((p) => ids.includes(p)) || imageIds[0] : configured || "gpt-image-1";
  if (!m) throw new Error(`a conta da OpenAI não tem modelo de imagem liberado (modelos: ${imageIds.join(", ") || "nenhum de imagem"})`);
  log("info", `Imagens com IA: usando ${m} (disponíveis: ${imageIds.join(", ") || "?"})`);
  setState("imageModelPicked", `${m}|${Date.now()}`);
  return m;
}

/** Chama a OpenAI e devolve a foto final (já recolada sobre a original). */
export async function fixImage(srcBuf: Buffer, corner: Corner): Promise<Buffer> {
  const s = getSettings();
  const key = s.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("sem chave da OpenAI");

  const orig = sharp(srcBuf, { failOn: "none" });
  const { width: W = 0, height: H = 0 } = await orig.metadata();
  const model = await pickModel(key, s.imageModel);
  const [aw, ah] = model === "dall-e-2" ? [1024, 1024] : apiSize(W, H);

  // imagem e máscara no tamanho da API (máscara: transparente = pode editar)
  const imgPng = await sharp(srcBuf).resize(aw, ah, { fit: "fill" }).png().toBuffer();
  const r = rect(corner, aw, ah);
  const maskPng = await sharp({ create: { width: aw, height: ah, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite([
      {
        input: await sharp({ create: { width: r.w, height: r.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(),
        left: r.x,
        top: r.y,
        blend: "dest-out",
      },
    ])
    .png()
    .toBuffer();

  const form = new FormData();
  form.append("model", model);
  form.append("prompt", FIX_PROMPT);
  form.append("n", "1");
  form.append("size", `${aw}x${ah}`);
  if (model !== "dall-e-2") form.append("quality", "medium");
  else form.append("response_format", "b64_json");
  form.append("image", new Blob([new Uint8Array(imgPng)], { type: "image/png" }), "image.png");
  form.append("mask", new Blob([new Uint8Array(maskPng)], { type: "image/png" }), "mask.png");

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const j = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } };
  if (!res.ok || !j.data?.[0]?.b64_json) throw new Error(j.error?.message || `OpenAI respondeu ${res.status}`);
  const out = Buffer.from(j.data[0].b64_json, "base64");

  // recola só o canto: fora dele fica a foto original, pixel a pixel
  const R = rect(corner, W, H);
  const feather = Math.max(4, Math.round(Math.min(W, H) * 0.012));
  const pad = feather * 2;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/>` +
      `<rect x="${Math.max(0, R.x - (R.x ? pad : 0))}" y="${Math.max(0, R.y - (R.y ? pad : 0))}" width="${R.w + pad}" height="${R.h + pad}" fill="white"/></svg>`,
  );
  const alpha = await sharp(svg).resize(W, H).blur(feather).extractChannel(0).raw().toBuffer();
  // (o sharp aplica removeAlpha depois do joinChannel, então tira o alfa num passo separado)
  const rgb = await sharp(out).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const patch = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
  return orig.rotate().flatten({ background: "#ffffff" }).composite([{ input: patch }]).jpeg({ quality: 92 }).toBuffer();
}

/** Processa um item da fila por vez (respeitando o limite diário). */
export async function processImageFixes() {
  const w = globalThis as { __afiliadosImageFixBusy?: boolean };
  if (w.__afiliadosImageFixBusy) return;
  const s = getSettings();
  if (!s.imageFixEnabled || !(s.openaiApiKey || process.env.OPENAI_API_KEY)) return;
  const done = Number(getState(todayKey()) || 0);
  if (done >= (s.imageFixDaily || 15)) return;
  db().prepare("UPDATE image_fixes SET status = 'queued', error = NULL WHERE status = 'failed' AND error LIKE '%does not exist%'").run();
  const row = db()
    .prepare("SELECT id, src_path, corner FROM image_fixes WHERE status = 'queued' ORDER BY id LIMIT 1")
    .get() as { id: number; src_path: string; corner: Corner } | undefined;
  if (!row) return;
  w.__afiliadosImageFixBusy = true;
  setState(todayKey(), String(done + 1));
  try {
    const out = await fixImage(fs.readFileSync(row.src_path), row.corner);
    const file = row.src_path.replace(/src_/, "out_");
    fs.writeFileSync(file, out);
    db().prepare("UPDATE image_fixes SET status = 'ready', out_path = ?, error = NULL, updated_at = datetime('now') WHERE id = ?").run(file, row.id);
    log("info", `IA refez a foto #${row.id} (marca d'água). Aguardando aprovação na tela Imagens.`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/model/i.test(msg)) setState("imageModelPicked", "");
    db().prepare("UPDATE image_fixes SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?").run(msg.slice(0, 300), row.id);
    log("warn", `IA não conseguiu refazer a foto #${row.id}: ${msg}`);
  } finally {
    w.__afiliadosImageFixBusy = false;
  }
}

/** Aprovar: a foto refeita entra no banco de fotos do perfume. */
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
      `SELECT f.id, f.product_id, p.name, f.group_name, f.corner, f.status, f.error, f.created_at, f.updated_at,
              (SELECT COUNT(*) FROM images i WHERE i.product_id = f.product_id AND i.disabled = 0) photos
       FROM image_fixes f LEFT JOIN products p ON p.id = f.product_id
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
