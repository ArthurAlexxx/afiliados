import { generateVAPIDKeys, sendNotification } from "web-push";
import { db, log } from "./db.ts";
import { getState, setState } from "./settings.ts";

/** Avisos no celular (Web Push). As chaves VAPID são geradas uma vez e ficam no banco. */
function keys(): { publicKey: string; privateKey: string } {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  const saved = getState("vapid");
  if (saved) return JSON.parse(saved);
  const k = generateVAPIDKeys();
  setState("vapid", JSON.stringify(k));
  return k;
}

function table() {
  db().exec("CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, json TEXT NOT NULL, ua TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
}

export function pushPublicKey() {
  return keys().publicKey;
}

export function saveSubscription(sub: { endpoint: string }, ua: string) {
  table();
  db().prepare("INSERT INTO push_subs (endpoint, json, ua) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET json = excluded.json, ua = excluded.ua").run(sub.endpoint, JSON.stringify(sub), ua);
}

export function removeSubscription(endpoint: string) {
  table();
  db().prepare("DELETE FROM push_subs WHERE endpoint = ?").run(endpoint);
}

export function subscriptionCount(): number {
  table();
  return (db().prepare("SELECT COUNT(*) n FROM push_subs").get() as { n: number }).n;
}

/** Manda o aviso para todos os celulares cadastrados (falha não atrapalha o resto do robô). */
export async function sendPush(msg: { title: string; body: string; url?: string; tag?: string }) {
  try {
    table();
    const subs = db().prepare("SELECT endpoint, json FROM push_subs").all() as { endpoint: string; json: string }[];
    if (!subs.length) return;
    const k = keys();
    await Promise.all(
      subs.map((s) =>
        sendNotification(JSON.parse(s.json), JSON.stringify(msg), { TTL: 3600, vapidDetails: { subject: "mailto:avisos@afiliados.app", publicKey: k.publicKey, privateKey: k.privateKey } }).catch((e: { statusCode?: number; message?: string }) => {
          // celular desinstalou ou tirou a permissão: esquece
          if (e.statusCode === 404 || e.statusCode === 410) removeSubscription(s.endpoint);
          else log("warn", `Aviso no celular: ${e.message || e.statusCode}`);
        }),
      ),
    );
  } catch (e) {
    log("warn", `Aviso no celular: ${(e as Error).message}`);
  }
}
