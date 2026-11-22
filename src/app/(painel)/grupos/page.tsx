"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { RefreshCw, Search, Plus, Users, Send, Radio, Droplet } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, useApi } from "@/lib/client";
import { cn } from "@/lib/utils";
import { DealsCard } from "./deals-card";

type Group = {
  jid: string; name: string; size: number; role: "none" | "source" | "destination" | "deals"; captured: number; sent: number;
  watermark: number; promo?: number; follow?: number; photo_priority?: number; offers: number; photos: number;
};

const ROLES = [
  { key: "none", label: "Ignorar" },
  { key: "source", label: "Origem" },
  { key: "destination", label: "Destino" },
  { key: "deals", label: "Ofertas boas" },
] as const;

/** Controle segmentado com pílula animada (mesmo padrão do sidebar do 21st.dev). */
function RoleSwitch({ jid, value, onChange }: { jid: string; value: Group["role"]; onChange: (r: Group["role"]) => void }) {
  return (
    <div className="flex rounded-lg border bg-background p-0.5">
      {ROLES.map((r) => {
        const active = value === r.key;
        return (
          <button
            key={r.key}
            onClick={() => onChange(r.key)}
            className={cn(
              "relative h-7 rounded-[8px] px-2.5 text-[12px] font-medium transition-colors",
              active
                ? r.key === "destination" || r.key === "deals"
                  ? "text-accent-foreground"
                  : r.key === "source"
                    ? "text-primary-foreground"
                    : "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`role-${jid}`}
                transition={{ type: "spring", stiffness: 520, damping: 42 }}
                className={cn(
                  "absolute inset-0 rounded-[8px]",
                  r.key === "destination" || r.key === "deals" ? "bg-accent" : r.key === "source" ? "bg-primary" : "bg-muted",
                )}
              />
            )}
            <span className="relative">{r.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function GruposPage() {
  const { data, reload, setData } = useApi<{ rows: Group[] }>("/api/groups");
  const [syncing, setSyncing] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | Group["role"]>("all");
  const [manual, setManual] = React.useState("");

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ count: number }>("/api/groups", { method: "POST" });
      toast.success(`${r.count} grupos sincronizados da Evolution API`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const setRole = async (g: Group, role: Group["role"]) => {
    setData((d) => (d ? { rows: d.rows.map((x) => (x.jid === g.jid ? { ...x, role } : x)) } : d));
    try {
      await api("/api/groups", { method: "PATCH", json: { jid: g.jid, role } });
    } catch (e) {
      toast.error((e as Error).message);
      reload();
    }
  };

  const setWatermark = async (g: Group, watermark: boolean) => {
    setData((d) => (d ? { rows: d.rows.map((x) => (x.jid === g.jid ? { ...x, watermark: watermark ? 1 : 0 } : x)) } : d));
    try {
      await api("/api/groups", { method: "PATCH", json: { jid: g.jid, watermark } });
      toast.success(watermark ? "Fotos desse grupo não serão usadas" : "Fotos desse grupo liberadas para o banco");
    } catch (e) {
      toast.error((e as Error).message);
      reload();
    }
  };

  const setPromo = async (g: Group, promo: boolean) => {
    setData((d) => (d ? { rows: d.rows.map((x) => (x.jid === g.jid ? { ...x, promo: promo ? 1 : 0 } : x)) } : d));
    try {
      await api("/api/groups", { method: "PATCH", json: { jid: g.jid, promo } });
      toast.success(promo ? "As promoções desse grupo podem ser postadas" : "Esse grupo agora serve só para fotos e preços");
    } catch (e) {
      toast.error((e as Error).message);
      reload();
    }
  };

  const setFollow = async (g: Group, follow: boolean) => {
    setData((d) => (d ? { rows: d.rows.map((x) => (x.jid === g.jid ? { ...x, follow: follow ? 1 : 0 } : x)) } : d));
    try {
      await api("/api/groups", { method: "PATCH", json: { jid: g.jid, follow } });
      toast.success(follow ? "Postou lá, posta aqui: cada perfume desse grupo vai para o nosso (sem repetir)" : "Esse grupo não é mais copiado");
    } catch (e) {
      toast.error((e as Error).message);
      reload();
    }
  };

  const addManual = async () => {
    const jid = manual.trim();
    if (!/@g\.us$/.test(jid)) return toast.error("O ID do grupo termina com @g.us");
    await api("/api/groups", { method: "PATCH", json: { jid, role: "source", name: jid } });
    setManual("");
    reload();
  };

  const rows = (data?.rows || []).filter(
    (g) => (filter === "all" || g.role === filter) && (!q || g.name.toLowerCase().includes(q.toLowerCase()) || g.jid.includes(q)),
  );
  const nSource = data?.rows.filter((g) => g.role === "source").length || 0;
  const nDest = data?.rows.filter((g) => g.role === "destination").length || 0;

  return (
    <>
      <PageHeader
        title="Grupos"
        description="Marque de quais grupos capturar promoções e em qual grupo postar."
        actions={
          <Button size="sm" onClick={sync} loading={syncing}>
            {!syncing && <RefreshCw className="size-3.5" />} Sincronizar grupos
          </Button>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        {[
          { label: "Grupos de origem", value: nSource, icon: Radio, f: "source" as const },
          { label: "Grupos de destino", value: nDest, icon: Send, f: "destination" as const },
          { label: "Total na instância", value: data?.rows.length || 0, icon: Users, f: "all" as const },
        ].map((k) => (
          <button key={k.label} onClick={() => setFilter(k.f)} className="text-left">
            <Card className={cn("flex items-center gap-3 p-4 transition-colors hover:bg-muted/50", filter === k.f && "ring-2 ring-foreground/10")}>
              <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <k.icon className="size-4 text-muted-foreground" />
              </span>
              <div>
                <div className="text-[20px] leading-none font-semibold tabular-nums">{k.value}</div>
                <div className="mt-1 text-[12px] text-muted-foreground">{k.label}</div>
              </div>
            </Card>
          </button>
        ))}
      </div>

      <DealsCard />

      <Card>
        <CardHeader
          title="Lista de grupos"
          description="Dica: o grupo de destino é o SEU grupo. Ele nunca é usado como origem."
          action={
            <div className="relative w-56">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar grupo" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
          }
        />
        <CardContent className="px-0 pb-0">
          {rows.length ? (
            <ul className="divide-y border-t">
              {rows.map((g) => (
                <li key={g.jid} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-semibold text-muted-foreground">
                      {(g.name || "?").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "G"}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium">{g.name}</div>
                      <div className="truncate text-[12px] text-muted-foreground">
                        {g.size ? `${g.size} membros · ` : ""}
                        {g.role === "source" ? `${g.offers} ofertas · ${g.photos} fotos no banco` : g.jid}
                      </div>
                    </div>
                  </div>
                  {g.role === "source" && (
                    <button
                      onClick={() => setFollow(g, !g.follow)}
                      title="Copiar: cada perfume que esse grupo postar vai para o nosso grupo na hora, com o nosso link (sem repetir perfume entre os grupos copiados)"
                      className={cn(
                        "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors",
                        g.follow ? "border-accent/40 bg-accent/15 text-foreground" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {g.follow ? "Copiando" : "Copiar"}
                    </button>
                  )}
                  {g.role === "source" && (
                    <button
                      onClick={() => setPromo(g, g.promo === 0)}
                      title="Grupos de promoção: as ofertas deles podem ir para o nosso grupo. Os outros só ajudam com fotos, preço real e hype."
                      className={cn(
                        "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors",
                        g.promo !== 0 ? "border-success/30 bg-success/10 text-success" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {g.promo !== 0 ? "Promoções: sim" : "Só fotos e preços"}
                    </button>
                  )}
                  {g.role === "source" && (
                    <button
                      onClick={() => setWatermark(g, !g.watermark)}
                      title="Grupos com marca d'água: usamos só a promoção, a foto vem do banco dos outros grupos"
                      className={cn(
                        "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors",
                        g.watermark ? "border-warning/30 bg-warning/10 text-warning" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Droplet className="size-3.5" />
                      {g.watermark ? "Marca d'água: não usar fotos" : "Fotos liberadas"}
                    </button>
                  )}
                  <RoleSwitch jid={g.jid} value={g.role} onChange={(r) => setRole(g, r)} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="border-t px-5 py-12 text-center">
              <div className="text-[14px] font-medium">Nenhum grupo</div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Configure a Evolution API e clique em <b>Sincronizar grupos</b>.
              </p>
            </div>
          )}
          <div className="flex flex-col gap-2 border-t bg-muted/40 px-5 py-3 sm:flex-row sm:items-center">
            <span className="text-[12.5px] text-muted-foreground">Adicionar grupo de origem pelo ID:</span>
            <Input placeholder="1203630xxxxxxxx@g.us" value={manual} onChange={(e) => setManual(e.target.value)} className="h-8 sm:max-w-xs" />
            <Button size="sm" variant="outline" onClick={addManual}>
              <Plus className="size-3.5" /> Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
