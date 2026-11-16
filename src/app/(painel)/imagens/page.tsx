"use client";

import * as React from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, useApi, timeAgo } from "@/lib/client";
import { cn } from "@/lib/utils";

type Fix = {
  id: number; product_id: number; name: string | null; group_name: string | null; corner: string;
  status: string; error: string | null; created_at: string; updated_at: string; photos: number;
};
type Data = { rows: Fix[]; counts: Record<string, number>; today: number };

const TABS = [
  { key: "ready", label: "Para aprovar" },
  { key: "queued", label: "Na fila da IA" },
  { key: "approved", label: "Aprovadas" },
  { key: "failed", label: "Recusadas e falhas" },
] as const;

const CORNER_LABEL: Record<string, string> = {
  "top-right": "canto superior direito",
  "top-left": "canto superior esquerdo",
  "bottom-right": "canto inferior direito",
  "bottom-left": "canto inferior esquerdo",
};

function FixCard({ f, onDone }: { f: Fix; onDone: () => void }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const act = async (action: string, corner?: string) => {
    setBusy(action);
    try {
      const r = await api<{ msg?: string }>("/api/imagens", { method: "POST", json: { id: f.id, action, corner } });
      toast.success(action === "approve" ? `Aprovada: ${r.msg || "foto no banco"}` : action === "reject" ? "Recusada" : "Voltou para a fila da IA");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const hasOut = f.status !== "queued" && f.status !== "failed";
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-2 gap-px bg-border">
        <figure className="bg-card">
          <img src={`/api/imagens/${f.id}?v=src`} alt="Original" className="aspect-square w-full object-contain" loading="lazy" />
          <figcaption className="px-3 py-1.5 text-[11.5px] text-muted-foreground">Original (com marca)</figcaption>
        </figure>
        <figure className="bg-card">
          {hasOut ? (
            <img src={`/api/imagens/${f.id}?v=out&t=${encodeURIComponent(f.updated_at)}`} alt="Refeita" className="aspect-square w-full object-contain" loading="lazy" />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center p-4 text-center text-[12.5px] text-muted-foreground">
              {f.status === "queued" ? "A IA ainda vai refazer esta foto" : f.error || "Falhou"}
            </div>
          )}
          <figcaption className="px-3 py-1.5 text-[11.5px] text-muted-foreground">Refeita pela IA</figcaption>
        </figure>
      </div>
      <div className="flex flex-col gap-2 border-t p-3">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium">{f.name || `Perfume #${f.product_id}`}</div>
          <div className="text-[12px] text-muted-foreground">
            {f.group_name || "grupo"} · {CORNER_LABEL[f.corner] || f.corner} · {f.photos} foto(s) limpa(s) no banco · {timeAgo(f.created_at)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {f.status === "ready" && (
            <>
              <Button size="sm" variant="accent" loading={busy === "approve"} onClick={() => act("approve")}>
                <Check className="size-3.5" /> Aprovar
              </Button>
              <Button size="sm" variant="outline" loading={busy === "reject"} onClick={() => act("reject")}>
                <X className="size-3.5" /> Recusar
              </Button>
            </>
          )}
          {f.status !== "queued" && f.status !== "approved" && (
            <>
              <Button size="sm" variant="ghost" loading={busy === "retry"} onClick={() => act("retry")}>
                <RotateCcw className="size-3.5" /> Tentar de novo
              </Button>
              <select
                aria-label="Outro canto"
                className="h-8 rounded-[10px] border bg-card px-2 text-[12.5px]"
                value=""
                onChange={(e) => e.target.value && act("retry", e.target.value)}
              >
                <option value="">Marca em outro canto…</option>
                {Object.entries(CORNER_LABEL).filter(([k]) => k !== f.corner).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </>
          )}
          {f.status === "approved" && <Badge tone="success">No banco de fotos</Badge>}
          {f.status === "rejected" && <Badge tone="neutral">Recusada</Badge>}
        </div>
      </div>
    </Card>
  );
}

export default function ImagensPage() {
  const [tab, setTab] = React.useState<string>("ready");
  const { data, reload } = useApi<Data>(`/api/imagens?status=${tab}`, 30000);
  const count = (k: string) => (k === "failed" ? (data?.counts.failed || 0) + (data?.counts.rejected || 0) : data?.counts[k] || 0);
  return (
    <>
      <PageHeader
        title="Imagens"
        description="Fotos de grupos com marca d'água, refeitas pela IA só no canto da marca. Entram aqui quando o perfume tem menos de 2 fotos limpas. Nada vai para o grupo sem a sua aprovação: aprovada, a foto entra no banco do perfume."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-medium",
              tab === t.key ? "bg-foreground text-background" : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className="tabular-nums opacity-70">{count(t.key)}</span>
          </button>
        ))}
        {data && <span className="ml-auto text-[12px] text-muted-foreground">{data.today} refeitas pela IA hoje</span>}
      </div>
      {data ? (
        data.rows.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.rows.map((f) => <FixCard key={f.id} f={f} onDone={reload} />)}
          </div>
        ) : (
          <Card className="px-5 py-12 text-center">
            <div className="text-[14px] font-medium">Nada aqui</div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {tab === "ready" ? "Quando a IA refizer uma foto, ela aparece aqui para você aprovar." : "Nenhuma foto nesta aba."}
            </p>
          </Card>
        )
      ) : (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      )}
    </>
  );
}
