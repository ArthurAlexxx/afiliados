import { groupVolume } from "@/lib/volume";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Quantas mensagens cada grupo postou ontem e hoje, e a média por hora. */
export async function GET() {
  return Response.json(await groupVolume());
}
