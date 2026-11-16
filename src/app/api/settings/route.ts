import { publicSettings, saveSettings, type Settings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(publicSettings());
}

export async function PUT(req: Request) {
  const patch = (await req.json()) as Partial<Settings>;
  saveSettings(patch);
  return Response.json(publicSettings());
}
