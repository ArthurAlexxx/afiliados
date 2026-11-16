/**
 * Tira a marca d'água das fotos de grupos (ex: RP PROMOS) com um modelo open source, rodando no próprio servidor:
 * LaMa (Large Mask Inpainting, licença Apache 2.0) em ONNX, executado com onnxruntime-web (WASM). Sem API paga.
 *
 * 1. Onde fica a marca: aprendido sozinho comparando várias fotos do mesmo grupo. A marca é a parte que se
 *    repete igual em todas (o resto da foto muda). Isso vira uma caixa + um "molde" da marca.
 * 2. Cada foto nova do grupo: confere se o molde aparece na caixa (foto sem marca é ignorada).
 * 3. Recorta uma área em volta da marca, o LaMa repinta só a caixa, e o resultado volta para a foto original
 *    com borda suave. O resto da foto (frasco, rótulo) continua exatamente igual.
 * 4. A foto limpa entra no banco do perfume (marcada "sem marca"); dá para desligar na tela Fotos.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import sharp from "sharp";
import { db, log, MEDIA_DIR, DATA_DIR } from "./db.ts";

const DIR = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, "unwm");
const MODEL_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, "models");
const MODEL = path.join(/*turbopackIgnore: true*/ MODEL_DIR, "lama_inpaint.onnx");
/** LaMa FP16 em ONNX (pacote npm com o modelo). */
const MODEL_TGZ = "https://registry.npmjs.org/@fytbob/ai-models/-/ai-models-1.0.0.tgz";

const G = 96; // grade usada para aprender a posição da marca
const MIN_SAMPLES = 8;
type Mask = { box: [number, number, number, number]; tpl: number[]; tw: number; th: number; samples: number; at: number };

/* ------------------------------------------------------------------ */
/* Fila                                                                 */
/* ------------------------------------------------------------------ */

/** Guarda a foto de um grupo com marca d'água para limpar depois (só grupos com "tirar marca" ligado). */
export async function queueUnwatermark(o: { productId: number; image: Buffer; messageId?: string; groupJid: string }): Promise<string> {
  const g = db().prepare("SELECT wm_remove FROM groups WHERE jid = ?").get(o.groupJid) as { wm_remove?: number } | undefined;
  if (!g?.wm_remove) return "";
  const meta = await sharp(o.image, { failOn: "none" }).metadata();
  if (Math.min(meta.width || 0, meta.height || 0) < 650) return "foto do grupo pequena demais";
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(/*turbopackIgnore: true*/ DIR, `src_${o.productId}_${Date.now()}.jpg`);
  fs.writeFileSync(file, await sharp(o.image, { failOn: "none" }).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 95 }).toBuffer());
  db()
    .prepare("INSERT INTO image_fixes (product_id, group_jid, message_id, corner, src_path, status) VALUES (?, ?, ?, 'auto', ?, 'wm_queued')")
    .run(o.productId, o.groupJid, o.messageId || null, file);
  return "foto com marca guardada para limpar";
}

/* ------------------------------------------------------------------ */
/* Onde fica a marca (aprendido)                                        */
/* ------------------------------------------------------------------ */

async function gridRgb(file: string) {
  return (await sharp(file).resize(G, G, { fit: "fill" }).removeAlpha().raw().toBuffer()) as Buffer;
}

