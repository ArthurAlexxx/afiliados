"use client";

import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api, useApi, timeAgo } from "@/lib/client";
import { cn } from "@/lib/utils";

type Log = { id: number; level: string; message: string; created_at: string };

export default function LogsPage() {
  const { data, reload } = useApi<{ rows: Log[] }>("/api/logs", 8000);
  const clear = async () => {
    await api("/api/logs", { method: "DELETE" });
    toast.success("Logs limpos");
    reload();
  };
  return (
    <>
      <PageHeader
        title="Logs"
        description="O que o robô está fazendo, em tempo real."
        actions={
          <Button size="sm" variant="outline" onClick={clear}>
            <Trash2 className="size-3.5" /> Limpar
          </Button>
        }
      />
      <Card className="overflow-hidden">
        {data?.rows.length ? (
          <ul className="divide-y font-mono text-[12px]">
            {data.rows.map((l) => (
              <li key={l.id} className="flex gap-3 px-4 py-2">
                <span
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    l.level === "error" ? "bg-danger" : l.level === "warn" ? "bg-warning" : "bg-success",
                  )}
                />
                <span className="w-20 shrink-0 text-muted-foreground">{timeAgo(l.created_at)}</span>
                <span className="min-w-0 break-words">{l.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-12 text-center text-[13px] text-muted-foreground">Nenhum log ainda.</div>
        )}
      </Card>
    </>
  );
}
