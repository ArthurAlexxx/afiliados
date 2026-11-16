import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  const rows = db().prepare("SELECT * FROM logs ORDER BY id DESC LIMIT 300").all();
  return Response.json({ rows });
}

export function DELETE() {
  db().exec("DELETE FROM logs");
  return Response.json({ ok: true });
}
