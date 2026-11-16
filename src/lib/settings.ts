import { db } from "./db.ts";

import { DEFAULT_TEMPLATE } from "./parser.ts";
export { DEFAULT_TEMPLATE };

export type Settings = {
  // Evolution API
  evolutionUrl: string;
  evolutionApiKey: string;
  evolutionInstance: string;
  webhookToken: string;
  publicUrl: string;

  // Mercado Livre afiliados
  meliStrategy: "generator" | "params";
  meliTag: string;
  meliCookie: string;
  meliCsrf: string;
  meliMattTool: string;
  meliExtraParams: string;

  // Encurtador
  shortener: "none" | "tinyurl" | "isgd" | "bitly";
  bitlyToken: string;

  // Regras
  sendMode: "auto" | "manual";
  requireMeliLink: boolean;
  otherLinks: "remove" | "keep";
  onConvertFail: "skip" | "pending";
  sendImage: boolean;
  fetchProductImage: boolean;
  dedupHours: number;
  minIntervalSeconds: number;
  activeFrom: string; // "07:00"
  activeTo: string; // "23:30"
  timezone: string;
  blocklist: string; // uma palavra por linha
  ignoreFromMe: boolean;

  // Template
  template: string;

  // Curadoria: em vez de repostar tudo, escolhe a melhor promoção entre os grupos
  mode: "curated" | "repost";
  curationIntervalMinutes: number; // 0 = sem rodada fixa
  curationInstantScore: number; // nota mínima para postar na hora em que a promoção chega
  curationCooldownHours: number;
  curationLookbackMinutes: number;
  curationRequireImage: boolean;

  // Identidade visual (etiquetas na foto)
  brandEnabled: boolean;
  brandName: string; // vazio = nome do grupo de destino
  brandInstagram: string;

  // IA opcional
  aiEnabled: boolean;
  anthropicApiKey: string;
  aiModel: string;
};

export const SECRET_KEYS: (keyof Settings)[] = [
  "evolutionApiKey",
  "meliCookie",
  "meliCsrf",
  "bitlyToken",
  "anthropicApiKey",
];

const env = process.env;

export function defaults(): Settings {
  return {
    evolutionUrl: env.EVOLUTION_API_URL || "",
    evolutionApiKey: env.EVOLUTION_API_KEY || "",
    evolutionInstance: env.EVOLUTION_INSTANCE || "afiliados",
    webhookToken: env.WEBHOOK_TOKEN || "",
    publicUrl: env.PUBLIC_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : ""),

    meliStrategy: (env.MELI_STRATEGY as Settings["meliStrategy"]) || "generator",
    meliTag: env.MELI_AFFILIATE_TAG || "",
    meliCookie: env.MELI_COOKIE || "",
    meliCsrf: env.MELI_CSRF_TOKEN || "",
    meliMattTool: env.MELI_MATT_TOOL || "",
    meliExtraParams: env.MELI_EXTRA_PARAMS || "",

    shortener: (env.SHORTENER as Settings["shortener"]) || "none",
    bitlyToken: env.BITLY_TOKEN || "",

    sendMode: "auto",
    requireMeliLink: true,
    otherLinks: "remove",
    onConvertFail: "pending",
    sendImage: true,
    fetchProductImage: true,
    dedupHours: 12,
    minIntervalSeconds: 90,
    activeFrom: "07:00",
    activeTo: "23:30",
    timezone: env.TZ_PAINEL || "America/Sao_Paulo",
    blocklist: "",
    ignoreFromMe: true,

    template: DEFAULT_TEMPLATE,

    mode: (env.MODE as Settings["mode"]) || "curated",
    curationIntervalMinutes: Number(env.CURATION_INTERVAL_MINUTES || 0),
    curationInstantScore: Number(env.CURATION_INSTANT_SCORE || 60),
    curationCooldownHours: 48,
    curationLookbackMinutes: 45,
    curationRequireImage: false,

    brandEnabled: true,
    brandName: env.BRAND_NAME || "",
    brandInstagram: env.BRAND_INSTAGRAM || "",

    aiEnabled: false,
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    aiModel: env.AI_MODEL || "claude-haiku-5-5",
  };
}

/** Configurações da Evolution que vêm do ambiente (deploy) e não aparecem no painel. */
export const ENV_MANAGED: (keyof Settings)[] = ["evolutionUrl", "evolutionApiKey", "evolutionInstance", "publicUrl", "webhookToken"];

export function evolutionManagedByEnv() {
  return Boolean(env.EVOLUTION_API_URL && env.EVOLUTION_API_KEY);
}

export function getSettings(): Settings {
  const base = defaults();
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const out = { ...base } as Record<string, unknown>;
  for (const r of rows) {
    if (!(r.key in base)) continue;
    // quando a Evolution vem do ambiente, o ambiente sempre manda
    if (evolutionManagedByEnv() && ENV_MANAGED.includes(r.key as keyof Settings) && r.key !== "webhookToken") continue;
    try {
      const v = JSON.parse(r.value);
      // valor vazio no banco não sobrescreve a variável de ambiente
      if (v === "" && (base as Record<string, unknown>)[r.key]) continue;
      out[r.key] = v;
    } catch {
      /* ignora */
    }
  }
  const result = out as Settings;
  if (!result.webhookToken) {
    // token do webhook gerado automaticamente na primeira execução
    let t = getState("webhookToken");
    if (!t) {
      t = crypto.randomUUID().replace(/-/g, "");
      setState("webhookToken", t);
    }
    result.webhookToken = t;
  }
  return result;
}

export function saveSettings(patch: Partial<Settings>) {
  const base = defaults();
  const stmt = db().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in base)) continue;
    // segredos mascarados que voltaram do painel sem alteração não são gravados
    if (SECRET_KEYS.includes(k as keyof Settings) && typeof v === "string" && v.startsWith("••••")) continue;
    stmt.run(k, JSON.stringify(v));
  }
}

export function maskSecret(v: string) {
  if (!v) return "";
  return "••••" + v.slice(-4);
}

export function publicSettings(): Settings {
  const s = getSettings();
  const out = { ...s } as Record<string, unknown>;
  for (const k of SECRET_KEYS) out[k] = maskSecret(String(s[k] || ""));
  return out as Settings;
}

export function getState(key: string): string | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(`__${key}`) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setState(key: string, value: string) {
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(`__${key}`, value);
}

export function webhookUrl(s: Settings = getSettings()) {
  const base = (s.publicUrl || "").replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/api/webhook/evolution${s.webhookToken ? `?token=${encodeURIComponent(s.webhookToken)}` : ""}`;
}
