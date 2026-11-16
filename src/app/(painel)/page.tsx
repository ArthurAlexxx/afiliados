"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, CheckCircle2, Clock, Inbox, Send, Radio, Link2, CalendarClock, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApi, timeAgo } from "@/lib/client";
import { cn } from "@/lib/utils";

type Stats = {
  counts: Record<string, number>;
  today: { sent: number; captured: number };
  days: { day: string; captured: number; sent: number }[];
  bySource: { name: string; captured: number; sent: number }[];
  groups: Record<string, number>;
  config: {
    evolution: boolean;
    meli: boolean;
    sendMode: string;
    inWindow: boolean;
    activeFrom: string;
    activeTo: string;
    minIntervalSeconds: number;
  };
  lastSentAt: number | null;
};

type Post = { id: number; source_name: string; formatted_text: string; status: string; reason: string | null; created_at: string };

/** KPI no estilo do "Stats Card" do 21st.dev: título, valor, ícone e linha de contexto. */
function Kpi({
  title,
  value,
  icon: Icon,
  hint,
  tone = "neutral",
  delay = 0,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  hint: string;
  tone?: "neutral" | "success" | "warning" | "info";
  delay?: number;
}) {
  const toneCls = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    info: "bg-info/10 text-info",
  }[tone];
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.3, ease: [0.23, 1, 0.32, 1] }}>
      <Card className="h-full">
        <div className="flex items-center justify-between px-5 pt-5">
          <span className="text-[13px] font-medium text-muted-foreground">{title}</span>
          <span className={cn("flex size-8 items-center justify-center rounded-[10px]", toneCls)}>
            <Icon className="size-4" strokeWidth={2} />
          </span>
        </div>
        <div className="px-5 pt-2 pb-5">
          <div className="text-[28px] font-semibold tracking-tight tabular-nums">{value}</div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>
        </div>
      </Card>
    </motion.div>
  );
}

