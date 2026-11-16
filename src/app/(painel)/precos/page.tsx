"use client";

import * as React from "react";
import { ChevronDown, Search } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useApi, timeAgo } from "@/lib/client";
import { cn } from "@/lib/utils";

type Real = { ref: number; samples: number; groups: number; min: number; max: number } | null;
type Row = { id: number; name: string; origin: string | null; offers: number; real: Real; bestToday: number | null; todayDiscount: number | null; min30: number };
type Detail = { days: { day: string; min: number; n: number }[]; offers: { price: number; old_price: number | null; group_name: string; created_at: string }[]; real: Real };

const brl = (n: number | null | undefined) => (n == null ? "—" : `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function Label({ d }: { d: number | null }) {
  if (d == null) return <span className="text-[12px] text-muted-foreground">—</span>;
  const pct = Math.round(d * 100);
  if (d >= 0.2) return <Badge tone="success">Ótima · {pct}% abaixo</Badge>;
  if (d >= 0.08) return <Badge tone="info">Boa · {pct}% abaixo</Badge>;
  return <Badge tone="neutral">Normal · {pct >= 0 ? `${pct}% abaixo` : `${-pct}% acima`}</Badge>;
}

function Chart({ d }: { d: Detail }) {
  if (!d.days.length) return null;
  const max = Math.max(...d.days.map((x) => x.min), d.real?.ref || 0);
  return (
    <div>
      <div className="relative flex h-28 items-end gap-1">
        {d.real && (
          <div className="absolute inset-x-0 border-t border-dashed border-foreground/40" style={{ bottom: `${(d.real.ref / max) * 100}%` }}>
            <span className="absolute -top-4 right-0 text-[10.5px] text-muted-foreground">preço real {brl(d.real.ref)}</span>
          </div>
        )}
        {d.days.map((x) => (
          <div key={x.day} title={`${x.day.split("-").reverse().join("/")}: ${brl(x.min)} (${x.n} ofertas)`} className="flex-1 rounded-t bg-foreground/70" style={{ height: `${(x.min / max) * 100}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground">
        <span>{d.days[0].day.split("-").reverse().slice(0, 2).join("/")}</span>
        <span>menor preço de cada dia</span>
        <span>{d.days[d.days.length - 1].day.split("-").reverse().slice(0, 2).join("/")}</span>
      </div>
    </div>
  );
}

function RowItem({ r }: { r: Row }) {
  const [open, setOpen] = React.useState(false);
  const { data } = useApi<Detail>(open ? `/api/precos?id=${r.id}` : null);
  return (
    <li>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium">{r.name}</div>
          <div className="text-[12px] text-muted-foreground">
            {r.offers} ofertas em 30 dias{r.origin ? ` · ${r.origin === "arabe" ? "árabe" : r.origin}` : ""}
          </div>
        </div>
        <div className="hidden w-32 text-right sm:block">
          <div className="text-[13px] font-medium tabular-nums">{r.real ? brl(r.real.ref) : "—"}</div>
          <div className="text-[11px] text-muted-foreground">{r.real ? `${r.real.samples} preços · ${r.real.groups} grupos` : "sem referência ainda"}</div>
        </div>
        <div className="w-28 text-right">
          <div className="text-[13px] tabular-nums">{brl(r.bestToday)}</div>
          <div className="text-[11px] text-muted-foreground">melhor de hoje</div>
        </div>
        <div className="hidden w-40 justify-end md:flex"><Label d={r.todayDiscount} /></div>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid gap-4 border-t bg-muted/30 px-4 py-4 md:grid-cols-2">
          {data ? <Chart d={data} /> : <div className="h-28 animate-pulse rounded-lg bg-muted" />}
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-[12px]">
            {data?.offers.map((o, i) => {
              const inflated = data.real && o.old_price && o.old_price > data.real.ref * 1.5;
              return (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-muted-foreground">{timeAgo(o.created_at)}</span>
                  <span className="min-w-0 flex-1 truncate">{o.group_name}</span>
                  {o.old_price ? <span className={cn("tabular-nums line-through", inflated ? "text-danger" : "text-muted-foreground")} title={inflated ? "DE inflado" : undefined}>{brl(o.old_price)}</span> : null}
                  <span className="font-medium tabular-nums">{brl(o.price)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

export default function PrecosPage() {
  const { data } = useApi<{ rows: Row[]; inflators: { name: string; inflated: number; total: number }[] }>("/api/precos", 60000);
  const [q, setQ] = React.useState("");
  const rows = (data?.rows || []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader
        title="Preços"
        description={'Preço real de cada perfume: a mediana do que os grupos cobram ("POR") nos últimos 30 dias. O "DE" dos grupos não entra. Oferta boa = 8% ou mais abaixo do preço real; ótima = 20% ou mais.'}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar perfume..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
          </div>
          {data ? (
            <ul className="divide-y">{rows.slice(0, 150).map((r) => <RowItem key={r.id} r={r} />)}</ul>
          ) : (
            <div className="h-64 animate-pulse bg-muted" />
          )}
        </Card>
        <Card className="self-start">
          <CardHeader title="Quem infla o DE" description={'% das ofertas com "DE" acima de 1,5x o preço real'} />
          <CardContent>
            <ul className="flex flex-col gap-3">
              {data?.inflators.map((g) => (
                <li key={g.name}>
                  <div className="mb-1 flex justify-between gap-2 text-[13px]">
                    <span className="truncate">{g.name}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{Math.round((g.inflated / g.total) * 100)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-danger" style={{ width: `${(g.inflated / g.total) * 100}%` }} />
                  </div>
                </li>
              ))}
              {data && !data.inflators.length && <li className="text-[13px] text-muted-foreground">Ainda sem dados suficientes.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
