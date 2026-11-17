"use client";

import * as React from "react";
import { ArrowUpRight, CalendarClock, CircleDollarSign, Gauge, RefreshCw, Search, Wallet } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, useApi, timeAgo } from "@/lib/client";
import { cn } from "@/lib/utils";

/**
 * Página Scraping (pedido do Arthur): visão geral do Apify. Quanto gastamos, quanto crédito sobra,
 * quanto custa cada tipo de puxada, o que falta buscar e a lista de cada puxada feita.
 */
type Kind = { kind: string; label: string; n: number; fails: number; usd: number; avg_usd: number | null; avg_ms: number | null; n_today: number; usd_today: number; n_hour: number };
type Call = { id: number; at: string; kind: string; product_id: number | null; name: string | null; label: string | null; items: number; cost_usd: number; ok: number; ms: number | null; result: string | null };
type Run = { id: string; actor: string; status: string; startedAt: string; finishedAt: string | null; usd: number | null; origin: string | null; standby: boolean };
type Resp = {
  account: {
    error?: string;
    username?: string;
    plan?: { id: string; tier: string; priceUsd: number; creditsUsd: number; paying: boolean };
    cycle?: { startAt: string; endAt: string };
    maxUsd?: number | null;
    usedUsd?: number;
    services?: { service: string; quantity: number; usd: number }[];
    daily?: { day: string; usd: number }[];
    runs?: Run[];
    runsTotal?: number;
  };
  prices: { tier: string; start: number; listing: number; profile: number; search: number; fetch: number };
  paused: string | null;
  budget: { limit: number; spent: number };
  byKind: Kind[];
  days: { day: string; kind: string; n: number; usd: number }[];
  hours: { h: string; n: number; usd: number }[];
  calls: Call[];
  top: { product_id: number; name: string; n: number; usd: number }[];
  coverage: Record<"products" | "linked" | "notFound" | "toSearch" | "withDetails" | "detailsPending" | "photosRead" | "photosPending" | "photos" | "perfumesWithPhotos", number>;
  kinds: Record<string, string>;
};

const KIND_COLOR: Record<string, string> = {
  frag_search: "bg-violet-500",
  frag_google: "bg-sky-500",
  frag_details: "bg-green-500",
  frag_photos: "bg-yellow-500",
  pinterest: "bg-red-400",
};

const SERVICE_LABEL: Record<string, string> = {
  PAID_ACTORS_PER_EVENT: "Robôs pagos por uso (Fragrantica, Google, página)",
  PAID_ACTORS_PER_DATASET_ITEM: "Robôs pagos por item",
  ACTOR_COMPUTE_UNITS: "Processamento dos robôs",
  DATA_TRANSFER_EXTERNAL_GBYTES: "Tráfego de dados (saída)",
  DATA_TRANSFER_INTERNAL_GBYTES: "Tráfego de dados (interno)",
  DATASET_READS: "Leitura de resultados",
  DATASET_WRITES: "Gravação de resultados",
  DATASET_TIMED_STORAGE_GBYTE_HOURS: "Guarda de resultados",
  KEY_VALUE_STORE_TIMED_STORAGE_GBYTE_HOURS: "Guarda de arquivos",
  KEY_VALUE_STORE_READS: "Leitura de arquivos",
  KEY_VALUE_STORE_WRITES: "Gravação de arquivos",
  KEY_VALUE_STORE_LISTS: "Listagem de arquivos",
  REQUEST_QUEUE_TIMED_STORAGE_GBYTE_HOURS: "Fila de páginas",
  REQUEST_QUEUE_READS: "Leitura da fila",
  REQUEST_QUEUE_WRITES: "Gravação da fila",
  PROXY_SERPS: "Proxy do Google",
  PROXY_RESIDENTIAL_TRANSFER_GBYTES: "Proxy residencial",
};

