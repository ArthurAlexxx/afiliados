import { processQueue } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/** Força uma rodada da fila (útil para cron externo). */
export async function POST() {
  return Response.json({ result: await processQueue() });
}