function ActivityChart({ days }: { days: Stats["days"] }) {
  const filled: Stats["days"] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - 3 * 3600e3 - i * 86400e3).toISOString().slice(0, 10);
    filled.push(days.find((x) => x.day === d) || { day: d, captured: 0, sent: 0 });
  }
  const max = Math.max(1, ...filled.map((d) => d.captured));
  return (
    <div>
      <div className="flex h-44 items-end gap-1.5">
        {filled.map((d, i) => (
          <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
            <div className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full rounded-lg border bg-card px-2 py-1 text-[11px] whitespace-nowrap shadow-sm group-hover:block">
              <div className="font-medium">{d.day.split("-").reverse().slice(0, 2).join("/")}</div>
              <div className="text-muted-foreground">{d.captured} capturadas · {d.sent} enviadas</div>
            </div>
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${(d.captured / max) * 100}%` }}
              transition={{ delay: i * 0.025, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              className="relative w-full overflow-hidden rounded-[6px] bg-foreground/[0.07]"
              style={{ minHeight: d.captured ? 4 : 2 }}
            >
              <div
                className="absolute inset-x-0 bottom-0 rounded-[6px] bg-foreground"
                style={{ height: d.captured ? `${(d.sent / d.captured) * 100}%` : 0 }}
              />
            </motion.div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{filled[0].day.split("-").reverse().slice(0, 2).join("/")}</span>
        <span>hoje</span>
      </div>
      <div className="mt-3 flex items-center gap-4 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-foreground" /> Enviadas</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-foreground/15" /> Capturadas</span>
      </div>
    </div>
  );
}

function StatusRow({ ok, label, detail, href }: { ok: boolean; label: string; detail: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted">
      <span className={cn("flex size-8 items-center justify-center rounded-[10px]", ok ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
        {ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="truncate text-[12px] text-muted-foreground">{detail}</div>
      </div>
      <ArrowUpRight className="size-4 text-muted-foreground" />
    </Link>
  );
}

export default function Dashboard() {
  const { data: st } = useApi<Stats>("/api/stats", 15000);
  const { data: recent } = useApi<{ rows: Post[] }>("/api/posts?limit=6", 15000);
  const c = st?.counts || {};

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Promoções capturadas dos grupos de origem e postadas no seu grupo."
        actions={
          <Link href="/fila">
            <Button variant="outline" size="sm">
              Abrir fila <ArrowUpRight className="size-3.5" />
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi title="Enviadas hoje" value={st?.today.sent ?? "–"} icon={Send} hint={`${c.sent || 0} no total`} tone="success" />
        <Kpi title="Capturadas hoje" value={st?.today.captured ?? "–"} icon={Radio} hint={`${st?.groups.source || 0} grupos de origem`} delay={0.04} />
        <Kpi title="Na fila" value={c.queued ?? 0} icon={Clock} hint={`1 post a cada ${st?.config.minIntervalSeconds ?? "–"}s`} tone="info" delay={0.08} />
        <Kpi title="Aguardando aprovação" value={c.pending ?? 0} icon={Inbox} hint={st?.config.sendMode === "manual" ? "Modo manual ativo" : "Links com falha caem aqui"} tone="warning" delay={0.12} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Atividade" description="Últimos 14 dias" />
          <CardContent>{st ? <ActivityChart days={st.days} /> : <div className="h-52 animate-pulse rounded-xl bg-muted" />}</CardContent>
        </Card>

        <Card>
          <CardHeader title="Status" description="Integrações e regras" />
          <CardContent className="flex flex-col gap-0.5 px-3">
            <StatusRow ok={!!st?.config.evolution} label="Evolution API" detail={st?.config.evolution ? "Credenciais configuradas" : "Configure URL, API key e instância"} href="/configuracoes" />
            <StatusRow ok={!!st?.config.meli} label="Afiliado Mercado Livre" detail={st?.config.meli ? "Conversão de links pronta" : "Falta configurar seu link de afiliado"} href="/configuracoes" />
            <StatusRow ok={(st?.groups.source || 0) > 0 && (st?.groups.destination || 0) > 0} label="Grupos" detail={`${st?.groups.source || 0} origem · ${st?.groups.destination || 0} destino`} href="/grupos" />
            <StatusRow ok={!!st?.config.inWindow} label="Janela de envio" detail={`${st?.config.activeFrom || "--"} às ${st?.config.activeTo || "--"}${st?.config.inWindow ? " · ativa agora" : " · fora do horário"}`} href="/configuracoes" />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Últimas promoções"
            action={
              <Link href="/fila" className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
                Ver todas
              </Link>
            }
          />
          <CardContent className="px-3">
            {recent?.rows.length ? (
              <ul className="divide-y">
                {recent.rows.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium">
                        {p.formatted_text.split("\n")[0].replace(/[*_~]/g, "") || "(sem texto)"}
                      </div>
                      <div className="truncate text-[12px] text-muted-foreground">
                        {p.source_name} · {timeAgo(p.created_at)}
                        {p.reason ? ` · ${p.reason}` : ""}
                      </div>
                    </div>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader title="Grupos que mais rendem" description="Últimos 7 dias" />
          <CardContent>
            {st?.bySource.length ? (
              <ul className="flex flex-col gap-3">
                {st.bySource.map((g) => (
                  <li key={g.name}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
                      <span className="truncate">{g.name}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {g.sent}/{g.captured}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-foreground" style={{ width: `${(g.sent / Math.max(1, g.captured)) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">Nenhuma captura ainda.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-muted">
        <Link2 className="size-5 text-muted-foreground" />
      </div>
      <div className="text-[14px] font-medium">Nenhuma promoção capturada ainda</div>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
        Configure a Evolution API, marque os grupos de origem e destino, e as promoções começam a aparecer aqui.
      </p>
      <div className="mt-4 flex gap-2">
        <Link href="/configuracoes"><Button size="sm">Configurar</Button></Link>
        <Link href="/template"><Button size="sm" variant="outline"><CalendarClock className="size-3.5" />Testar template</Button></Link>
      </div>
      <Badge className="mt-4" tone="accent">Dica: use a tela de Template para simular uma mensagem</Badge>
    </div>
  );
}