function usd(v: number | null | undefined, digits?: number) {
  const n = Number(v || 0);
  const d = digits ?? (n === 0 ? 2 : n < 0.01 ? 4 : n < 1 ? 3 : 2);
  return `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
const num = (n: number | null | undefined) => Number(n || 0).toLocaleString("pt-BR");
const dmy = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "");
const hm = (sql: string) => new Date(sql.replace(" ", "T") + "Z").toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Kpi({ label, value, hint, icon: Icon, children }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon: React.ElementType; children?: React.ReactNode }) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase dark:text-gray-500">{label}</span>
        <span className="flex size-9 items-center justify-center rounded-full bg-violet-500/15 text-violet-500">
          <Icon className="size-4" />
        </span>
      </div>
      <div className="mt-2 text-3xl font-bold text-gray-800 tabular-nums dark:text-gray-100">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
      {children}
    </Card>
  );
}

function Bars({ data, height = 160, labels }: { data: { key: string; value: number; tip: string; parts?: { cls: string; value: number }[] }[]; height?: number; labels?: [string, string] }) {
  const max = Math.max(0.000001, ...data.map((d) => d.value));
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d) => (
          <div key={d.key} className="group relative flex h-full flex-1 flex-col justify-end">
            <div className="pointer-events-none absolute -top-1 left-1/2 z-10 hidden -translate-x-1/2 -translate-y-full rounded-lg border bg-card px-2 py-1 text-[11px] whitespace-pre shadow-lg group-hover:block">{d.tip}</div>
            <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-[3px] bg-gray-100 dark:bg-gray-700/40" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 3 : 1 }}>
              {d.parts?.length ? (
                d.parts.map((p, i) => <div key={i} className={p.cls} style={{ height: `${(p.value / Math.max(d.value, 0.000001)) * 100}%` }} />)
              ) : (
                <div className="h-full bg-violet-500" />
              )}
            </div>
          </div>
        ))}
      </div>
      {labels ? (
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      ) : null}
    </div>
  );
}

function Meter({ label, value, total, hint, cls = "bg-violet-500" }: { label: string; value: number; total: number; hint?: string; cls?: string }) {
  const pct = total ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {num(value)} de {num(total)} · {Math.round(pct)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/50">
        <div className={cn("h-full rounded-full", cls)} style={{ width: `${pct}%` }} />
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

const TH = "px-2 py-2 text-left font-semibold first:pl-5 last:pr-5";
const TD = "px-2 py-2.5 first:pl-5 last:pr-5";
const NUM = "text-right whitespace-nowrap tabular-nums";

export default function ScrapingPage() {
  const [kind, setKind] = React.useState("");
  const [q, setQ] = React.useState("");
  const [qd, setQd] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setQd(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, setData } = useApi<Resp>(`/api/scraping?kind=${kind}&q=${encodeURIComponent(qd)}`, 30_000);
  const [busy, setBusy] = React.useState(false);

  async function fresh() {
    setBusy(true);
    try {
      setData(await api<Resp>(`/api/scraping?fresh=1&kind=${kind}&q=${encodeURIComponent(qd)}`));
    } finally {
      setBusy(false);
    }
  }

  const a = data?.account;
  const used = a?.usedUsd ?? 0;
  const max = a?.maxUsd ?? a?.plan?.creditsUsd ?? 0;
  const left = Math.max(0, max - used);
  const now = Date.now();
  const start = a?.cycle ? new Date(a.cycle.startAt).getTime() : now;
  const end = a?.cycle ? new Date(a.cycle.endAt).getTime() : now;
  const daysGone = Math.max(1, (now - start) / 86400e3);
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400e3));
  const perDay = used / daysGone;
  const projected = perDay * ((end - start) / 86400e3);
  const runsOut = perDay > 0 ? left / perDay : Infinity;
  const todayUtc = new Date().toISOString().slice(0, 10);
  const ourToday = data?.byKind.reduce((s, k) => s + (k.usd_today || 0), 0) ?? 0;
  const todayUsd = a?.daily?.find((d) => d.day === todayUtc)?.usd ?? ourToday;

  // custo para terminar o que falta no banco, pelo custo médio real de cada tipo
  const avg = (k: string, fallback: number) => data?.byKind.find((x) => x.kind === k)?.avg_usd ?? fallback;
  const p = data?.prices;
  const c = data?.coverage;
  const toFinish = c && p
    ? c.toSearch * avg("frag_search", p.start + 8 * p.listing) + c.photosPending * avg("frag_photos", p.fetch) + c.detailsPending * avg("frag_details", p.start + p.profile)
    : 0;

  // gráfico do ciclo: gasto real do Apify por dia
  const cycleDays: { key: string; value: number; tip: string }[] = [];
  if (a?.cycle) {
    for (let t = start; t <= Math.min(end, now); t += 86400e3) {
      const day = new Date(t).toISOString().slice(0, 10);
      const v = a.daily?.find((d) => d.day === day)?.usd ?? 0;
      cycleDays.push({ key: day, value: v, tip: `${day.split("-").reverse().slice(0, 2).join("/")}: ${usd(v)}` });
    }
  }
  // nosso registro: puxadas por dia, separadas por tipo
  const ourDays: { key: string; value: number; tip: string; parts: { cls: string; value: number }[] }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(now - 3 * 3600e3 - i * 86400e3).toISOString().slice(0, 10);
    const rows = data?.days.filter((d) => d.day === day) || [];
    const total = rows.reduce((s, r) => s + r.usd, 0);
    ourDays.push({
      key: day,
      value: total,
      tip: `${day.split("-").reverse().slice(0, 2).join("/")}: ${usd(total)}\n${rows.map((r) => `${data?.kinds[r.kind] || r.kind}: ${r.n}× · ${usd(r.usd)}`).join("\n") || "nenhuma puxada"}`,
      parts: rows.map((r) => ({ cls: KIND_COLOR[r.kind] || "bg-gray-400", value: r.usd })),
    });
  }
  const hours = Array.from({ length: 24 }, (_, h) => {
    const r = data?.hours.find((x) => Number(x.h) === h);
    return { key: String(h), value: r?.n || 0, tip: `${String(h).padStart(2, "0")}h: ${r?.n || 0} puxada(s) · ${usd(r?.usd)}` };
  });

  return (
    <>
      <PageHeader
        title="Scraping e API"
        description="Quanto o Apify está custando, quanto crédito sobra e cada puxada que o sistema fez no Fragrantica."
        actions={
          <>
            <a href="https://console.apify.com/billing" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium shadow-xs hover:border-gray-300">
              Abrir Apify <ArrowUpRight className="size-4" />
            </a>
            <Button variant="accent" onClick={fresh} loading={busy}>
              {!busy && <RefreshCw className="size-4" />} Atualizar agora
            </Button>
          </>
        }
      />

      {data?.paused || a?.error ? (
        <div className="mb-6 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
          ⚠️ {data?.paused || `Não consegui ler a conta do Apify: ${a?.error}`}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Gasto no ciclo" icon={CircleDollarSign} value={usd(used, 2)} hint={max ? `de ${usd(max, 2)} do plano` : undefined}>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/50">
            <div className={cn("h-full rounded-full", max && used / max > 0.85 ? "bg-red-500" : "bg-violet-500")} style={{ width: `${max ? Math.min(100, (used / max) * 100) : 0}%` }} />
          </div>
        </Kpi>
        <Kpi
          label="Crédito restante"
          icon={Wallet}
          value={usd(left, 2)}
          hint={perDay > 0 ? (runsOut < daysLeft ? `⚠️ no ritmo atual acaba em ~${Math.max(0, Math.floor(runsOut))} dia(s), antes de renovar` : `no ritmo atual dura até a renovação`) : "sem gasto ainda neste ciclo"}
        />
        <Kpi label="Gasto hoje" icon={Gauge} value={usd(todayUsd, 2)} hint={`${num(data?.byKind.reduce((s, k) => s + k.n_today, 0))} puxada(s) hoje · ${num(data?.byKind.reduce((s, k) => s + k.n_hour, 0))} na última hora`}>
          {data?.budget ? (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700/50">
                <div className={cn("h-full rounded-full", data.budget.spent >= data.budget.limit ? "bg-red-500" : "bg-green-500")} style={{ width: `${Math.min(100, (data.budget.spent / data.budget.limit) * 100)}%` }} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Teto automático: {usd(data.budget.spent, 3)} de {usd(data.budget.limit, 2)} por dia{data.budget.spent >= data.budget.limit ? " · pausado até amanhã" : ""}
              </div>
            </div>
          ) : null}
        </Kpi>
        <Kpi
          label="Renova em"
          icon={CalendarClock}
          value={a?.cycle ? `${daysLeft} dia(s)` : "—"}
          hint={a?.plan ? `Plano ${a.plan.id}${a.plan.priceUsd ? ` · ${usd(a.plan.priceUsd, 0)}/mês` : ""} · ciclo ${dmy(a.cycle?.startAt)} a ${dmy(a.cycle?.endAt)}` : undefined}
        />
      </div>

      <div className="mt-6 grid grid-cols-12 gap-6">
        <Card className="col-span-full xl:col-span-8">
          <CardHeader title="Gasto por dia no ciclo" description="Valor que o Apify cobrou em cada dia (fuso UTC)." />
          <CardContent>
            {cycleDays.length ? <Bars data={cycleDays} labels={[dmy(a?.cycle?.startAt), "hoje"]} /> : <div className="py-12 text-center text-sm text-muted-foreground">Sem dados do Apify ainda.</div>}
          </CardContent>
        </Card>
        <Card className="col-span-full xl:col-span-4">
          <CardHeader title="Previsão" description="Pelo ritmo deste ciclo." />
          <CardContent className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Média por dia</span>
              <span className="font-semibold tabular-nums">{usd(perDay, 3)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Previsão do ciclo inteiro</span>
              <span className={cn("font-semibold tabular-nums", max && projected > max ? "text-red-500" : "")}>{usd(projected, 2)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Para terminar o que falta no banco</span>
              <span className="font-semibold tabular-nums">{usd(toFinish, 2)}</span>
            </div>
            <div className="border-t border-border-soft pt-4">
              <div className="mb-2 text-xs font-semibold text-gray-400 uppercase">Puxadas por hora, hoje</div>
              <Bars data={hours} height={64} labels={["0h", "23h"]} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-12 gap-6">
        <Card className="col-span-full xl:col-span-8">
          <CardHeader title="Custo de cada tipo de puxada" description={`Neste ciclo, pelo nosso registro. Preço do plano ${p?.tier || ""}: o valor exato de cada dia está no gráfico acima.`} />
          <div className="overflow-x-auto pb-3">
            <table className="w-full table-auto text-sm">
              <thead className="bg-gray-50 text-xs text-gray-400 uppercase dark:bg-gray-700/50 dark:text-gray-500">
                <tr>
                  <th className={TH}>Tipo</th>
                  <th className={cn(TH, "text-right whitespace-nowrap")}>Puxadas</th>
                  <th className={cn(TH, "text-right whitespace-nowrap")}>Hoje</th>
                  <th className={cn(TH, "text-right whitespace-nowrap")}>Falhas</th>
                  <th className={cn(TH, "text-right whitespace-nowrap")}>Custo médio</th>
                  <th className={cn(TH, "text-right whitespace-nowrap")}>Tempo médio</th>
                  <th className={cn(TH, "text-right whitespace-nowrap")}>Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft font-medium">
                {data?.byKind.length ? (
                  data.byKind.map((k) => (
                    <tr key={k.kind}>
                      <td className={TD}>
                        <span className="flex items-center gap-2">
                          <span className={cn("size-2.5 shrink-0 rounded-full", KIND_COLOR[k.kind] || "bg-gray-400")} />
                          {k.label}
                        </span>
                      </td>
                      <td className={cn(TD, NUM)}>{num(k.n)}</td>
                      <td className={cn(TD, NUM)}>{num(k.n_today)}</td>
                      <td className={cn(TD, NUM, k.fails ? "text-red-500" : "text-muted-foreground")}>{num(k.fails)}</td>
                      <td className={cn(TD, NUM)}>{usd(k.avg_usd, 4)}</td>
                      <td className={cn(TD, NUM, "text-muted-foreground")}>{k.avg_ms ? `${(k.avg_ms / 1000).toFixed(1)}s` : "—"}</td>
                      <td className={cn(TD, NUM, "text-green-600")}>{usd(k.usd, 3)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                      Nenhuma puxada registrada ainda. O registro começou agora: as próximas buscas aparecem aqui.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {p ? (
            <div className="border-t border-border-soft px-5 py-3 text-xs text-muted-foreground">
              Tabela do Apify por puxada: busca do nome {usd(p.start + 8 * p.listing, 4)} (até 8 resultados) · Google {usd(p.search, 4)} · página com fotos {usd(p.fetch, 4)} · ficha {usd(p.start + p.profile, 4)}.
            </div>
          ) : null}
        </Card>
        <Card className="col-span-full xl:col-span-4">
          <CardHeader title="Cobertura do Fragrantica" description="Quanto do nosso banco já foi puxado." />
          <CardContent className="space-y-4">
            {c ? (
              <>
                <Meter label="Perfumes com página do Fragrantica" value={c.linked} total={c.products} hint={`${num(c.notFound)} não achados · ${num(c.toSearch)} esperando a busca`} />
                <Meter label="Páginas com fotos lidas" value={c.photosRead} total={c.photosRead + c.photosPending} cls="bg-yellow-500" hint={`${num(c.photos)} fotos guardadas, de ${num(c.perfumesWithPhotos)} perfumes`} />
                <Meter label="Fichas (notas e acordes)" value={c.withDetails} total={c.withDetails + c.detailsPending} cls="bg-green-500" />
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-12 gap-6">
        <Card className="col-span-full xl:col-span-8">
          <CardHeader title="Puxadas dos últimos 14 dias" description="Custo estimado por dia, separado por tipo (passe o mouse)." />
          <CardContent>
            <Bars data={ourDays} labels={[ourDays[0]?.key.split("-").reverse().slice(0, 2).join("/") || "", "hoje"]} />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {Object.entries(data?.kinds || {})
                .filter(([k]) => k !== "pinterest")
                .map(([k, l]) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <span className={cn("size-2.5 rounded-full", KIND_COLOR[k])} /> {l}
                  </span>
                ))}
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-full xl:col-span-4">
          <CardHeader title="Serviços cobrados pelo Apify" description="Detalhe oficial do ciclo." />
          <ul className="divide-y divide-border-soft px-5 pb-3 text-sm">
            {a?.services?.length ? (
              a.services.slice(0, 8).map((s) => (
                <li key={s.service} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-gray-700 dark:text-gray-200" title={s.service}>
                    {SERVICE_LABEL[s.service] || s.service}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{usd(s.usd)}</span>
                </li>
              ))
            ) : (
              <li className="py-6 text-center text-muted-foreground">Nada cobrado ainda neste ciclo.</li>
            )}
          </ul>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Todas as puxadas" description="Cada chamada paga que o sistema fez, a mais nova primeiro (últimas 300)." className="mb-0" />
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          {[["", "Todas"], ...Object.entries(data?.kinds || {}).filter(([k]) => k !== "pinterest")].map(([k, l]) => (
            <Button key={k || "all"} size="sm" variant={kind === k ? "accent" : "outline"} onClick={() => setKind(k)}>
              {l}
            </Button>
          ))}
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar perfume ou resultado" className="pl-9" />
          </div>
        </div>
        <div className="overflow-x-auto pb-3">
          <table className="w-full table-auto text-sm">
            <thead className="bg-gray-50 text-xs text-gray-400 uppercase dark:bg-gray-700/50 dark:text-gray-500">
              <tr>
                <th className={TH}>Quando</th>
                <th className={TH}>Tipo</th>
                <th className={TH}>Perfume</th>
                <th className={TH}>Resultado</th>
                <th className={cn(TH, "text-right whitespace-nowrap")}>Tempo</th>
                <th className={cn(TH, "text-right whitespace-nowrap")}>Custo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {data?.calls.length ? (
                data.calls.map((x) => (
                  <tr key={x.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/20">
                    <td className={cn(TD, "whitespace-nowrap text-muted-foreground")} title={hm(x.at)}>
                      {timeAgo(x.at)}
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <span className="flex items-center gap-2">
                        <span className={cn("size-2 shrink-0 rounded-full", KIND_COLOR[x.kind] || "bg-gray-400")} />
                        {data.kinds[x.kind] || x.kind}
                      </span>
                    </td>
                    <td className={cn(TD, "max-w-72 truncate font-medium text-gray-800 dark:text-gray-100")} title={x.label || ""}>
                      {x.name || x.label || "—"}
                    </td>
                    <td className={cn(TD, "max-w-80")}>
                      {x.ok ? (
                        <span className={cn("line-clamp-2", /^achou/.test(x.result || "") ? "text-green-600" : /nenhum/.test(x.result || "") ? "text-yellow-700 dark:text-yellow-400" : "")}>{x.result}</span>
                      ) : (
                        <Badge tone="danger">{(x.result || "falhou").slice(0, 60)}</Badge>
                      )}
                    </td>
                    <td className={cn(TD, "text-right whitespace-nowrap text-muted-foreground tabular-nums")}>{x.ms ? `${(x.ms / 1000).toFixed(1)}s` : "—"}</td>
                    <td className={cn(TD, "text-right whitespace-nowrap font-medium tabular-nums")}>{usd(x.cost_usd, 4)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                    Nenhuma puxada {kind || q ? "com esse filtro" : "registrada ainda"}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-12 gap-6">
        <Card className="col-span-full xl:col-span-5">
          <CardHeader title="Perfumes que mais gastaram" description="Neste ciclo." />
          <ul className="divide-y divide-border-soft px-5 pb-3 text-sm">
            {data?.top.length ? (
              data.top.map((t) => (
                <li key={t.product_id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 truncate font-medium">{t.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t.n}× · <span className="font-semibold text-foreground">{usd(t.usd, 4)}</span>
                  </span>
                </li>
              ))
            ) : (
              <li className="py-6 text-center text-muted-foreground">Ainda sem dados.</li>
            )}
          </ul>
        </Card>
        <Card className="col-span-full xl:col-span-7">
          <CardHeader title="Execuções no Apify" description={`Últimas ${a?.runs?.length || 0} de ${num(a?.runsTotal)} na conta, com o custo real de cada uma.`} />
          <div className="max-h-[420px] overflow-auto pb-3">
            <table className="w-full table-auto text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-400 uppercase dark:bg-gray-700/50 dark:text-gray-500">
                <tr>
                  <th className={TH}>Robô</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Início</th>
                  <th className={cn(TH, "text-right whitespace-nowrap")}>Duração</th>
                  <th className={cn(TH, "text-right whitespace-nowrap")}>Custo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {a?.runs?.length ? (
                  a.runs.map((r) => (
                    <tr key={r.id}>
                      <td className={cn(TD, "font-medium")}>{r.actor}</td>
                      <td className={TD}>
                        <Badge tone={r.status === "SUCCEEDED" ? "success" : r.status === "RUNNING" ? "info" : r.status === "FAILED" || r.status === "TIMED-OUT" ? "danger" : "neutral"}>
                          {{ SUCCEEDED: "ok", RUNNING: "rodando", FAILED: "falhou", "TIMED-OUT": "tempo esgotado", ABORTED: "cancelada" }[r.status] || r.status}
                        </Badge>
                      </td>
                      <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{new Date(r.startedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className={cn(TD, NUM, "text-muted-foreground")}>
                        {r.finishedAt ? `${Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s` : "—"}
                      </td>
                      <td className={cn(TD, NUM, "font-medium")}>{r.usd == null ? "—" : usd(r.usd, 4)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                      Nenhuma execução nesta conta ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
