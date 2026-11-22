import fs from "node:fs";
import path from "node:path";
import { db, log, MEDIA_DIR } from "./db.ts";
import { getSettings, getState, setState, type Settings } from "./settings.ts";
import { extractUrls, isMeliUrl, UA } from "./links.ts";
import { convertMeliLink, type ConvertResult } from "./affiliate.ts";
import { manchete, parsePromo, renderTemplate, type PromoData } from "./parser.ts";
import { aiExtract } from "./ai.ts";
import { Evolution } from "./evolution.ts";
import { evaluateInstant, recordOffer } from "./curation.ts";
import { handlePrivateMessage, handleWishMessage, notifyWishes } from "./wishes.ts";

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
    historico: "",
    manchete: "",
    link: first?.affiliateUrl || "",
    links: ok.map((c) => c.affiliateUrl).join("\n"),
    texto,
    grupo_origem: ctx.groupName || "",
    loja: meliUrls.length ? "Mercado Livre" : "",
  };

  // sem aprovação manual: ou sai, ou é descartado
  let status: PostStatus = "queued";
  let reason: string | null = null;

  if (blocked) {
    status = "skipped";
    reason = `Contém palavra bloqueada: "${blocked}"`;
  } else if (s.requireMeliLink && meliUrls.length === 0) {
    status = "skipped";
    reason = "Sem link do Mercado Livre";
  } else if (meliUrls.length > 0 && ok.length < meliUrls.length) {
    const err = conversions.find((c) => !c.ok)?.error || "falha ao converter";
    // nunca posta sem o nosso link
    status = "skipped";
    reason = `Link do ML não convertido: ${err}`;
  }

  data.manchete = manchete(data);
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
  extendedTextMessage?: { text?: string; contextInfo?: { stanzaId?: string } };
  imageMessage?: { caption?: string; mimetype?: string };
  videoMessage?: { caption?: string };
  base64?: string;
};

type UpsertData = {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string; participant?: string; participantAlt?: string; remoteJidAlt?: string };
  pushName?: string;
  message?: WAMessage;
  messageType?: string;
};

