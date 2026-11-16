import fs from "node:fs";
import path from "node:path";
import { db, log, MEDIA_DIR } from "./db.ts";
import { getSettings, getState, setState, type Settings } from "./settings.ts";
import { extractUrls, isMeliUrl, UA } from "./links.ts";
import { convertMeliLink, type ConvertResult } from "./affiliate.ts";
import { parsePromo, renderTemplate, type PromoData } from "./parser.ts";
import { aiExtract } from "./ai.ts";
import { Evolution } from "./evolution.ts";
import { evaluateInstant, recordOffer } from "./curation.ts";

export type PostStatus = "pending" | "queued" | "sending" | "sent" | "failed" | "skipped" | "duplicate";

export type BuildResult = {
  formatted: string;
  data: PromoData;
  conversions: ConvertResult[];
  productKey: string | null;
  productImage: string | null;
  status: PostStatus;
  reason: string | null;
};

/** Transforma o texto original na postagem do seu grupo (sem enviar nada). */
export async function buildPost(
  text: string,
  s: Settings,
  ctx: { groupName?: string; wantImage?: boolean } = {},
): Promise<BuildResult> {
  const urls = extractUrls(text);
  const meliUrls = urls.filter(isMeliUrl);
  const conversions: ConvertResult[] = [];

  // bloqueios por palavra
  const blocked = s.blocklist
    .split(/\r?\n/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .find((w) => text.toLowerCase().includes(w));

  let texto = text;
  for (const u of urls) {
    if (isMeliUrl(u)) {
      const c = await convertMeliLink(u, s, { wantImage: ctx.wantImage && conversions.length === 0 });
      conversions.push(c);
      texto = texto.split(u).join(c.ok && c.affiliateUrl ? c.affiliateUrl : "");
    } else if (s.otherLinks === "remove") {
      texto = texto.split(u).join("");
    }
  }
  texto = texto
    .split("\n")
    .filter((l) => !/^\s*(🔗|👉|➡️|🛒)?\s*(link|compre aqui|acesse|clique)?\s*[:\-]?\s*$/i.test(l) || l.trim() === "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const ok = conversions.filter((c) => c.ok && c.affiliateUrl);
  const parsed = parsePromo(text);
  const ai = await aiExtract(text, s);
  if (ai) {
    for (const [k, v] of Object.entries(ai)) if (v) (parsed as unknown as Record<string, string>)[k] = v;
    if (ai.preco && ai.preco_antigo) {
      const n = (x: string) => Number(x.replace(/\./g, "").replace(",", "."));
      const p = n(ai.preco), o = n(ai.preco_antigo);
      if (p > 0 && o > p) parsed.desconto = `(-${Math.round((1 - p / o) * 100)}%)`;
    }
  }
  const first = ok[0];
  if (!parsed.titulo && first?.title) parsed.titulo = first.title;

  const data: PromoData = {
    ...parsed,
    link: first?.affiliateUrl || "",
    links: ok.map((c) => c.affiliateUrl).join("\n"),
    texto,
    grupo_origem: ctx.groupName || "",
    loja: meliUrls.length ? "Mercado Livre" : "",
  };

  let status: PostStatus = s.sendMode === "manual" ? "pending" : "queued";
  let reason: string | null = null;

  if (blocked) {
    status = "skipped";
    reason = `Contém palavra bloqueada: "${blocked}"`;
  } else if (s.requireMeliLink && meliUrls.length === 0) {
    status = "skipped";
    reason = "Sem link do Mercado Livre";
  } else if (meliUrls.length > 0 && ok.length < meliUrls.length) {
    const err = conversions.find((c) => !c.ok)?.error || "falha ao converter";
    if (s.onConvertFail === "skip" || ok.length === 0) {
      status = s.onConvertFail === "skip" ? "skipped" : "pending";
    } else status = "pending";
    reason = `Link do ML não convertido: ${err}`;
  }

  return {
    formatted: renderTemplate(s.template, data),
    data,
    conversions,
    productKey: first?.productKey || null,
    productImage: first?.image || null,
    status,
    reason,
  };
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

type WAMessage = {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string; mimetype?: string };
  videoMessage?: { caption?: string };
  base64?: string;
};

type UpsertData = {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string; participant?: string };
  pushName?: string;
  message?: WAMessage;
  messageType?: string;
};

export function extractText(m?: WAMessage): string {
  if (!m) return "";
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ""
  ).trim();
}

export async function handleWebhook(payload: unknown): Promise<{ ok: boolean; info: string }> {
  const p = payload as { event?: string; data?: UpsertData | UpsertData[] };
  const event = String(p.event || "").toLowerCase().replace(/_/g, ".");
  if (event && event !== "messages.upsert") return { ok: true, info: `evento ignorado: ${p.event}` };

  const items = Array.isArray(p.data) ? p.data : p.data ? [p.data] : [];
  const results: string[] = [];
  for (const d of items) results.push(await ingestMessage(d));
  if (results.some((r) => r.startsWith("queued"))) void processQueue();
  return { ok: true, info: results.join("; ") || "sem mensagens" };
}

