/**
 * Levantamento: quais grupos do WhatsApp mandam fotos de perfume SEM marca d'água e com boa resolução.
 * Olha as fotos recentes de todos os grupos em que o número está (menos o nosso grupo de destino),
 * procura uma marca que se repete igual nas fotos (mesma lógica do aprendizado da marca) e mede a resolução.
 * Só lê; não muda nenhum grupo.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, log, MEDIA_DIR } from "./db.ts";

export type SurveyRow = {
  jid: string; name: string; role: string; promo: number; images: number; checked: number;
  minSide: number; mark: string | null; verdict: string;
};

export async function surveyGroups(): Promise<SurveyRow[]> {
  const { getSettings, setState } = await import("./settings.ts");
  const { Evolution } = await import("./evolution.ts");
  const { syncGroups } = await import("./bootstrap.ts");
  const { maskFromFiles } = await import("./unwatermark.ts");
  const s = getSettings();
  await syncGroups(s).catch(() => 0);
  const evo = new Evolution(s);
  const groups = db().prepare("SELECT jid, name, role, promo FROM groups WHERE role != 'destination' ORDER BY name").all() as {
    jid: string; name: string; role: string; promo: number;
  }[];
  const dir = path.join(/*turbopackIgnore: true*/ MEDIA_DIR, "survey");
  const out: SurveyRow[] = [];
  for (const g of groups) {
    let msgs: { key?: { id?: string }; message?: { imageMessage?: unknown } }[] = [];
    try {
      msgs = (await evo.findMessages(g.jid, 120)) as typeof msgs;
    } catch {
      continue;
    }
    const imgs = msgs.filter((m) => m.key?.id && m.message?.imageMessage);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const files: string[] = [];
    const sides: number[] = [];
    for (const m of imgs.slice(0, 16)) {
      try {
        const r = await evo.getBase64FromMediaMessage(m.key!.id!);
        if (!r.base64) continue;
        const buf = Buffer.from(r.base64.replace(/^data:[^,]+,/, ""), "base64");
        const meta = await sharp(buf).metadata();
        sides.push(Math.min(meta.width || 0, meta.height || 0));
        const f = path.join(dir, `${files.length}.jpg`);
        fs.writeFileSync(f, buf);
        files.push(f);
      } catch {
        /* mídia expirada */
      }
    }
    sides.sort((a, b) => a - b);
    const minSide = sides.length ? sides[sides.length >> 1] : 0;
    const mask = files.length >= 8 ? await maskFromFiles(files).catch(() => null) : null;
    const where = (b: number[]) => {
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      return `${cy < 0.5 ? "em cima" : "embaixo"}, ${cx < 0.33 ? "à esquerda" : cx > 0.66 ? "à direita" : "no meio"}`;
    };
    const verdict =
      files.length < 8 ? "poucas fotos para saber" : mask ? "tem marca" : minSide >= 1000 ? "sem marca, boa resolução" : minSide >= 650 ? "sem marca, resolução média" : "sem marca, resolução baixa";
    const row: SurveyRow = { jid: g.jid, name: g.name, role: g.role, promo: g.promo, images: imgs.length, checked: files.length, minSide, mark: mask ? where(mask.box) : null, verdict };
    out.push(row);
    log("info", `Levantamento de fotos: ${g.name} [${g.role === "source" ? (g.promo ? "promoção" : "só fotos") : "não usado"}] · ${imgs.length} fotos nas últimas 120 msgs · ${files.length} conferidas · lado ${minSide}px · ${verdict}${row.mark ? ` (${row.mark})` : ""}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  setState("groupSurvey", JSON.stringify({ at: Date.now(), rows: out }));
  return out;
}
