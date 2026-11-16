import { approveClean, listClean, unwmStats } from "@/lib/unwatermark";

/** Fotos do RP com a marca d'água tirada (teste), esperando aprovação. */
export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") || "wm_ready";
  return Response.json({ rows: listClean(status), stats: unwmStats() });
}

export async function POST(req: Request) {
  const { id, ok } = (await req.json()) as { id: number; ok: boolean };
  try {
    return Response.json({ msg: await approveClean(Number(id), !!ok) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