async function ingestMessage(d: UpsertData): Promise<string> {
  const s = getSettings();
  const jid = d.key?.remoteJid || "";
  const messageId = d.key?.id || "";
  if (!jid.endsWith("@g.us")) return "ignorado: não é grupo";
  if (d.key?.fromMe && s.ignoreFromMe) return "ignorado: fromMe";

  const group = db().prepare("SELECT name, role, watermark FROM groups WHERE jid = ?").get(jid) as
    | { name: string; role: string; watermark: number }
    | undefined;
  if (!group || group.role !== "source") return "ignorado: grupo não é de origem";

  if (messageId) {
    const exists = db().prepare("SELECT 1 FROM posts WHERE message_id = ?").get(messageId);
    if (exists) return "ignorado: mensagem repetida";
  }

  const text = extractText(d.message);
  if (!text) return "ignorado: sem texto";

  const hasImage = Boolean(d.message?.imageMessage);

  // curadoria: toda promoção vira dado (preço, grupo, foto); quem decide o que postar é o ranking
  {
    let image: Buffer | null = null;
    if (hasImage && !group.watermark) {
      try {
        let b64 = d.message?.base64 || "";
        if (!b64 && messageId) b64 = (await new Evolution(s).getBase64FromMediaMessage(messageId)).base64 || "";
        if (b64) image = Buffer.from(b64.replace(/^data:[^,]+,/, ""), "base64");
      } catch (e) {
        log("warn", `Não consegui baixar a foto de "${group.name}": ${(e as Error).message}`);
      }
    }
    const r = await recordOffer({ messageId, groupJid: jid, groupName: group.name, text, image, watermark: Boolean(group.watermark) }).catch(
      (e) => `erro: ${(e as Error).message}`,
    );
    if (s.mode === "curated") {
      const pid = r.match(/produto #(\d+)/)?.[1];
      const now = pid ? await evaluateInstant(Number(pid)).catch((e) => `erro: ${(e as Error).message}`) : "";
      return `curadoria: ${r}${now ? ` · ${now}` : ""}`;
    }
  }

  const built = await buildPost(text, s, {
    groupName: group.name,
    wantImage: s.sendImage && s.fetchProductImage && !hasImage,
  });

  let status = built.status;
  let reason = built.reason;

  // duplicidade por produto
  if (built.productKey && (status === "queued" || status === "pending") && s.dedupHours > 0) {
    const dup = db()
      .prepare(
        `SELECT id FROM posts WHERE product_key = ? AND status IN ('queued','pending','sending','sent')
         AND created_at >= datetime('now', ?) LIMIT 1`,
      )
      .get(built.productKey, `-${Math.round(s.dedupHours * 60)} minutes`) as { id: number } | undefined;
    if (dup) {
      status = "duplicate";
      reason = `Mesmo produto já postado/na fila (#${dup.id}) nas últimas ${s.dedupHours}h`;
    }
  }

  // mídia
  let mediaPath: string | null = null;
  let mediaMime: string | null = null;
  if (s.sendImage && (status === "queued" || status === "pending")) {
    try {
      if (hasImage) {
        let b64 = d.message?.base64 || "";
        let mime = d.message?.imageMessage?.mimetype || "image/jpeg";
        if (!b64 && messageId) {
          const r = await new Evolution(s).getBase64FromMediaMessage(messageId);
          b64 = r.base64 || "";
          mime = r.mimetype || mime;
        }
        if (b64) {
          mediaPath = saveMedia(messageId || String(Date.now()), Buffer.from(b64.replace(/^data:[^,]+,/, ""), "base64"), mime);
          mediaMime = mime.split(";")[0];
        }
      } else if (built.productImage) {
        const r = await fetch(built.productImage, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
        if (r.ok) {
          const mime = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
          if (mime.startsWith("image/") && !mime.includes("webp")) {
            mediaPath = saveMedia(messageId || String(Date.now()), Buffer.from(await r.arrayBuffer()), mime);
            mediaMime = mime;
          }
        }
      }
    } catch (e) {
      log("warn", `Não consegui baixar a imagem: ${(e as Error).message}`);
    }
  }

  const info = db()
    .prepare(
      `INSERT INTO posts (message_id, source_jid, source_name, original_text, formatted_text, data_json,
        media_path, media_mime, product_key, status, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      messageId || null,
      jid,
      group.name,
      text,
      built.formatted,
      JSON.stringify({ data: built.data, conversions: built.conversions }),
      mediaPath,
      mediaMime,
      built.productKey,
      status,
      reason,
    );
  log("info", `Promo #${info.lastInsertRowid} de "${group.name}" → ${status}${reason ? ` (${reason})` : ""}`);
  return `${status} #${info.lastInsertRowid}`;
}

function saveMedia(id: string, buf: Buffer, mime: string) {
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const file = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, `${id.replace(/[^\w-]/g, "")}.${ext}`);
  fs.writeFileSync(file, buf);
  return file;
}

/* ------------------------------------------------------------------ */
/* Fila de envio                                                       */
/* ------------------------------------------------------------------ */

export function nowInTz(tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date());
  const h = parts.find((p) => p.type === "hour")?.value || "00";
  const m = parts.find((p) => p.type === "minute")?.value || "00";
  return `${h === "24" ? "00" : h}:${m}`;
}

export function inActiveWindow(s: Settings) {
  if (!s.activeFrom || !s.activeTo) return true;
  const now = nowInTz(s.timezone || "America/Sao_Paulo");
  return s.activeFrom <= s.activeTo
    ? now >= s.activeFrom && now <= s.activeTo
    : now >= s.activeFrom || now <= s.activeTo; // janela que atravessa a meia-noite
}

type G = typeof globalThis & { __afiliadosQueueRunning?: boolean };
const g = globalThis as G;

/** Envia no máximo 1 post por chamada, respeitando intervalo e janela de horário. */
export async function processQueue(): Promise<string> {
  if (g.__afiliadosQueueRunning) return "ocupado";
  g.__afiliadosQueueRunning = true;
  try {
    const s = getSettings();
    if (!inActiveWindow(s)) return "fora do horário";
    const last = Number(getState("lastSentAt") || 0);
    if (Date.now() - last < s.minIntervalSeconds * 1000) return "aguardando intervalo";
    // post da curadoria que ficou tempo demais na fila: o preço pode ter mudado, descarta
    db()
      .prepare(
        `UPDATE posts SET status='skipped', reason='Oferta ficou velha na fila' WHERE status='queued' AND origin='curated'
         AND created_at < datetime('now', ?)`,
      )
      .run(`-${Math.max(5, s.curationLookbackMinutes)} minutes`);
    const next = db().prepare("SELECT id FROM posts WHERE status = 'queued' ORDER BY id LIMIT 1").get() as
      | { id: number }
      | undefined;
    if (!next) return "fila vazia";
    return await sendPost(next.id);
  } finally {
    g.__afiliadosQueueRunning = false;
  }
}

export async function sendPost(id: number): Promise<string> {
  const s = getSettings();
  const post = db().prepare("SELECT * FROM posts WHERE id = ?").get(id) as
    | { id: number; formatted_text: string; media_path: string | null; media_mime: string | null; attempts: number }
    | undefined;
  if (!post) throw new Error("Post não encontrado");

  const dests = db().prepare("SELECT jid, name FROM groups WHERE role = 'destination'").all() as {
    jid: string;
    name: string;
  }[];
  if (!dests.length) {
    db().prepare("UPDATE posts SET status='queued', reason=? WHERE id=?").run("Nenhum grupo de destino configurado", id);
    return "sem destino";
  }

  db().prepare("UPDATE posts SET status='sending', attempts = attempts + 1 WHERE id=?").run(id);
  setState("lastSentAt", String(Date.now()));
  const evo = new Evolution(s);
  const errors: string[] = [];
  for (const d of dests) {
    try {
      if (s.sendImage && post.media_path && fs.existsSync(post.media_path)) {
        const b64 = fs.readFileSync(post.media_path).toString("base64");
        await evo.sendImage(d.jid, b64, post.media_mime || "image/jpeg", post.formatted_text);
      } else {
        await evo.sendText(d.jid, post.formatted_text);
      }
    } catch (e) {
      errors.push(`${d.name || d.jid}: ${(e as Error).message}`);
    }
  }

  if (errors.length === dests.length) {
    const retry = post.attempts + 1 < 3;
    db()
      .prepare("UPDATE posts SET status=?, reason=? WHERE id=?")
      .run(retry ? "queued" : "failed", errors.join(" | ").slice(0, 1000), id);
    log("error", `Falha ao enviar #${id}: ${errors.join(" | ")}`);
    return "falhou";
  }
  db()
    .prepare("UPDATE posts SET status='sent', sent_at=datetime('now'), reason=? WHERE id=?")
    .run(errors.length ? errors.join(" | ") : null, id);
  log("info", `Post #${id} enviado para ${dests.length - errors.length} grupo(s)`);
  return "enviado";
}

/* ------------------------------------------------------------------ */
/* Worker em segundo plano                                             */
/* ------------------------------------------------------------------ */

type W = typeof globalThis & { __afiliadosWorker?: NodeJS.Timeout };
export function startWorker() {
  const w = globalThis as W;
  if (w.__afiliadosWorker) return;
  import("./curation.ts").then((m) => m.startCuration());
  w.__afiliadosWorker = setInterval(() => {
    processQueue().catch((e) => log("error", `Worker: ${(e as Error).message}`));
  }, 15000);
  log("info", "Worker da fila iniciado (verifica a cada 15s)");
}
