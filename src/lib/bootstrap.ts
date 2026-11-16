import { log } from "./db.ts";
import { Evolution } from "./evolution.ts";
import { getSettings, webhookUrl } from "./settings.ts";

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