/** Aprende a caixa da marca do grupo: pixels que ficam iguais em fotos diferentes. */
export async function learnMask(groupJid: string): Promise<Mask | null> {
  const files = (db()
    .prepare("SELECT src_path FROM image_fixes WHERE group_jid = ? AND status LIKE 'wm_%' ORDER BY id DESC LIMIT 40")
    .all(groupJid) as { src_path: string }[])
    .map((r) => r.src_path)
    .filter((f) => fs.existsSync(f));
  if (files.length < MIN_SAMPLES) return null;
  const grids = await Promise.all(files.map(gridRgb));
  const n = grids.length;
  const P = G * G;
  // pixel "da marca" = igual (perto da mediana) em pelo menos 70% das fotos.
  // Assim fotos que vieram sem a marca não atrapalham o aprendizado.
  const medC = new Float64Array(P * 3);
  const agree = new Float64Array(P);
  const vals = new Array<number>(n);
  for (let i = 0; i < P; i++) {
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < n; k++) vals[k] = grids[k][i * 3 + c];
      const sorted = [...vals].sort((x, y) => x - y);
      medC[i * 3 + c] = sorted[n >> 1];
    }
    let ok = 0;
    for (let k = 0; k < n; k++) {
      const g = grids[k];
      const d = Math.abs(g[i * 3] - medC[i * 3]) + Math.abs(g[i * 3 + 1] - medC[i * 3 + 1]) + Math.abs(g[i * 3 + 2] - medC[i * 3 + 2]);
      if (d < 36) ok++;
    }
    agree[i] = ok / n;
  }
  const mean = medC; // molde = mediana
  const isWhite = (i: number) => [0, 1, 2].every((c) => mean[i * 3 + c] > 232);
  const stable = new Uint8Array(P);
  // marca de grupo fica na borda da foto (faixa de cima/baixo ou laterais), nunca no meio onde fica o frasco
  const edge = (i: number) => {
    const x = (i % G) / G, y = ((i / G) | 0) / G;
    return y < 0.25 || y > 0.8 || x < 0.15 || x > 0.85;
  };
  for (let i = 0; i < P; i++) stable[i] = agree[i] >= 0.7 && !isWhite(i) && edge(i) ? 1 : 0;
  // maior grupo de pixels estáveis ligados (a marca)
  const seen = new Uint8Array(P);
  let best: number[] = [];
  for (let i = 0; i < P; i++) {
    if (!stable[i] || seen[i]) continue;
    const comp: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      const x = k % G, y = (k / G) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
        const nk = ny * G + nx;
        if (stable[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  if (process.env.DEBUG_UNWM) console.log("unwm", { n, stable: stable.reduce((a, b) => a + b, 0), best: best.length });
  if (best.length < 6 || best.length > P * 0.25) return null;
  let x0 = G, y0 = G, x1 = 0, y1 = 0;
  for (const k of best) {
    const x = k % G, y = (k / G) | 0;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
  }
  // molde: média da área da marca (para conferir se a foto nova tem a marca)
  const tpl: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * G + x;
    tpl.push((mean[i * 3] + mean[i * 3 + 1] + mean[i * 3 + 2]) / 3);
  }
  const mask: Mask = { box: [x0 / G, y0 / G, x1 / G, y1 / G], tpl, tw: x1 - x0, th: y1 - y0, samples: n, at: Date.now() };
  db().prepare("UPDATE groups SET wm_mask = ? WHERE jid = ?").run(JSON.stringify(mask), groupJid);
  log("info", `Marca d'água aprendida (${n} fotos): caixa ${mask.box.map((v) => v.toFixed(2)).join(", ")}`);
  return mask;
}

/** A foto tem a marca? Compara a área da caixa com o molde (correlação). */
async function hasMark(file: string, m: Mask): Promise<number> {
  const g = await gridRgb(file);
  const [bx0, by0] = [Math.round(m.box[0] * G), Math.round(m.box[1] * G)];
  const v: number[] = [];
  for (let y = 0; y < m.th; y++) for (let x = 0; x < m.tw; x++) {
    const i = (by0 + y) * G + bx0 + x;
    v.push((g[i * 3] + g[i * 3 + 1] + g[i * 3 + 2]) / 3);
  }
  const ma = v.reduce((a, b) => a + b, 0) / v.length, mb = m.tpl.reduce((a, b) => a + b, 0) / m.tpl.length;
  let num = 0, da = 0, db2 = 0, diff = 0;
  for (let i = 0; i < v.length; i++) {
    num += (v[i] - ma) * (m.tpl[i] - mb);
    da += (v[i] - ma) ** 2;
    db2 += (m.tpl[i] - mb) ** 2;
    diff += Math.abs(v[i] - m.tpl[i]);
  }
  const corr = num / Math.sqrt(Math.max(1e-6, da * db2));
  // marca opaca: além da forma, os valores batem
  return diff / v.length < 25 ? Math.max(corr, 0.9) : corr;
}

/* ------------------------------------------------------------------ */
/* LaMa                                                                 */
/* ------------------------------------------------------------------ */

/** Baixa o modelo (uma vez, ~100 MB) para a pasta de dados. */
async function ensureModel() {
  if (fs.existsSync(MODEL) && fs.statSync(MODEL).size > 50e6) return;
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  log("info", "Baixando o modelo LaMa (open source) para tirar marca d'água…");
  const res = await fetch(MODEL_TGZ, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`download do modelo: ${res.status}`);
  const tar = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
  // tar simples: procura o arquivo .onnx
  for (let off = 0; off + 512 <= tar.length; ) {
    const name = tar.subarray(off, off + 100).toString("utf8").replace(/\0.*$/s, "");
    if (!name) break;
    const size = parseInt(tar.subarray(off + 124, off + 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
    if (name.endsWith(".onnx")) {
      fs.writeFileSync(MODEL + ".tmp", tar.subarray(off + 512, off + 512 + size));
      fs.renameSync(MODEL + ".tmp", MODEL);
      log("info", `Modelo LaMa pronto (${Math.round(size / 1e6)} MB)`);
      return;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("modelo .onnx não encontrado no pacote");
}

type Ort = typeof import("onnxruntime-web");
let session: { s: import("onnxruntime-web").InferenceSession; ort: Ort } | null = null;

async function lama() {
  if (session) return session;
  await ensureModel();
  const ort = (await import("onnxruntime-web")) as Ort;
  ort.env.wasm.numThreads = 1;
  const s = await ort.InferenceSession.create(MODEL, { executionProviders: ["wasm"] });
  session = { s, ort };
  return session;
}

/** Repinta a caixa da marca com o LaMa e devolve a foto final (só a caixa muda). */
export async function inpaint(src: Buffer, box: [number, number, number, number]): Promise<Buffer> {
  const { s, ort } = await lama();
  const img = sharp(src, { failOn: "none" }).rotate().flatten({ background: "#ffffff" });
  const { width: W = 0, height: H = 0 } = await img.metadata();
  // caixa em pixels, com folga
  // folga: 1 célula da grade (~1%) + margem para a borda/sombra da marca
  const pad = Math.round(Math.min(W, H) * 0.028);
  const bx = Math.max(0, Math.floor(box[0] * W) - pad), by = Math.max(0, Math.floor(box[1] * H) - pad);
  const bx1 = Math.min(W, Math.ceil(box[2] * W) + pad), by1 = Math.min(H, Math.ceil(box[3] * H) + pad);
  const bw = bx1 - bx, bh = by1 - by;
  // recorte quadrado em volta (contexto para o LaMa), ~2.5x a marca
  const side = Math.min(Math.max(W, H), Math.max(320, Math.round(Math.max(bw, bh) * 2.5)));
  const cx = Math.max(0, Math.min(W - Math.min(side, W), Math.round(bx + bw / 2 - side / 2)));
  const cy = Math.max(0, Math.min(H - Math.min(side, H), Math.round(by + bh / 2 - side / 2)));
  const cw = Math.min(side, W), ch = Math.min(side, H);
  const N = 512;
  const crop = await sharp(await img.png().toBuffer()).extract({ left: cx, top: cy, width: cw, height: ch }).resize(N, N, { fit: "fill" }).removeAlpha().raw().toBuffer();
  // o LaMa repinta um pouco além da caixa, para a emenda suave ficar toda em área já repintada
  const feather = Math.max(2, Math.round(pad * 0.5));
  const ext = feather * 3;
  const mx0 = Math.floor(((bx - ext - cx) / cw) * N), my0 = Math.floor(((by - ext - cy) / ch) * N);
  const mx1 = Math.ceil(((bx1 + ext - cx) / cw) * N), my1 = Math.ceil(((by1 + ext - cy) / ch) * N);
  const image = new Float32Array(3 * N * N), mask = new Float32Array(N * N);
  for (let y = Math.max(0, my0); y < Math.min(N, my1); y++) for (let x = Math.max(0, mx0); x < Math.min(N, mx1); x++) mask[y * N + x] = 1;
  for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) image[c * N * N + i] = mask[i] ? 0 : crop[i * 3 + c] / 255;
  const r = await s.run({ image: new ort.Tensor("float32", image, [1, 3, N, N]), mask: new ort.Tensor("float32", mask, [1, 1, N, N]) });
  const o = r[s.outputNames[0]].data as Float32Array;
  let mx = 0;
  for (let i = 0; i < o.length; i += 97) mx = Math.max(mx, o[i]);
  const scale = mx <= 1.5 ? 255 : 1;
  const out = Buffer.alloc(N * N * 3);
  for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.max(0, Math.min(255, Math.round(o[c * N * N + i] * scale)));
  // volta ao tamanho do recorte e cola só a caixa (borda suave)
  const patchRgb = await sharp(out, { raw: { width: N, height: N, channels: 3 } }).resize(cw, ch, { fit: "fill" }).raw().toBuffer();
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><rect width="100%" height="100%" fill="black"/>` +
      `<rect x="${bx - cx - feather * 1.5}" y="${by - cy - feather * 1.5}" width="${bw + feather * 3}" height="${bh + feather * 3}" fill="white"/></svg>`,
  );
  const alpha = await sharp(svg).resize(cw, ch).blur(feather).extractChannel(0).raw().toBuffer();
  const patch = await sharp(patchRgb, { raw: { width: cw, height: ch, channels: 3 } }).joinChannel(alpha, { raw: { width: cw, height: ch, channels: 1 } }).png().toBuffer();
  return img.composite([{ input: patch, left: cx, top: cy }]).jpeg({ quality: 93 }).toBuffer();
}

/* ------------------------------------------------------------------ */
/* Worker                                                               */
/* ------------------------------------------------------------------ */

/** Limpa uma foto por vez. Devolve true se processou algo. */
export async function processUnwatermark(): Promise<boolean> {
  const w = globalThis as { __afiliadosUnwmBusy?: boolean };
  if (w.__afiliadosUnwmBusy) return false;
  // TESTE: no máximo 30 fotos esperando o Arthur olhar; não fica rodando sem parar
  const waiting = (db().prepare("SELECT COUNT(*) n FROM image_fixes WHERE status = 'wm_ready'").get() as { n: number }).n;
  if (waiting >= 30) return false;
  const row = db()
    .prepare("SELECT id, product_id, group_jid, src_path FROM image_fixes WHERE status = 'wm_queued' ORDER BY id DESC LIMIT 1")
    .get() as { id: number; product_id: number; group_jid: string; src_path: string } | undefined;
  if (!row) return false;
  w.__afiliadosUnwmBusy = true;
  const set = (status: string, error?: string, out?: string) =>
    db().prepare("UPDATE image_fixes SET status = ?, error = ?, out_path = COALESCE(?, out_path), updated_at = datetime('now') WHERE id = ?").run(status, error || null, out || null, row.id);
  try {
    if (!fs.existsSync(row.src_path)) return set("wm_failed", "arquivo sumiu"), true;
    const g = db().prepare("SELECT wm_mask FROM groups WHERE jid = ?").get(row.group_jid) as { wm_mask?: string | null } | undefined;
    let m = g?.wm_mask ? (JSON.parse(g.wm_mask) as Mask) : null;
    const pending = (db().prepare("SELECT COUNT(*) n FROM image_fixes WHERE group_jid = ? AND status LIKE 'wm_%'").get(row.group_jid) as { n: number }).n;
    // reaprende a posição de tempos em tempos (com mais fotos fica mais preciso)
    if (!m || pending - m.samples >= 20) m = (await learnMask(row.group_jid)) || m;
    if (!m) return false; // ainda poucas fotos do grupo para saber onde fica a marca
    const score = await hasMark(row.src_path, m);
    if (score < 0.55) {
      set("wm_nomark", `sem a marca (${score.toFixed(2)})`);
      return true;
    }
    const t = Date.now();
    const out = await inpaint(fs.readFileSync(row.src_path), m.box);
    const file = row.src_path.replace(/src_/, "clean_");
    fs.writeFileSync(file, out);
    // REGRA: foto com marca de outro grupo nunca entra. Confere de novo depois de limpar.
    const after = await hasMark(file, m);
    if (after >= 0.45) {
      set("wm_still", `a marca continuou (${after.toFixed(2)})`, file);
      log("warn", `Foto #${row.id}: a marca não saiu por completo, foto descartada`);
      return true;
    }
    // TESTE: nada entra nos posts sem o Arthur aprovar (tela Fotos → "Marca d'água: teste")
    set("wm_ready", `pronta para aprovar (${((Date.now() - t) / 1000).toFixed(0)}s)`, file);
    log("info", `Marca d'água tirada (foto #${row.id}): aguardando aprovação`);
    return true;
  } catch (e) {
    set("wm_failed", (e as Error).message.slice(0, 300));
    log("warn", `Tirar marca d'água (#${row.id}): ${(e as Error).message}`);
    return true;
  } finally {
    w.__afiliadosUnwmBusy = false;
  }
}

/** Uma vez por grupo: puxa as fotos recentes do histórico (para aprender a marca sem esperar). */
export async function backfillGroups() {
  const { getState, setState, getSettings } = await import("./settings.ts");
  const groups = db().prepare("SELECT jid, name FROM groups WHERE role = 'source' AND wm_remove = 1").all() as { jid: string; name: string }[];
  for (const g of groups) {
    const key = `unwmBackfill:${g.jid}`;
    if (getState(key)) continue;
    setState(key, "1");
    const { Evolution } = await import("./evolution.ts");
    const { extractText } = await import("./pipeline.ts");
    const { recordOffer } = await import("./curation.ts");
    const evo = new Evolution(getSettings());
    let msgs: { key?: { id?: string }; message?: Record<string, unknown> & { imageMessage?: unknown }; messageTimestamp?: number | string }[] = [];
    try {
      msgs = (await evo.findMessages(g.jid, 150)) as typeof msgs;
    } catch (e) {
      log("warn", `Histórico de fotos de ${g.name}: ${(e as Error).message}`);
      continue;
    }
    let n = 0;
    for (const m of msgs) {
      const id = m.key?.id;
      if (!id || !m.message?.imageMessage || n >= 60) continue;
      const text = extractText(m.message as never);
      if (!text) continue;
      await recordOffer({ messageId: id, groupJid: g.jid, groupName: g.name, text, createdAt: m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000) : undefined }).catch(() => "");
      const off = db().prepare("SELECT product_id FROM offers WHERE message_id = ?").get(id) as { product_id: number } | undefined;
      if (!off) continue;
      if (db().prepare("SELECT 1 FROM image_fixes WHERE message_id = ?").get(id)) continue;
      try {
        const r = await evo.getBase64FromMediaMessage(id);
        if (!r.base64) continue;
        const res = await queueUnwatermark({ productId: off.product_id, image: Buffer.from(r.base64.replace(/^data:[^,]+,/, ""), "base64"), messageId: id, groupJid: g.jid });
        if (res.startsWith("foto com marca")) n++;
      } catch {
        /* mídia expirada */
      }
    }
    log("info", `Marca d'água: ${n} foto(s) recentes de ${g.name} na fila para limpar`);
  }
}

/** Aprovar: a foto limpa entra no banco do perfume. Recusar: fica de fora. */
export async function approveClean(id: number, ok: boolean): Promise<string> {
  const r = db().prepare("SELECT product_id, group_jid, out_path FROM image_fixes WHERE id = ? AND status = 'wm_ready'").get(id) as
    | { product_id: number; group_jid: string; out_path: string }
    | undefined;
  if (!r) throw new Error("foto não encontrada");
  if (!ok) {
    db().prepare("UPDATE image_fixes SET status = 'wm_rejected', updated_at = datetime('now') WHERE id = ?").run(id);
    return "recusada";
  }
  const { addImage } = await import("./curation.ts");
  const msg = await addImage(r.product_id, fs.readFileSync(r.out_path), `lama:${id}`, r.group_jid);
  db().prepare("UPDATE image_fixes SET status = 'wm_done', error = ?, updated_at = datetime('now') WHERE id = ?").run(msg, id);
  return msg;
}

export function listClean(status = "wm_ready") {
  return db()
    .prepare(
      `SELECT f.id, f.product_id, p.name, f.status, f.error, f.created_at FROM image_fixes f LEFT JOIN products p ON p.id = f.product_id
       WHERE f.status = ? ORDER BY f.id DESC LIMIT 60`,
    )
    .all(status);
}

export function cleanFile(id: number, which: "src" | "out"): string | null {
  const r = db().prepare("SELECT src_path, out_path FROM image_fixes WHERE id = ?").get(id) as { src_path: string; out_path: string | null } | undefined;
  const p = which === "out" ? r?.out_path : r?.src_path;
  return p && fs.existsSync(p) ? p : null;
}

/** Libera a memória do modelo quando a fila esvazia. */
export async function releaseModel() {
  if (!session) return;
  await session.s.release().catch(() => {});
  session = null;
}

export function unwmStats() {
  const rows = db().prepare("SELECT status, COUNT(*) n FROM image_fixes WHERE status LIKE 'wm_%' GROUP BY status").all() as { status: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

/** Estado salvo do último aprendizado (para a tela Grupos). */
export function maskOf(jid: string): Mask | null {
  const g = db().prepare("SELECT wm_mask FROM groups WHERE jid = ?").get(jid) as { wm_mask?: string | null } | undefined;
  return g?.wm_mask ? (JSON.parse(g.wm_mask) as Mask) : null;
}

