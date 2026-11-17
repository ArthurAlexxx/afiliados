import { log } from "./db.ts";

/**
 * Quando a conta do Apify fica sem saldo (plano grátis: US$ 5 por mês), toda chamada volta 402/403.
 * Aí paramos de chamar por 1h, em vez de encher o log de erro a cada rodada.
 */
let pausedUntil = 0;
let reason = "";

export function apifyOff(): string | null {
  return Date.now() < pausedUntil ? reason : null;
}

export function checkApify() {
  const r = apifyOff();
  if (r) throw new Error(r);
}

/** Chame com a resposta que não deu ok. Se for falta de saldo, pausa o Apify por 1h. */
export async function apifyFail(what: string, r: Response): Promise<Error> {
  const body = (await r.text().catch(() => "")).replace(/\s+/g, " ");
  if ((r.status === 402 || r.status === 403) && /usage|actor-disabled|limit|plan/i.test(body)) {
    const first = !apifyOff();
    pausedUntil = Date.now() + 60 * 60 * 1000;
    reason = "Apify sem saldo neste mês: busca no Fragrantica pausada";
    if (first) log("error", `${reason} (tento de novo em 1h)`);
    return new Error(reason);
  }
  return new Error(`${what} ${r.status}: ${body.slice(0, 300)}`);
}
