export const SESSION_COOKIE = "af_session";

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function authEnabled() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export async function sessionToken() {
  const secret = (process.env.SESSION_SECRET || "") + (process.env.ADMIN_PASSWORD || "");
  return hmac(secret, "afiliados-painel-v1");
}

export async function isValidSession(cookie: string | undefined) {
  if (!authEnabled()) return true;
  if (!cookie) return false;
  return cookie === (await sessionToken());
}
