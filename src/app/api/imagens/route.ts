import { approveFix, listFixes, rejectFix, retryFix, setRefFromFix, type Corner } from "@/lib/imagefix";

export const dynamic = "force-dynamic";

/** Fotos refeitas pela IA: ?status=ready|queued|approved|failed|all */
export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") || "ready";
  return Response.json(listFixes(status));
}

/** { id, action: "approve" | "reject" | "retry", corner? } */
export async function POST(req: Request) {
  const { id, action, corner } = (await req.json()) as { id: number; action: string; corner?: Corner };
  try {
    if (action === "approve") return Response.json({ ok: true, msg: await approveFix(Number(id)) });
    if (action === "reject") rejectFix(Number(id));
    else if (action === "retry") retryFix(Number(id), corner);
    else if (action === "setref") await setRefFromFix(Number(id));
    else return Response.json({ error: "ação inválida" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
