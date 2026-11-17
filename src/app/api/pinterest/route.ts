import { chooseMain, decidePin, findPinPhotos, listPins } from "@/lib/pinterest";
import { getState, setState } from "@/lib/settings";

/** Fotos achadas no Pinterest esperando aprovação. */
export async function GET() {
  return Response.json({ rows: listPins(), auto: getState("pinAuto") === "1" });
}

/** { id, ok } aprova/recusa; { productId } busca agora para um perfume. */
export async function POST(req: Request) {
  const b = (await req.json()) as { id?: number; ok?: boolean; productId?: number; auto?: boolean; main?: boolean };
  try {
    if (typeof b.auto === "boolean") {
      setState("pinAuto", b.auto ? "1" : "0");
      return Response.json({ msg: b.auto ? "automático ligado" : "automático desligado" });
    }
    if (b.productId) return Response.json({ msg: `${await findPinPhotos(Number(b.productId))} foto(s) novas para aprovar` });
    if (b.main) return Response.json({ msg: await chooseMain(Number(b.id)) });
    return Response.json({ msg: await decidePin(Number(b.id), !!b.ok) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
