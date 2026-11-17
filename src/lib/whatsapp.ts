/**
 * Página "WhatsApp" do painel: espelho (somente leitura) da caixa de entrada do nosso número na Evolution.
 * O nosso grupo (destino) fica fixado no topo.
 */
import fs from "node:fs";
import path from "node:path";
import { db, MEDIA_DIR } from "./db.ts";
import { Evolution } from "./evolution.ts";
import { getSettings } from "./settings.ts";

export type WaChat = { jid: string; name: string; pic: string | null; group: boolean; pinned: boolean; ts: number; unread: number; last: WaMsg | null; role: string | null };
export type WaMsg = {
  id: string; fromMe: boolean; ts: number; sender: string | null; senderJid: string | null; type: string;
  text: string; media: boolean; thumb: string | null; quoted: string | null; status: string | null; w: number | null; h: number | null;
};

const evo = () => new Evolution(getSettings());
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const tsOf = (v: unknown): number => {
  if (typeof v === "number") return v > 1e12 ? Math.round(v / 1000) : v;
  if (typeof v === "string") return /^\d+$/.test(v) ? Number(v) : Math.round(new Date(v).getTime() / 1000) || 0;
  if (v && typeof v === "object" && "low" in (v as Any)) return Number((v as Any).low);
  return 0;
};

export function normMsg(r: Any): WaMsg | null {
  const key = r.key || {};
  let m: Any = r.message || {};
  // mensagens "embrulhadas" (temporárias, ver uma vez, editadas)
  for (const w of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "documentWithCaptionMessage", "editedMessage"]) if (m[w]?.message) m = m[w].message;
  const type = String(r.messageType || Object.keys(m).find((k) => k !== "messageContextInfo") || "unknown");
  if (/protocolMessage|reactionMessage|senderKeyDistributionMessage|pollUpdateMessage/.test(type)) return null;
  const body = m[type] || {};
  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    body.caption ||
    body.text ||
    (type === "documentMessage" ? body.fileName || "Documento" : "") ||
    (type === "pollCreationMessage" || type === "pollCreationMessageV3" ? `📊 ${body.name || "Enquete"}` : "") ||
    (type === "contactMessage" ? `👤 ${body.displayName || "Contato"}` : "") ||
    (type === "locationMessage" ? "📍 Localização" : "") ||
    "";
  const thumb = body.jpegThumbnail
    ? `data:image/jpeg;base64,${typeof body.jpegThumbnail === "string" ? body.jpegThumbnail : Buffer.from(Object.values(body.jpegThumbnail as Record<string, number>)).toString("base64")}`
    : null;
  const ctx = (m.extendedTextMessage || body)?.contextInfo;
  const q = ctx?.quotedMessage;
  const quoted = q ? q.conversation || q.extendedTextMessage?.text || q.imageMessage?.caption || (q.imageMessage ? "📷 Foto" : "Mensagem") : null;
  return {
    id: String(key.id || r.id || ""),
    fromMe: Boolean(key.fromMe),
    ts: tsOf(r.messageTimestamp),
    sender: r.pushName || null,
    senderJid: key.participant || r.participant || null,
    type: type.replace(/Message$/, ""),
    text: String(text || ""),
    media: /image|video|sticker|audio|document/.test(type),
    thumb,
    quoted,
    w: Number(body.width) || null,
    h: Number(body.height) || null,
    status: r.status || (Array.isArray(r.MessageUpdate) && r.MessageUpdate.length ? r.MessageUpdate[r.MessageUpdate.length - 1].status : null),
  };
}

let chatCache: { at: number; rows: WaChat[] } | null = null;
export async function listChats(): Promise<WaChat[]> {
  if (chatCache && Date.now() - chatCache.at < 10e3) return chatCache.rows;
  const groups = new Map((db().prepare("SELECT jid, name, role FROM groups").all() as { jid: string; name: string; role: string }[]).map((g) => [g.jid, g]));
  const raw = await evo().findChats();
  const rows: WaChat[] = [];
  for (const c of raw as Any[]) {
    const jid = String(c.remoteJid || c.id || "");
    if (!jid || jid === "status@broadcast" || jid.endsWith("@newsletter")) continue;
    const g = groups.get(jid);
    const last = c.lastMessage ? normMsg(c.lastMessage) : null;
    rows.push({
      jid,
      name: g?.name || c.name || c.pushName || c.subject || jid.split("@")[0],
      pic: c.profilePicUrl || null,
      group: jid.endsWith("@g.us"),
      pinned: g?.role === "destination",
      ts: last?.ts || tsOf(c.updatedAt),
      unread: Number(c.unreadCount || c.unreadMessages || 0),
      last,
      role: g?.role || null,
    });
  }
  // nosso grupo sempre aparece, mesmo sem conversa recente
  for (const g of groups.values())
    if (g.role === "destination" && !rows.some((r) => r.jid === g.jid))
      rows.push({ jid: g.jid, name: g.name, pic: null, group: true, pinned: true, ts: 0, unread: 0, last: null, role: g.role });
  rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.ts - a.ts);
  chatCache = { at: Date.now(), rows };
  return rows;
}

export async function chatMessages(jid: string, limit = 60): Promise<WaMsg[]> {
  const list = await evo().findMessages(jid, limit, 1);
  return list
    .map((r) => normMsg(r as Any))
    .filter((m): m is WaMsg => !!m && !!m.id)
    .sort((a, b) => a.ts - b.ts);
}

const CACHE = path.join(MEDIA_DIR, "wa-cache");
export async function mediaOf(id: string): Promise<{ buf: Buffer; type: string } | null> {
  const safe = id.replace(/[^\w-]/g, "");
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, safe);
  if (fs.existsSync(f) && fs.existsSync(f + ".type")) return { buf: fs.readFileSync(f), type: fs.readFileSync(f + ".type", "utf8") };
  const r = await evo().getBase64FromMediaMessage(safe).catch(() => null);
  if (!r?.base64) return null;
  const buf = Buffer.from(r.base64, "base64");
  const type = r.mimetype || "image/jpeg";
  fs.writeFileSync(f, buf);
  fs.writeFileSync(f + ".type", type);
  return { buf, type };
}

const picCache = new Map<string, { at: number; url: string | null }>();
export async function picOf(jid: string): Promise<string | null> {
  const c = picCache.get(jid);
  if (c && Date.now() - c.at < 6 * 3600e3) return c.url;
  const url = await evo().profilePictureUrl(jid).catch(() => null);
  picCache.set(jid, { at: Date.now(), url });
  return url;
}
