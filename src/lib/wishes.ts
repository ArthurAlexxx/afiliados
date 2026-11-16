/**
 * "Me avisa quando baixar".
 * - 2x por dia o grupo recebe uma chamada: "responda com o nome do perfume que você quer".
 * - Quem responde (ou escreve "me avisa <perfume>") vira um pedido guardado.
 * - Quando o agente posta uma oferta boa daquele perfume, a pessoa recebe no privado.
 * Limites para não parecer spam: 1 aviso por pedido a cada 24h, pedidos valem 30 dias,
 * no máximo 25 avisos por post e alguns segundos entre um envio e outro.
 */
import { db, log } from "./db.ts";
import { getSettings, getState, setState } from "./settings.ts";
import { Evolution } from "./evolution.ts";
import { nameTokens, norm } from "./perfume.ts";

const CALL_TEXT = `🔔 *ME AVISA QUANDO BAIXAR*

Tá de olho em algum perfume? *Responda esta mensagem* com o nome dele (ex: Asad, Sauvage, Club de Nuit) e eu te aviso no privado quando sair uma oferta boa. 💬`;

/** Horários da chamada no grupo (fuso do painel). */
const CALL_TIMES = ["12:30", "19:30"];

const nowTz = (tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const todayTz = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

type ProductRow = { id: number; name: string };

function matches(query: string, tokens: string[], productName: string) {
  const pt = new Set(nameTokens(productName));
  if (tokens.length) return tokens.every((t) => pt.has(t));
  // pedido só com a marca ("lattafa"): basta o nome do perfume conter a marca
  return query.length >= 3 && ` ${norm(productName)} `.includes(` ${query} `);
}

function findProduct(query: string, tokens: string[]): ProductRow | null {
  const rows = db()
    .prepare(
      `SELECT p.id, p.name, COUNT(o.id) n FROM products p LEFT JOIN offers o ON o.product_id = p.id
       GROUP BY p.id ORDER BY n DESC LIMIT 2000`,
    )
    .all() as (ProductRow & { n: number })[];
  return rows.find((r) => matches(query, tokens, r.name)) || null;
}

/** Limpa o pedido: tira "me avisa", "quero", "o", "do" etc. */
function cleanWish(text: string) {
  return text
    .replace(/@\d+/g, " ")
    .replace(/\b(me\s+)?avisa(r)?\b|\bquero\b|\bqueria\b|\bpor favor\b|\bpfv\b|\bpf\b|\bquando\b|\bbaixar\b|\bo perfume\b|\bperfume\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lê uma mensagem do nosso grupo e guarda o pedido, se for um. */
export async function handleWishMessage(m: {
  messageId: string;
  memberJid: string;
  memberName?: string;
  text: string;
  replyTo?: string | null;
}): Promise<string> {
  const isReplyToCall = m.replyTo ? Boolean(db().prepare("SELECT 1 FROM wish_calls WHERE message_id = ?").get(m.replyTo)) : false;
  const isAvisa = /^\s*(me\s+)?avisa\b/i.test(m.text);
  if (!isReplyToCall && !isAvisa) return "ignorado: mensagem do nosso grupo";
  if (!m.memberJid) return "pedido sem remetente";
  const wish = cleanWish(m.text).slice(0, 80);
  const query = norm(wish);
  const tokens = nameTokens(wish);
  if (query.replace(/\s/g, "").length < 3) return "pedido vazio";

  // pedido só com a marca ("lattafa") vale para todos os perfumes dela
  const product = tokens.length ? findProduct(query, tokens) : null;
  const dup = db()
    .prepare("SELECT id FROM wishes WHERE member_jid = ? AND query = ? AND active = 1")
    .get(m.memberJid, query);
  if (!dup) {
    db()
      .prepare("INSERT INTO wishes (member_jid, member_name, text, query, tokens, product_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(m.memberJid, m.memberName || null, wish, query, JSON.stringify(tokens), product?.id ?? null);
  }
  const label = product?.name || wish;
  log("info", `Pedido "me avisa": ${m.memberName || m.memberJid} quer "${wish}"${product ? ` (${product.name})` : ""}`);
  try {
    await new Evolution(getSettings()).sendText(
      m.memberJid,
      `Anotado! 🔔 Te aviso aqui quando sair uma oferta boa de *${label}*.\n\n_Para parar, responda "parar"._`,
    );
  } catch (e) {
    log("warn", `Não consegui confirmar o pedido no privado: ${(e as Error).message}`);
  }
  return `pedido guardado: ${label}`;
}

/** Mensagem no privado: "parar" cancela todos os pedidos da pessoa. */
export function handlePrivateMessage(memberJid: string, text: string): string {
  if (!/^\s*(parar|pare|stop|sair|cancelar)\s*$/i.test(text)) return "ignorado: privado";
  const r = db().prepare("UPDATE wishes SET active = 0 WHERE member_jid = ? AND active = 1").run(memberJid);
  if (r.changes) {
    new Evolution(getSettings()).sendText(memberJid, "Pronto, não te aviso mais. 👍").catch(() => {});
  }
  return `pedidos cancelados: ${r.changes}`;
}

/** Depois que um post do agente sai no grupo: avisa no privado quem pediu aquele perfume. */
export async function notifyWishes(post: { productId: number; titulo: string; preco: string; link: string }) {
  const s = getSettings();
  db().prepare("UPDATE wishes SET active = 0 WHERE active = 1 AND created_at < datetime('now','-30 days')").run();
  const rows = db()
    .prepare(
      `SELECT id, member_jid, query, tokens, product_id FROM wishes
       WHERE active = 1 AND (notified_at IS NULL OR notified_at < datetime('now','-24 hours'))`,
    )
    .all() as { id: number; member_jid: string; query: string; tokens: string; product_id: number | null }[];
  const hits = rows.filter((w) => w.product_id === post.productId || matches(w.query, JSON.parse(w.tokens), post.titulo));
  const seen = new Set<string>();
  const evo = new Evolution(s);
  let sent = 0;
  for (const w of hits) {
    if (seen.has(w.member_jid) || sent >= 25) continue;
    seen.add(w.member_jid);
    try {
      await evo.sendText(
        w.member_jid,
        `🔔 *Baixou o perfume que você pediu!*\n\n*${post.titulo}*\n✅ POR: R$${post.preco}\n\n📎 ${post.link}\n\n_Para parar os avisos, responda "parar"._`,
      );
      db().prepare("UPDATE wishes SET notified_at = datetime('now'), notify_count = notify_count + 1 WHERE id = ?").run(w.id);
      sent++;
      await new Promise((r) => setTimeout(r, 4000 + Math.random() * 3000));
    } catch (e) {
      log("warn", `Aviso no privado falhou: ${(e as Error).message}`);
    }
  }
  if (sent) log("info", `"Me avisa": ${sent} pessoa(s) avisada(s) sobre ${post.titulo}`);
}

/** Chamada no grupo 2x por dia (12:30 e 19:30). Devolve true se postou. */
export async function maybeSendWishCall(): Promise<boolean> {
  const s = getSettings();
  if (!s.wishesEnabled) return false;
  const tz = s.timezone || "America/Sao_Paulo";
  const now = nowTz(tz);
  const today = todayTz(tz);
  const due = CALL_TIMES.filter((t) => now >= t && now < addMin(t, 90));
  for (const t of due) {
    const key = `wishCall:${today}:${t}`;
    if (getState(key)) continue;
    setState(key, "1");
    const dests = db().prepare("SELECT jid FROM groups WHERE role = 'destination'").all() as { jid: string }[];
    const evo = new Evolution(s);
    for (const d of dests) {
      try {
        const r = (await evo.sendText(d.jid, CALL_TEXT)) as { key?: { id?: string } };
        if (r?.key?.id) db().prepare("INSERT OR IGNORE INTO wish_calls (message_id) VALUES (?)").run(r.key.id);
      } catch (e) {
        log("warn", `Chamada "me avisa" falhou: ${(e as Error).message}`);
      }
    }
    setState("lastSentAt", String(Date.now()));
    log("info", `Chamada "me avisa quando baixar" enviada (${t})`);
    return true;
  }
  return false;
}

function addMin(hhmm: string, m: number) {
  const [h, mm] = hhmm.split(":").map(Number);
  const t = h * 60 + mm + m;
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function wishStats() {
  const q = (sql: string) => (db().prepare(sql).get() as { n: number }).n;
  return {
    active: q("SELECT COUNT(*) n FROM wishes WHERE active = 1"),
    people: q("SELECT COUNT(DISTINCT member_jid) n FROM wishes WHERE active = 1"),
    notified: q("SELECT COALESCE(SUM(notify_count),0) n FROM wishes"),
    top: db()
      .prepare("SELECT COALESCE(p.name, w.text) name, COUNT(*) n FROM wishes w LEFT JOIN products p ON p.id = w.product_id WHERE w.active = 1 GROUP BY COALESCE(w.product_id, w.query) ORDER BY n DESC LIMIT 10")
      .all(),
  };
}
