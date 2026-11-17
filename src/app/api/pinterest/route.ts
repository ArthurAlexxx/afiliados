import { chooseMain, decidePin, findPinPhotos, listPins } from "@/lib/pinterest";
import { getState, setState } from "@/lib/settings";
import { trainingStatus } from "@/lib/pinlearn";

/** Fotos achadas no Pinterest esperando aprovação. */
export async function GET(req: Request) {
  const pid = Number(new URL(req.url).searchParams.get("productId") || 0) || undefined;
  return Response.json({ rows: listPins("pending", pid), auto: getState("pinAuto") === "1", training: trainingStatus() });
}

/** { id, ok } aprova/recusa; { productId } busca agora para um perfume. */
export async function POST(req: Request) {
  const b = (await req.json()) as { id?: number; ok?: boolean; productId?: number; auto?: boolean; main?: boolean };
  try {
    if (typeof b.auto === "boolean") {
      setState("pinAuto", b.auto ? "1" : "0");
      // desligado por ele: o treino não liga de novo sozinho
      setState("pinAutoOffByArthur", b.auto ? "0" : "1");
      return Response.json({ msg: b.auto ? "automático ligado" : "automático desligado" });
    }
    if (b.productId) {
      const n = await findPinPhotos(Number(b.productId));
      return Response.json({ msg: n ? `${n} foto(s) nova(s) do Pinterest` : "O Pinterest não trouxe fotos novas desse perfume (perfume pouco conhecido ou já buscado)" });
    }
    if (b.main) return Response.json({ msg: await chooseMain(Number(b.id)) });
    return Response.json({ msg: await decidePin(Number(b.id), !!b.ok) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