export function extractText(m?: WAMessage): string {
  if (!m) return "";
  const direct = (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ""
  ).trim();
  if (direct) return direct;
  // mensagens "embrulhadas" (temporárias, ver uma vez, documento com legenda, editadas, botões, álbum…)
  const x = m as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const k of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "documentWithCaptionMessage", "editedMessage", "botInvokeMessage", "lottieStickerMessage"]) {
    const inner = x[k]?.message;
    if (inner) {
      const t = extractText(inner);
      if (t) return t;
    }
  }
  const pm = x.protocolMessage?.editedMessage;
  if (pm) {
    const t = extractText(pm);
    if (t) return t;
  }
  const candidates = [
    x.documentMessage?.caption,
    x.buttonsMessage?.contentText,
    x.templateMessage?.hydratedTemplate?.hydratedContentText,
    x.templateMessage?.hydratedFourRowTemplate?.hydratedContentText,
    x.interactiveMessage?.body?.text,
    x.listMessage?.description,
    x.pollCreationMessage?.name,
  ];
  return String(candidates.find((c) => typeof c === "string" && c.trim()) || "").trim();
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
  if (d.key?.fromMe && s.ignoreFromMe) return "ignorado: fromMe";
  if (!jid.endsWith("@g.us")) {
    // privado: só serve para "parar" os avisos do "me avisa quando baixar"
    const who = [jid, d.key?.remoteJidAlt].find((x) => x && x.endsWith("@s.whatsapp.net")) || jid;
    return handlePrivateMessage(who, extractText(d.message));
  }

  const group = db().prepare("SELECT name, role, watermark, wm_remove FROM groups WHERE jid = ?").get(jid) as
    | { name: string; role: string; watermark: number; wm_remove: number }
    | undefined;
  if (group?.role === "destination") {
    // nosso grupo: pedidos do "me avisa quando baixar"
    const member = [d.key?.participantAlt, d.key?.participant].find((x) => x && x.endsWith("@s.whatsapp.net")) || d.key?.participant || "";
    return handleWishMessage({
      messageId,
      memberJid: member,
      memberName: d.pushName,
      text: extractText(d.message),
      replyTo: d.message?.extendedTextMessage?.contextInfo?.stanzaId || null,
    }).catch((e) => `erro no pedido: ${(e as Error).message}`);
  }
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
    if (hasImage && (!group.watermark || group.wm_remove)) {
      try {
        let b64 = d.message?.base64 || "";
        if (!b64 && messageId) b64 = (await new Evolution(s).getBase64FromMediaMessage(messageId)).base64 || "";
        if (b64) image = Buffer.from(b64.replace(/^data:[^,]+,/, ""), "base64");
      } catch (e) {
        log("warn", `Não consegui baixar a foto de "${group.name}": ${(e as Error).message}`);
      }
    }
    const r = await recordOffer({ messageId, groupJid: jid, groupName: group.name, text, image, watermark: Boolean(group.watermark), wmRemove: Boolean(group.wm_remove) }).catch(
      (e) => `erro: ${(e as Error).message}`,
    );
    if (s.mode === "curated") {
      const pid = r.match(/produto #(\d+)/)?.[1];
      const { followPost } = await import("./curation.ts");
      const copied = pid ? await followPost(Number(pid), jid).catch((e) => `erro na cópia: ${(e as Error).message}`) : "";
      if (copied) log("info", `Copiar grupos: ${copied}`);
      const now = pid && !copied ? await evaluateInstant(Number(pid)).catch((e) => `erro: ${(e as Error).message}`) : "";
      // grupo de ofertas boas (teste 2): olha a promoção de qualquer grupo contra o banco de preços
      if (pid && messageId) {
        const { dealCheck } = await import("./deals.ts");
        const deal = await dealCheck(Number(pid), messageId).catch((e) => `erro: ${(e as Error).message}`);
        if (deal) log("info", `Ofertas boas: ${deal}`);
      }
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
         AND created_at < datetime('now', ?) AND COALESCE(reason,'') NOT IN ('Foto escolhida por você', 'Liberado por você')`,
      )
      .run(`-${Math.max(5, s.curationLookbackMinutes)} minutes`);
    const next = db().prepare("SELECT id FROM posts WHERE status = 'queued' AND dest IS NULL ORDER BY id LIMIT 1").get() as
      | { id: number }
      | undefined;
    if (!next) return "fila vazia";
    return await sendPost(next.id);
  } finally {
    g.__afiliadosQueueRunning = false;
  }
}

type GD = typeof globalThis & { __dealsQueueRunning?: boolean };

/** Fila do grupo de ofertas boas (teste 2): própria, com o mesmo intervalo, sem atrasar o grupo principal. */
export async function processDeals(): Promise<string> {
  const gd = globalThis as GD;
  if (gd.__dealsQueueRunning) return "ocupado";
  gd.__dealsQueueRunning = true;
  try {
    const s = getSettings();
    if (!inActiveWindow(s)) return "fora do horário";
    // oferta que esperou demais (sem foto/aprovação a tempo) pode já ter acabado
    db()
      .prepare(
        `UPDATE posts SET status='skipped', reason='Oferta ficou velha na fila' WHERE status='queued' AND dest IS NOT NULL
         AND created_at < datetime('now','-90 minutes') AND COALESCE(reason,'') NOT IN ('Foto escolhida por você', 'Liberado por você')`,
      )
      .run();
    const next = db().prepare("SELECT id, dest FROM posts WHERE status = 'queued' AND dest IS NOT NULL ORDER BY id LIMIT 1").get() as
      | { id: number; dest: string }
      | undefined;
    if (!next) return "fila vazia";
    const last = Number(getState(`lastSentAt:${next.dest}`) || 0);
    if (Date.now() - last < s.minIntervalSeconds * 1000) return "aguardando intervalo";
    return await sendPost(next.id);
  } finally {
    gd.__dealsQueueRunning = false;
  }
}

export async function sendPost(id: number): Promise<string> {
  const s = getSettings();
  const post = db().prepare("SELECT * FROM posts WHERE id = ?").get(id) as
    | { id: number; formatted_text: string; media_path: string | null; media_mime: string | null; attempts: number; origin: string; product_id: number | null; data_json: string; dest: string | null }
    | undefined;
  if (!post) throw new Error("Post não encontrado");

  // post do grupo de ofertas boas vai só para ele; os outros vão para todos os grupos de destino
  const dests = (post.dest
    ? db().prepare("SELECT jid, name FROM groups WHERE jid = ?").all(post.dest)
    : db().prepare("SELECT jid, name FROM groups WHERE role = 'destination'").all()) as {
    jid: string;
    name: string;
  }[];
  if (!dests.length && post.dest) {
    db().prepare("UPDATE posts SET status='skipped', reason=? WHERE id=?").run("O grupo de ofertas boas saiu da lista", id);
    return "sem destino";
  }
  if (!dests.length) {
    db().prepare("UPDATE posts SET status='queued', reason=? WHERE id=?").run("Nenhum grupo de destino configurado", id);
    return "sem destino";
  }

  db().prepare("UPDATE posts SET status='sending', attempts = attempts + 1 WHERE id=?").run(id);
  setState(post.dest ? `lastSentAt:${post.dest}` : "lastSentAt", String(Date.now()));
  const evo = new Evolution(s);
  const errors: string[] = [];
  const waIds: { jid: string; id: string }[] = [];
  for (const d of dests) {
    try {
      let r: unknown;
      if (s.sendImage && post.media_path && fs.existsSync(post.media_path)) {
        const b64 = fs.readFileSync(post.media_path).toString("base64");
        r = await evo.sendImage(d.jid, b64, post.media_mime || "image/jpeg", post.formatted_text);
      } else {
        r = await evo.sendText(d.jid, post.formatted_text);
      }
      const mid = (r as { key?: { id?: string } })?.key?.id;
      if (mid) waIds.push({ jid: d.jid, id: mid });
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
    .prepare("UPDATE posts SET status='sent', sent_at=datetime('now'), reason=?, wa_ids=? WHERE id=?")
    .run(errors.length ? errors.join(" | ") : null, waIds.length ? JSON.stringify(waIds) : null, id);
  log("info", `Post #${id} enviado para ${dests.length - errors.length} grupo(s)`);
  // "me avisa quando baixar": avisa no privado quem pediu esse perfume (em segundo plano)
  if (post.origin === "curated" && post.product_id) {
    try {
      const d = JSON.parse(post.data_json).data || {};
      if (d.link) void notifyWishes({ productId: post.product_id, titulo: d.titulo || "", preco: d.preco || "", link: d.link }).catch(() => {});
    } catch {
      /* ignora */
    }
  }
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
    processDeals().catch((e) => log("error", `Ofertas boas: ${(e as Error).message}`));
  }, 15000);
  // não existe mais aprovação manual: o que ficou parado esperando aprovação é descartado
  const old = db().prepare("UPDATE posts SET status='skipped', reason='Descartado: aprovação manual não existe mais (o agente decide)' WHERE status='pending'").run();
  if (old.changes) log("info", `${old.changes} post(s) parados esperando aprovação foram descartados`);
  log("info", "Worker da fila iniciado (verifica a cada 15s)");
  // ajustes vindos de variáveis do Railway (aplicados uma vez por valor, depois o painel manda)
  import("./settings.ts").then(({ saveSettings, getState, setState }) => {
    const perHour = process.env.CURATION_PER_HOUR;
    if (perHour && getState("envPerHour") !== perHour) {
      saveSettings({ curationPerHour: Number(perHour) });
      setState("envPerHour", perHour);
      log("info", `Ritmo ajustado para ${perHour} posts por hora`);
    }
    // Arthur (nov/2026): copiar 5 grupos (postou lá, posta aqui, sem repetir perfume)
    if (getState("followV1") !== "1") {
      const names = ["RP PROMOS", "MD Links", "Promos Clube do Perfume", "Fragrancemen", "Herói do Perfume"];
      for (const n of names) db().prepare("UPDATE groups SET follow = 1 WHERE role = 'source' AND upper(name) LIKE ?").run(`%${n.toUpperCase()}%`);
      const on = db().prepare("SELECT name FROM groups WHERE follow = 1").all() as { name: string }[];
      setState("followV1", "1");
      log("info", `Copiar grupos ligado para: ${on.map((g) => g.name).join(", ")}`);
    }
    // Arthur (17/nov): apagar o French Avenue Royal Blend e postar de novo com a foto escolhida no Pinterest
    if (getState("redoFrenchV1") !== "1") {
      setState("redoFrenchV1", "1");
      const old = db()
        .prepare("SELECT p.id FROM posts p JOIN products pr ON pr.id = p.product_id WHERE p.status = 'sent' AND lower(pr.name) LIKE '%royal blend%' ORDER BY p.id DESC LIMIT 1")
        .get() as { id: number } | undefined;
      if (old)
        setTimeout(() => {
          import("./curation.ts")
            .then((m) => m.redoPost(old.id))
            .then((r) => log("info", `Refazer post: ${r}`))
            .catch((e) => log("warn", `Refazer post #${old.id}: ${(e as Error).message}`));
        }, 30_000);
    }
    // Fragrantica: tenta de novo os que não foram achados antes da correção do apóstrofo
    if (getState("fragRetryV1") !== "1") {
      setState("fragRetryV1", "1");
      db().prepare("UPDATE products SET frag_checked_at = NULL WHERE frag_url IS NULL").run();
    }
    // Arthur (17/nov): "nem poste isso - Kiss Com Caixa Deo Colônia 100ml"
    if (getState("blockKissV1") !== "1") {
      setState("blockKissV1", "1");
      const r = db().prepare("UPDATE products SET blocked = 1 WHERE lower(name) LIKE '%kiss%' AND lower(name) LIKE '%col%nia%' AND ml = 100").run();
      db().prepare("UPDATE posts SET status = 'skipped', reason = 'Perfume bloqueado' WHERE status IN ('queued','pending') AND product_id IN (SELECT id FROM products WHERE blocked = 1)").run();
      log("info", `Bloqueado (não postar): Kiss Deo Colônia 100ml (${r.changes} cadastro(s))`);
    }
    // teste: o servidor consegue abrir a Fragrantica direto? (scraper próprio)
    if (getState("fragDirectTestV1") !== "1") {
      setState("fragDirectTestV1", "1");
      void (async () => {
        const UA_ = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
        for (const u of ["https://www.fragrantica.com/perfume/French-Avenue/Royal-Blend-94022.html", "https://www.fragrantica.com.br/perfume/French-Avenue/Royal-Blend-94022.html", "https://www.fragrantica.com/search/?query=royal%20blend"]) {
          try {
            const r = await fetch(u, { headers: { "user-agent": UA_, accept: "text/html", "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" }, signal: AbortSignal.timeout(20000) });
            const t = await r.text();
            const title = t.match(/<title>([^<]*)/i)?.[1]?.trim() || "";
            log("info", `Teste Fragrantica direto: ${u} → ${r.status}, ${t.length} bytes, título "${title.slice(0, 80)}"${/cf-chl|challenge-platform|Just a moment/i.test(t) ? " (bloqueio Cloudflare)" : ""}`);
          } catch (e) {
            log("info", `Teste Fragrantica direto: ${u} → erro ${(e as Error).message}`);
          }
        }
      })();
    }
    // Fragrantica: desfaz um nome errado ("212 NYC Men" tinha virado "Nutrimetics NYC") e busca de novo
    if (getState("fragFixNycV1") !== "1") {
      setState("fragFixNycV1", "1");
      db().prepare("UPDATE products SET name = '212 NYC Men EDT 200ml', frag_name = NULL, frag_brand = NULL, frag_url = NULL, frag_data = NULL, frag_checked_at = NULL WHERE frag_brand = 'Nutrimetics'").run();
    }
    // Arthur (nov/2026): tira do banco as fotos de capa do Fragrantica (ele quer só as do Fragram Photos)
    if (getState("fragNoCoverV1") !== "1") {
      setState("fragNoCoverV1", "1");
      db().prepare("UPDATE products SET main_image_id = NULL WHERE main_image_id IN (SELECT id FROM images WHERE message_id LIKE 'frag:%')").run();
      const n = db().prepare("UPDATE images SET disabled = 1 WHERE message_id LIKE 'frag:%'").run().changes;
      log("info", `Fragrantica: ${n} foto(s) de capa tiradas do banco`);
    }
    // Arthur (nov/2026): nome simples = Marca + nome da Fragrantica + ml; e tenta de novo os não achados
    if (getState("fragSimpleNameV2") !== "1") {
      setState("fragSimpleNameV2", "1");
      import("./fragrantica.ts").then(({ canonicalName }) => {
        const rows = db().prepare("SELECT id, name, ml, frag_name, frag_brand FROM products WHERE frag_name IS NOT NULL AND frag_brand IS NOT NULL").all() as { id: number; name: string; ml: number; frag_name: string; frag_brand: string }[];
        let n = 0;
        for (const r of rows) {
          const nm = canonicalName({ brand: r.frag_brand, name: r.frag_name }, r.ml);
          if (nm !== r.name) (db().prepare("UPDATE products SET name = ? WHERE id = ?").run(nm, r.id), n++);
        }
        const retry = db().prepare("UPDATE products SET frag_checked_at = NULL WHERE frag_url IS NULL").run().changes;
        log("info", `Fragrantica: ${n} nome(s) simplificado(s); ${retry} não achado(s) vão ser procurados de novo`);
      });
    }
    if (getState("fragPhotoPickV1") !== "1") {
      setState("fragPhotoPickV1", "1");
      db().prepare("UPDATE products SET frag_checked_at = NULL WHERE frag_url IS NULL").run();
    }
    if (getState("fragArtArabiaV1") !== "1") {
      setState("fragArtArabiaV1", "1");
      db().prepare("UPDATE products SET name = 'Lattafa Art of Arabia I 100ml', frag_brand = 'Lattafa Perfumes', frag_name = 'Art of Arabia I' WHERE frag_url LIKE '%Art-of-Arabia-I-92423%'").run();
    }
    if (getState("fragCodeV1") !== "1") {
      setState("fragCodeV1", "1");
      // Armani Code Parfum tinha virado "Code Colonia": #555 é o Parfum (Arthur)
      db().prepare("UPDATE products SET frag_url = 'https://www.fragrantica.com/perfume/Giorgio-Armani/Armani-Code-Parfum-75126.html', frag_name = 'Armani Code Parfum', frag_brand = 'Giorgio Armani', name = 'Armani Code Parfum ' || ml || 'ml', frag_data = NULL, fragram_at = NULL WHERE id = 555").run();
    }
    // Fragram lido de novo pelo HTML inteiro (antes só pegava os links e perdia fotos)
    if (getState("fragramHtmlV1") !== "1") {
      setState("fragramHtmlV1", "1");
      db().prepare("UPDATE products SET fragram_at = NULL").run();
    }
    if (getState("fragGoogleV1") !== "1") {
      setState("fragGoogleV1", "1");
      db().prepare("UPDATE products SET frag_checked_at = NULL WHERE frag_url IS NULL").run();
    }
    if (getState("fragPrepV1") !== "1") {
      setState("fragPrepV1", "1");
      db().prepare("UPDATE products SET frag_checked_at = NULL WHERE frag_url IS NULL").run();
    }
    if (getState("fragFixWrongV1") !== "1") {
      setState("fragFixWrongV1", "1");
      // casados errado antes da regra nova: volta o nome original e procura de novo
      const undo = db().prepare("UPDATE products SET name = ?, frag_url = NULL, frag_name = NULL, frag_brand = NULL, frag_data = NULL, frag_checked_at = NULL, fragram_at = NULL WHERE name = ?");
      undo.run("Rabanne 1 Million Gold Eau de Parfum Intense 100ml", "Rabanne Million Gold For Her 100ml");
      db().prepare("UPDATE products SET name = 'Natura Homem Evolutio 100ml', frag_url = NULL, frag_name = NULL, frag_brand = NULL, frag_data = NULL, frag_checked_at = NULL, fragram_at = NULL WHERE id = (SELECT id FROM products WHERE name = 'Natura Homem 100ml' AND frag_checked_at BETWEEN '2026-11-17 16:47:00' AND '2026-11-17 16:50:00' LIMIT 1)").run();
      db().prepare("UPDATE products SET frag_checked_at = NULL WHERE frag_url IS NULL").run();
    }
    if (getState("fragRoyalV1") !== "1") {
      setState("fragRoyalV1", "1");
      db().prepare("UPDATE products SET frag_checked_at = NULL WHERE frag_url IS NULL AND lower(name) LIKE '%royal collection%'").run();
    }
    if (getState("approvalV1") !== "1") {
      setState("approvalV1", "1");
      // Arthur (17/nov): perfume novo só sai depois que ele aprova. O que já saiu ou já tem foto escolhida é do nosso leque.
      const n = db()
        .prepare(
          `UPDATE products SET approved = 1 WHERE approved IS NULL AND COALESCE(blocked,0) = 0
           AND (main_image_id IS NOT NULL OR EXISTS (SELECT 1 FROM posts q WHERE q.product_id = products.id AND q.status = 'sent'))`,
        )
        .run().changes;
      log("info", `Aprovação: ${n} perfume(s) já do nosso leque marcados como aprovados`);
    }
    if (getState("fragNoRepeatV1") !== "1") {
      setState("fragNoRepeatV1", "1");
      // Arthur (17/nov): perfume já procurado no Fragrantica não é procurado de novo (gasto à toa).
      // Todo não achado criado antes das 16:55 já tinha sido procurado (pelo menos uma vez) antes de hoje à tarde.
      const n = db()
        .prepare(
          `UPDATE products SET frag_searched = 1, frag_checked_at = COALESCE(frag_checked_at, datetime('now'))
           WHERE frag_url IS NULL AND (created_at < '2026-11-17 16:55:00' OR id IN (SELECT product_id FROM api_calls WHERE kind IN ('frag_search','frag_google') AND ok = 1))`,
        )
        .run().changes;
      db().prepare("UPDATE products SET frag_searched = 1 WHERE frag_url IS NOT NULL").run();
      log("info", `Fragrantica: ${n} perfume(s) já procurados marcados para não procurar de novo`);
    }
    // Arthur (nov/2026): posta até as 23h
    if (getState("activeTo23") !== "1") {
      saveSettings({ activeTo: "23:00" });
      setState("activeTo23", "1");
      log("info", "Janela de envio: agora vai até as 23:00");
    }
    // IA desligada a pedido (sem chave no Railway): desliga e apaga a chave salva no painel
    // geração de imagem por IA fica desligada (pedido do Arthur; o código fica em imagefix.ts para outro momento)
    if (getState("envImageFix") !== "off") {
      saveSettings({ imageFixEnabled: false, openaiApiKey: "", aiEnabled: false });
      setState("envImageFix", "off");
      log("info", "IA desligada: imagens com IA e leitura com IA desativadas, chave da OpenAI removida");
    }
  });
  // fotos: medidas das fotos antigas (para a escolha automática aprender com as principais)
  setTimeout(() => import("./photoprefs.ts").then((m) => m.backfillFeatures()).catch((e) => log("warn", `Fotos: ${(e as Error).message}`)), 90e3);
  // notas com lixo do link ("🎯 f_from_perfume_id, ...") nos posts que ainda não saíram
  {
    const rows = db().prepare("SELECT id, formatted_text FROM posts WHERE status IN ('queued','photo','review','failed') AND formatted_text LIKE '%f_from_perfume_id%'").all() as { id: number; formatted_text: string }[];
    for (const r of rows) {
      const t = r.formatted_text.replace(/f_from_perfume_id,\s*/g, "").replace(/,\s*f_from_perfume_id/g, "").replace(/^🎯 f_from_perfume_id\s*\n\n?/m, "");
      db().prepare("UPDATE posts SET formatted_text = ? WHERE id = ?").run(t, r.id);
    }
    if (rows.length) log("info", `Notas: ${rows.length} post(s) da fila corrigido(s)`);
  }
    // concentração saiu do post (só serve para a busca): limpa a linha da marca dos posts que ainda não saíram
  {
    const rows = db().prepare("SELECT id, formatted_text FROM posts WHERE status IN ('queued','photo','review','failed') AND formatted_text LIKE '%🏷️%·%·%'").all() as { id: number; formatted_text: string }[];
    let n = 0;
    for (const r of rows) {
      const t = r.formatted_text.replace(/^(🏷️ .*?) · (?:Parfum|Eau de Parfum|Eau de Toilette|Extrait de Parfum|Colônia|Deo Parfum)( · \d+ml)?$/m, "$1$2");
      if (t !== r.formatted_text) (db().prepare("UPDATE posts SET formatted_text = ? WHERE id = ?").run(t, r.id), n++);
    }
    if (n) log("info", `Concentração tirada de ${n} post(s) da fila`);
  }
    // agente de nomes (Arthur, 17/nov): sincroniza o tempo todo os nomes que chegam dos grupos com o que já temos no banco
  {
    const g = globalThis as { __syncNames?: NodeJS.Timeout };
    const run = () =>
      import("./curation.ts")
        .then((m) => m.syncNames())
        .catch((e) => log("warn", `Agente de nomes: ${(e as Error).message}`));
    setTimeout(run, 20e3);
    if (!g.__syncNames) g.__syncNames = setInterval(run, 10 * 60e3);
  }
  // "Rayhaan Aquatica" tinha sido juntado ao "Mawwal Rayhan" (aquatica é nome, não família olfativa)
  if (!getState("unmergeAquaticaV1"))
    import("./curation.ts").then((m) => {
      const n = m.unmergeOffers("%Rayhan%", /Aquatica/i);
      setState("unmergeAquaticaV1", "1");
      if (n) log("info", `Agente de nomes: ${n} oferta(s) de Rayhaan Aquatica separadas de novo`);
    });
  // junções erradas da 2ª rodada do agente de nomes: Profondo, MYSLF EDP e combo voltam a ser perfumes separados
  if (!getState("unmergeV2"))
    import("./curation.ts").then((m) => {
      const n =
        m.unmergeOffers("Giorgio Armani Acqua di Gio 50ml", /profondo/i) +
        m.unmergeOffers("Giorgio Armani Acqua di Gio 200ml", /profondo/i) +
        m.unmergeOffers("%MYSLF Le Parfum 100ml", /^(?![\s\S]*le parfum)[\s\S]*myslf/i) +
        m.unmergeOffers("O Boticário Egeo Choc High%90ml", /\b(combo|kit)\b/i);
      setState("unmergeV2", "1");
      log("info", `Agente de nomes: ${n} oferta(s) separadas de junções erradas (Profondo, MYSLF EDP, combo)`);
    });
  // 3ª rodada: nomes de uma letra (YSL Y, Eudora H, Prada L'Homme) e "2x" tinham sido juntados errado
  if (!getState("unmergeV3"))
    import("./curation.ts").then((m) => {
      m.reassignMismatched("Yves Saint Laurent Y 100ml");
      m.reassignMismatched("O Boticário Liz Flora Desodorante Colônia 100ml");
      m.reassignMismatched("Natura Kaiak 100ml");
      setState("unmergeV3", "1");
    });
  // busca do Fragrantica refeita com o nome limpo para quem está esperando foto e não foi achado (uma vez)
  // Arthur (22/nov): "costuma sair por R$ X em outros grupos" (era "nos grupos") nos posts de ofertas que ainda não saíram
  db().prepare("UPDATE posts SET formatted_text = replace(formatted_text, ' nos grupos', ' em outros grupos') WHERE dest IS NOT NULL AND status IN ('review','photo','queued') AND formatted_text LIKE '%costuma sair por%nos grupos%'").run();
  if (!getState("fragRetryCleanV1")) {
    const r = db()
      .prepare("UPDATE products SET frag_searched = 0, frag_checked_at = NULL WHERE frag_url IS NULL AND frag_searched > 0 AND id IN (SELECT product_id FROM posts WHERE status = 'photo')")
      .run();
    setState("fragRetryCleanV1", "1");
    if (r.changes) log("info", `Fragrantica: ${r.changes} perfume(s) esperando foto vão ser procurados de novo com o nome limpo`);
  }
    // "Parfum" separado da versão comum (Arthur, 17/nov: Stronger With You Parfum foi postado com o nome do comum)
  import("./curation.ts").then(({ splitParfum, fixParfumSplit }) => {
    if (!getState("splitParfumV1")) {
      try {
        const n = splitParfum();
        log("info", `Parfum separado da versão comum: ${n} oferta(s) movida(s)`);
      } catch (e) {
        log("warn", `Parfum: ${(e as Error).message}`);
      }
    }
    setState("splitParfumV1", "1");
    if (getState("fixParfumV2")) return;
    try {
      log("info", `Parfum: ${fixParfumSplit()} separação(ões) desfeita(s) (Natura Deo Parfum e linhas só Parfum)`);
    } catch (e) {
      log("warn", `Parfum v2: ${(e as Error).message}`);
    }
    setState("fixParfumV2", "1");
  });
  // "Deo Parfum" (Natura/Boticário) passa a ter concentração própria, separada de "Parfum"
  import("./settings.ts").then(({ getState, setState }) => {
    if (getState("deoParfumV1")) return;
    const r = db()
      .prepare("UPDATE products SET conc = 'deo', pkey = REPLACE(pkey, '|parfum', '|deo') WHERE conc = 'parfum' AND (LOWER(name) LIKE '%deo parfum%' OR LOWER(name) LIKE '%deo-parfum%' OR LOWER(name) LIKE '%deoparfum%')")
      .run();
    setState("deoParfumV1", "1");
    if (r.changes) log("info", `${r.changes} perfume(s) "Deo Parfum" separados de "Parfum"`);
  });
  // grupos: 3 de promoção (RP, Herói, Clube do Perfume); os outros só fornecem fotos.
  // Prioridade de fotos: RP (sem marca) > MD Links > Vitrine.
  import("./settings.ts").then(({ getState, setState }) => {
    if (getState("groupsSetupV1")) return;
    const groups = db().prepare("SELECT jid, name FROM groups WHERE role = 'source'").all() as { jid: string; name: string }[];
    const has = (n: string, re: RegExp) => re.test(n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
    for (const g of groups) {
      const promo = has(g.name, /rp promos|heroi do perfume|clube do perfume/) ? 1 : 0;
      const prio = has(g.name, /rp promos/) ? 3 : has(g.name, /md links/) ? 2 : has(g.name, /vitrine/) ? 1 : 0;
      const rm = has(g.name, /rp promos/) ? 1 : 0;
      db().prepare("UPDATE groups SET promo = ?, photo_priority = ?, wm_remove = ? WHERE jid = ?").run(promo, prio, rm, g.jid);
      if (has(g.name, /vitrine/)) db().prepare("UPDATE groups SET watermark = 0 WHERE jid = ?").run(g.jid);
    }
    setState("groupsSetupV1", "1");
    log("info", `Grupos: ${groups.filter((g) => has(g.name, /rp promos|heroi do perfume|clube do perfume/)).length} de promoção, o resto só fotos`);
  });
  // Teste de tirar marca d'água encerrado (Arthur não gostou do resultado): nada na fila, nenhum grupo com "tirar marca".
  // Depois, um levantamento de quais grupos mandam fotos sem marca.
  import("./settings.ts").then(({ getState, setState }) => {
    if (!getState("unwmOffV1")) {
      db().prepare("UPDATE groups SET wm_remove = 0").run();
      db().prepare("UPDATE image_fixes SET status = 'wm_off', updated_at = datetime('now') WHERE status IN ('wm_queued', 'wm_ready')").run();
      setState("unwmOffV1", "1");
      log("info", "Marca d'água: teste desligado");
    }
    if (!getState("groupSurveyV1"))
      setTimeout(() => {
        setState("groupSurveyV1", "1");
        import("./groupsurvey.ts").then((m) => m.surveyGroups()).catch((e) => log("warn", `Levantamento de fotos: ${(e as Error).message}`));
      }, 120_000);
  });
  // Pinterest (teste): busca fotos para ~10 perfumes das promoções com menos de 2 fotos; tudo espera aprovação.
  import("./settings.ts").then(({ getState, setState }) => {
    import("./pinterest.ts")
      .then(async (m) => {
        await m.importPinSeed();
        await m.recheckAllPins();
        await (await import("./pinlearn.ts")).trainOnStart();
      })
      .catch((e) => log("warn", `Pinterest: ${(e as Error).message}`));
    if (getState("pinTestV1") || !process.env.APIFY_TOKEN) return;
    setTimeout(() => {
      setState("pinTestV1", "1");
      import("./pinterest.ts").then((m) => m.pinTestBatch(10)).catch((e) => log("warn", `Pinterest: ${(e as Error).message}`));
    }, 90_000);
  });
  // Fotos limpas (teste de marca d'água) que entraram no banco antes da tela de aprovação: voltam para a aprovação.
  import("./settings.ts").then(({ getState, setState }) => {
    if (getState("unwmGateV1")) return;
    const rows = db().prepare("SELECT id, product_id, path, message_id FROM images WHERE message_id LIKE 'lama:%'").all() as {
      id: number; product_id: number; path: string; message_id: string;
    }[];
    for (const r of rows) {
      const fixId = Number(r.message_id.slice(5));
      const f = db().prepare("SELECT out_path FROM image_fixes WHERE id = ?").get(fixId) as { out_path: string | null } | undefined;
      db().prepare("UPDATE products SET main_image_id = NULL WHERE main_image_id = ?").run(r.id);
      db().prepare("DELETE FROM images WHERE id = ?").run(r.id);
      if (r.path !== f?.out_path) fs.rmSync(r.path, { force: true });
      db().prepare("UPDATE image_fixes SET status = 'wm_ready', updated_at = datetime('now') WHERE id = ?").run(fixId);
    }
    setState("unwmGateV1", "1");
    if (rows.length) log("info", `Marca d'água: ${rows.length} foto(s) limpas tiradas dos posts e voltaram para a sua aprovação`);
  });
  // volume de postagens de cada grupo (ontem e hoje) nos logs, 1 min depois de subir
  setTimeout(() => import("./volume.ts").then((m) => m.logGroupVolume()).catch((e) => log("warn", `Volume: ${(e as Error).message}`)), 60e3);
}
