import { db, log } from "./db.ts";
import { Evolution } from "./evolution.ts";
import { getSettings, getState, setState, webhookUrl, type Settings } from "./settings.ts";

/** Atualiza a lista de grupos da instância. */
export async function syncGroups(s: Settings = getSettings()) {
  const list = await new Evolution(s).fetchAllGroups();
  const stmt = db().prepare(
    `INSERT INTO groups (jid, name, size, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(jid) DO UPDATE SET name = excluded.name, size = excluded.size, updated_at = excluded.updated_at`,
  );
  for (const g of Array.isArray(list) ? list : []) stmt.run(g.id, g.subject || g.id, g.size || 0);
  return Array.isArray(list) ? list.length : 0;
}

function re(v?: string) {
  if (!v) return null;
  try {
    return new RegExp(v, "i");
  } catch {
    return null;
  }
}

/**
 * Configuração inicial dos grupos pelo nome (variáveis AUTO_SOURCE_GROUPS, AUTO_DEST_GROUP, AUTO_WATERMARK_GROUPS,
 * todas regex). Aplicada uma vez e só em grupos sem papel definido, para não desfazer o que for mudado no painel.
 * Depois importa o histórico dos grupos de origem para o banco de ofertas e fotos.
 */
async function autoSetupGroups(s: Settings) {
  const src = re(process.env.AUTO_SOURCE_GROUPS);
  const dest = re(process.env.AUTO_DEST_GROUP);
  const wm = re(process.env.AUTO_WATERMARK_GROUPS);
  if (!src && !dest && !wm) return;
  const sig = [src, dest, wm].map(String).join("|");
  if (getState("autoGroups") === sig) return;

  const state = await new Evolution(s).connectionState().catch(() => null);
  if (state?.instance?.state !== "open") return;
  const n = await syncGroups(s);
  if (!n) return;
  const rows = db().prepare("SELECT jid, name, role FROM groups").all() as { jid: string; name: string; role: string }[];
  const setRole = db().prepare("UPDATE groups SET role = ? WHERE jid = ?");
  const setWm = db().prepare("UPDATE groups SET watermark = 1 WHERE jid = ?");
  const done: string[] = [];
  for (const g of rows) {
    if (g.role === "none" && dest?.test(g.name)) {
      setRole.run("destination", g.jid);
      done.push(`${g.name} → destino`);
    } else if (g.role === "none" && src?.test(g.name)) {
      setRole.run("source", g.jid);
      done.push(`${g.name} → origem`);
    }
    if (wm?.test(g.name)) setWm.run(g.jid);
  }
  setState("autoGroups", sig);
  if (done.length) log("info", `Grupos configurados automaticamente: ${done.join(", ")}`);

  if (!getState("historyImported")) {
    const { importHistory } = await import("./curation.ts");
    const r = await importHistory();
    setState("historyImported", new Date().toISOString());
    return r;
  }
}

/**
 * Deixa a Evolution pronta sem nenhuma configuração manual:
 * 1) cria a instância se ela não existir;
 * 2) aponta o webhook da instância para este painel.
 * Roda na inicialização e é repetido a cada 10 minutos (idempotente).
 */
export async function ensureEvolution(): Promise<string> {
  const s = getSettings();
  const evo = new Evolution(s);
  if (!evo.configured) return "evolution não configurada";

  try {
    await evo.connectionState();
  } catch (e) {
    if (/404|not exist|not found/i.test((e as Error).message)) {
      await evo.createInstance();
      log("info", `Instância "${s.evolutionInstance}" criada na Evolution API`);
    } else {
      log("warn", `Evolution indisponível: ${(e as Error).message}`);
      return "evolution indisponível";
    }
  }

  const url = webhookUrl(s);
  if (!url) return "sem URL pública para o webhook";
  try {
    const current = await evo.findWebhook().catch(() => null);
    if (!current || current.url !== url || current.enabled === false) {
      await evo.setWebhook(url);
      log("info", `Webhook da Evolution configurado para ${url.replace(/token=.*/, "token=•••")}`);
    }
  } catch (e) {
    log("warn", `Não consegui configurar o webhook: ${(e as Error).message}`);
    return "falha no webhook";
  }
  await autoSetupGroups(s).catch((e) => log("warn", `Configuração automática dos grupos: ${(e as Error).message}`));
  return "ok";
}

type G = typeof globalThis & { __afiliadosBoot?: NodeJS.Timeout };
export function startBootstrap() {
  const g = globalThis as G;
  if (g.__afiliadosBoot) return;
  const run = () => ensureEvolution().catch((e) => log("warn", `Bootstrap: ${(e as Error).message}`));
  setTimeout(run, 5000);
  g.__afiliadosBoot = setInterval(run, 10 * 60 * 1000);
}
