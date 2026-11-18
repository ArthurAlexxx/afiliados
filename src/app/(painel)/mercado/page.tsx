"use client";

import * as React from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronDown, ClipboardPaste, RefreshCw, Search, Trash2, Telescope } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api, useApi, timeAgo } from "@/lib/client";
import { cn } from "@/lib/utils";

type Snap = { id: number; endpoint: string; category: string; params: string; ref_date: string; items: number; created_at: string };
type Index = { snapshots: Snap[]; radar: { configured: boolean; host: string | null; hasToken: boolean; categorias: string[] }; pull: { running: boolean; last: string | null; error: string | null } };
type Ours = { offers: number; minPrice: number | null; lastPosted: string | null; product: string } | null;
type Row = {
  name: string; brand: string | null; position: number | null; revenue: number | null; units: number | null; price: number | null;
  growth: number | null; ml: number | null; origin: string | null; link: string | null; image: string | null;
  shops: number | null; ads: number | null; series: number[] | null;
  share: number | null; ours: Ours; prev: { position: number | null; revenue: number | null } | null; delta: number | null; isNew: boolean;
};
type Brand = { brand: string; revenue: number; units: number; products: number; share: number; growth: number | null; series: number[] | null; ticket: number | null };
type Group = { label: string; revenue: number; units: number; products: number };
type Analysis = {
  meta: Snap; compare: Snap | null;
  days: { day: string; revenue: number; units: number }[];
  shops: { id: string; revenue: number; share: number | null }[];
  kpis: {
    categoryRevenue: number | null;
    products: number; brands: number; revenue: number | null; units: number | null; avgTicket: number | null; medianGrowth: number | null;
    rising: number; falling: number; top10Share: number | null; top3BrandShare: number | null; covered: number; newItems: number; dropped: string[];
  };
  brands: Brand[]; brandRisers: Brand[]; brandFallers: Brand[];
  bands: Group[]; sizes: Group[]; origins: Group[];
  risers: Row[]; fallers: Row[]; opportunities: Row[]; rows: Row[];
};

const brl = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const big = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};
const pct = (n: number | null | undefined, signed = false) =>
  n == null ? "—" : `${signed && n > 0 ? "+" : ""}${n.toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(n) < 10 ? 1 : 0 })}%`;
const bkey = (b: string) =>
  b.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9& ]+/g, "").replace(/^(O|GIORGIO)\s+/, "")
    .replace(/\s+(BEAUTY|PARFUMS?|PERFUMES?|PARIS|FRAGRANCES?)$/, "").replace(/\s+/g, " ").trim();
const money = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e6 ? `R$ ${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : n >= 1e4 ? `R$ ${(n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : brl(n);
const dateBR = (d: string) => d.split("-").reverse().join("/");
const endpointLabel = (e: string) => (e === "mais-vendidos" ? "Mais vendidos" : e === "em-alta" ? "Em alta" : e === "vendas" ? "Todas as vendas" : e);
const snapLabel = (s: Snap) => `${dateBR(s.ref_date)} · ${endpointLabel(s.endpoint)}${s.category ? ` · ${s.category}` : ""} (${s.items})`;

function Growth({ g }: { g: number | null }) {
  if (g == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-0.5 tabular-nums", g > 0 ? "text-green-600 dark:text-green-400" : g < 0 ? "text-danger" : "text-muted-foreground")}>
      {g > 0 ? <ArrowUp className="size-3" /> : g < 0 ? <ArrowDown className="size-3" /> : null}
      {pct(Math.abs(g))}
    </span>
  );
}

function DailyChart({ days }: { days: Analysis["days"] }) {
  const max = Math.max(1, ...days.map((d) => d.revenue));
  return (
    <Card>
      <CardHeader title="Faturamento por dia" description="Passe o mouse numa barra para ver o valor" />
      <CardContent>
        <div className="flex h-36 items-end gap-1">
          {days.map((d) => (
            <div key={d.day} title={`${dateBR(d.day)}: ${brl(d.revenue)} · ${big(d.units)} un.`} className="flex-1 rounded-t bg-violet-500 hover:bg-violet-600" style={{ height: `${(d.revenue / max) * 100}%` }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground">
          <span>{dateBR(days[0].day)}</span>
          <span>{dateBR(days[days.length - 1].day)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Sparkline({ values, className }: { values: number[] | null; className?: string }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(1, ...values);
  const w = 90, h = 24;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(" ");
  const half = Math.floor(values.length / 2);
  const a = values.slice(0, half).reduce((x, y) => x + y, 0), b = values.slice(-half).reduce((x, y) => x + y, 0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-6 w-[90px] overflow-visible", className)} aria-hidden>
      <polyline points={pts} fill="none" strokeWidth="1.5" strokeLinejoin="round" className={b >= a ? "stroke-green-500" : "stroke-red-500"} />
    </svg>
  );
}

function SeriesChart({ values, days, label }: { values: number[]; days: string[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div>
      <div className="flex h-24 items-end gap-1">
        {values.map((v, i) => (
          <div key={i} title={`${days[i] ? dateBR(days[i]) : i + 1}: ${brl(v)}`} className="flex-1 rounded-t bg-violet-500 hover:bg-violet-600" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground">
        <span>{days[0] ? dateBR(days[0]) : ""}</span>
        <span>{label}</span>
        <span>{days.length ? dateBR(days[days.length - 1]) : ""}</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</div> : null}
    </Card>
  );
}

/** Lista de barras horizontais (fatia do faturamento, ou das unidades quando não há faturamento). */
type Mode = "revenue" | "units" | "count";
function Bars({ rows, mode, total: totalOf }: { rows: { label: string; value: number; extra?: React.ReactNode }[]; mode: Mode; total?: number | null }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = totalOf || rows.reduce((a, r) => a + r.value, 0) || 1;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between gap-2 text-[13px]">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {mode === "units" ? `${big(r.value)} un.` : mode === "count" ? `${r.value}` : brl(r.value)} · {pct((r.value / total) * 100)}
              {r.extra}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
      {!rows.length && <li className="text-[13px] text-muted-foreground">Sem dados.</li>}
    </ul>
  );
}

const pick = (x: { revenue: number; units: number; products: number }, mode: Mode) => (mode === "units" ? x.units : mode === "count" ? x.products : x.revenue);
function groupBars(g: Group[], mode: Mode) {
  return g.filter((x) => x.products > 0).map((x) => ({
    label: mode === "count" ? x.label : `${x.label} · ${x.products} produto${x.products === 1 ? "" : "s"}`,
    value: pick(x, mode),
  }));
}

function OursCell({ o }: { o: Ours }) {
  if (!o) return <Badge tone="warning">não postamos</Badge>;
  return (
    <span className="text-[12px] text-muted-foreground" title={o.product}>
      {o.offers} ofertas/30d{o.minPrice ? ` · ${brl(o.minPrice)}` : ""}
    </span>
  );
}

function History({ snap, term }: { snap: Snap; term: string }) {
  const { data } = useApi<{ points: { date: string; revenue: number | null; units: number | null; position: number | null }[] }>(
    `/api/mercado?hist=${encodeURIComponent(term)}&endpoint=${encodeURIComponent(snap.endpoint)}&categoria=${encodeURIComponent(snap.category)}`,
  );
  if (!data) return <div className="h-20 animate-pulse rounded-lg bg-muted" />;
  const pts = data.points;
  if (pts.length < 2) return <p className="text-[12px] text-muted-foreground">Só tem uma data guardada para essa lista. A evolução aparece quando houver mais retratos.</p>;
  const val = (p: (typeof pts)[number]) => p.revenue ?? p.units ?? 0;
  const max = Math.max(1, ...pts.map(val));
  return (
    <div>
      <div className="flex h-20 items-end gap-1">
        {pts.map((p) => (
          <div
            key={p.date}
            title={`${dateBR(p.date)}: ${p.revenue != null ? brl(p.revenue) : `${big(p.units)} un.`}${p.position && p.position < 1e9 ? ` · #${p.position}` : ""}`}
            className={cn("flex-1 rounded-t", val(p) ? "bg-violet-500" : "bg-muted")}
            style={{ height: `${Math.max(3, (val(p) / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground">
        <span>{dateBR(pts[0].date)}</span>
        <span>{pts[0].revenue != null ? "faturamento" : "unidades"} por data</span>
        <span>{dateBR(pts[pts.length - 1].date)}</span>
      </div>
    </div>
  );
}

type SortKey = "position" | "revenue" | "units" | "price" | "growth" | "delta";

function Table({ a, brand, setBrand }: { a: Analysis; brand: string; setBrand: (b: string) => void }) {
  const [q, setQ] = React.useState("");
  const [limit, setLimit] = React.useState(100);
  const days = a.days.map((d) => d.day);
  const [onlyMissing, setOnlyMissing] = React.useState(false);
  const [sort, setSort] = React.useState<SortKey>("position");
  const [open, setOpen] = React.useState<string | null>(null);
  const rows = a.rows
    .filter((r) => !q || `${r.name} ${r.brand || ""}`.toLowerCase().includes(q.toLowerCase()))
    .filter((r) => !brand || bkey(r.brand || "Sem marca") === bkey(brand))
    .filter((r) => !onlyMissing || !r.ours)
    .sort((x, y) => {
      if (sort === "position") return (x.position ?? 1e9) - (y.position ?? 1e9);
      return ((y[sort] as number | null) ?? -1e12) - ((x[sort] as number | null) ?? -1e12);
    });
  const th = (k: SortKey, label: string, cls = "") => (
    <th className={cn("px-2 py-2 text-right font-medium", cls)}>
      <button onClick={() => setSort(k)} className={cn("hover:text-foreground", sort === k && "text-foreground underline")}>{label}</button>
    </th>
  );
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Todos os produtos" description="Anúncios do mesmo perfume ficam somados numa linha. Clique num produto para ver a venda de cada dia, e no título da coluna para ordenar." className="mb-0" />
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar perfume ou marca..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select
          value={brand}
          onChange={setBrand}
          className="w-48"
          options={[{ value: "", label: "Todas as marcas" }, ...a.brands.map((b) => ({ value: b.brand, label: b.brand }))]}
        />
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> só os que não postamos
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead className="text-[12px] text-muted-foreground">
            <tr className="border-b">
              {th("position", "#", "w-10 text-left")}
              <th className="px-2 py-2 text-left font-medium">Produto</th>
              {th("revenue", "Faturamento")}
              {th("units", "Unidades")}
              {th("price", "Preço médio")}
              {th("growth", "Tendência")}
              {a.compare ? th("delta", "vs. data anterior") : null}
              {days.length ? <th className="px-2 py-2 text-center font-medium">Dia a dia</th> : null}
              <th className="px-2 py-2 text-right font-medium">A gente</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(0, limit).map((r, i) => {
              const k = `${r.name}|${i}`;
              const isOpen = open === k;
              return (
                <React.Fragment key={k}>
                  <tr className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(isOpen ? null : k)}>
                    <td className="px-2 py-2 text-muted-foreground tabular-nums">{r.position ?? "—"}</td>
                    <td className="max-w-[340px] px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{r.name}</span>
                        {r.isNew && <Badge tone="accent">novo</Badge>}
                        <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                      </div>
                      <div className="text-[11.5px] text-muted-foreground">
                        {r.brand || "sem marca"}
                        {r.ml ? ` · ${r.ml} ml` : ""}
                        {r.share ? ` · ${pct(r.share * 100)} da categoria` : ""}
                        {r.ads && r.ads > 1 ? ` · ${r.ads} anúncios` : ""}
                        {r.shops ? ` · ${r.shops} loja${r.shops === 1 ? "" : "s"}` : ""}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{brl(r.revenue)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{big(r.units)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{brl(r.price)}</td>
                    <td className="px-2 py-2 text-right"><Growth g={r.growth} /></td>
                    {a.compare ? <td className="px-2 py-2 text-right">{r.isNew ? <span className="text-[12px] text-muted-foreground">entrou</span> : <Growth g={r.delta} />}</td> : null}
                    {days.length ? <td className="px-2 py-2"><Sparkline values={r.series} className="mx-auto" /></td> : null}
                    <td className="px-2 py-2 text-right"><OursCell o={r.ours} /></td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/30">
                      <td colSpan={7 + (a.compare ? 1 : 0) + (days.length ? 1 : 0)} className="px-4 py-3">
                        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
                          {r.series && days.length ? <SeriesChart values={r.series} days={days} label="faturamento por dia" /> : <History snap={a.meta} term={r.name} />}
                          <div className="text-[12px] leading-relaxed text-muted-foreground">
                            {r.ours ? <>Na nossa base: <b className="text-foreground">{r.ours.product}</b>, {r.ours.offers} ofertas nos grupos em 30 dias{r.ours.minPrice ? `, menor ${brl(r.ours.minPrice, 2)}` : ""}{r.ours.lastPosted ? `, último post ${timeAgo(r.ours.lastPosted)}` : ", nunca postado"}.</> : "Ainda não apareceu em nenhum grupo que a gente lê."}
                            {r.ours?.minPrice && r.price ? <div className="mt-1">Oferta dos grupos vs. preço médio do ML: <b className="text-foreground">{pct(((r.ours.minPrice - r.price) / r.price) * 100, true)}</b></div> : null}
                            {r.link ? <div className="mt-1"><a href={r.link} target="_blank" rel="noreferrer" className="text-violet-600 hover:underline">abrir no Mercado Livre</a></div> : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="p-4 text-[13px] text-muted-foreground">Nada com esse filtro.</p>}
        {rows.length > limit && (
          <div className="border-t p-3 text-center">
            <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 200)}>Mostrar mais ({rows.length - limit} restantes)</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

type BrandSort = "revenue" | "units" | "ticket" | "products" | "growth";
function BrandTable({ a, onPick }: { a: Analysis; onPick: (b: string) => void }) {
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<BrandSort>("revenue");
  const [limit, setLimit] = React.useState(50);
  const days = a.days.map((d) => d.day);
  const rows = a.brands
    .filter((b) => !q || b.brand.toLowerCase().includes(q.toLowerCase()))
    .sort((x, y) => ((y[sort] as number | null) ?? -1e12) - ((x[sort] as number | null) ?? -1e12));
  const th = (k: BrandSort, label: string) => (
    <th className="px-2 py-2 text-right font-medium">
      <button onClick={() => setSort(k)} className={cn("hover:text-foreground", sort === k && "text-foreground underline")}>{label}</button>
    </th>
  );
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Todas as marcas" description="Clique numa marca para ver os produtos dela. Tendência = 2ª metade do período contra a 1ª." className="mb-0" />
      <div className="border-b p-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar marca..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="text-[12px] text-muted-foreground">
            <tr className="border-b">
              <th className="w-10 px-2 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">Marca</th>
              {th("revenue", "Faturamento")}
              <th className="px-2 py-2 text-right font-medium">Fatia</th>
              {th("units", "Unidades")}
              {th("ticket", "Ticket")}
              {th("products", "Produtos")}
              {th("growth", "Tendência")}
              {days.length ? <th className="px-2 py-2 text-center font-medium">Dia a dia</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.slice(0, limit).map((b, i) => (
              <tr key={b.brand} className="cursor-pointer hover:bg-muted/50" onClick={() => onPick(b.brand)}>
                <td className="px-2 py-2 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-2 py-2 font-medium">{b.brand}</td>
                <td className="px-2 py-2 text-right tabular-nums">{brl(b.revenue)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{pct(b.share * 100)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{big(b.units)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{brl(b.ticket)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{b.products}</td>
                <td className="px-2 py-2 text-right"><Growth g={b.growth} /></td>
                {days.length ? <td className="px-2 py-2"><Sparkline values={b.series} className="mx-auto" /></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > limit && (
          <div className="border-t p-3 text-center">
            <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 100)}>Mostrar mais ({rows.length - limit} restantes)</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function BrandList({ rows, empty, onPick }: { rows: Brand[]; empty: string; onPick: (b: string) => void }) {
  return (
    <ul className="flex flex-col divide-y">
      {rows.map((b) => (
        <li key={b.brand}>
          <button onClick={() => onPick(b.brand)} className="flex w-full items-center gap-2 py-2 text-left text-[13px] hover:bg-muted/40">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{b.brand}</div>
              <div className="text-[11.5px] text-muted-foreground">{brl(b.revenue)} · {pct(b.share * 100)} · {b.products} produtos</div>
            </div>
            <Sparkline values={b.series} />
            <div className="w-16 shrink-0 text-right"><Growth g={b.growth} /></div>
          </button>
        </li>
      ))}
      {!rows.length && <li className="py-2 text-[13px] text-muted-foreground">{empty}</li>}
    </ul>
  );
}

function MiniList({ rows, empty, right }: { rows: Row[]; empty: string; right: (r: Row) => React.ReactNode }) {
  return (
    <ul className="flex flex-col divide-y">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center gap-2 py-2 text-[13px]">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{r.name}</div>
            <div className="truncate text-[11.5px] text-muted-foreground">{r.brand || "sem marca"}{r.position ? ` · #${r.position}` : ""}{r.revenue ? ` · ${brl(r.revenue)}` : ""}</div>
          </div>
          <Sparkline values={r.series} />
          <div className="w-16 shrink-0 text-right">{right(r)}</div>
        </li>
      ))}
      {!rows.length && <li className="py-2 text-[13px] text-muted-foreground">{empty}</li>}
    </ul>
  );
}

function Insights({ a }: { a: Analysis }) {
  const k = a.kpis;
  const out: string[] = [];
  if (a.brands[0] && a.brands[0].share) out.push(`${a.brands[0].brand} lidera com ${pct(a.brands[0].share * 100)} do faturamento${a.brands[1] ? `, seguida de ${a.brands[1].brand} (${pct(a.brands[1].share * 100)})` : ""}.`);
  if (k.top10Share != null) out.push(`Os 10 produtos que mais faturam somam ${pct(k.top10Share * 100)} do total${k.top10Share > 0.5 ? ": mercado concentrado em poucos perfumes" : ": mercado espalhado"}.`);
  const band = [...a.bands].sort((x, y) => y.revenue - x.revenue || y.units - x.units)[0];
  if (band && (band.revenue || band.units)) out.push(`A faixa de preço que mais vende é ${band.label}.`);
  const size = a.sizes.find((s) => s.label !== "sem tamanho");
  if (size) out.push(`Tamanho campeão: ${size.label}.`);
  const ar = a.origins.find((o) => o.label === "Árabe");
  const tot = a.origins.reduce((s, o) => s + (o.revenue || o.units), 0);
  if (ar && tot) out.push(`Árabes são ${pct(((ar.revenue || ar.units) / tot) * 100)} das vendas.`);
  if (k.medianGrowth != null) out.push(`Tendência mediana ${pct(k.medianGrowth, true)}: ${k.rising} subindo e ${k.falling} caindo.`);
  out.push(`A gente já posta ${k.covered} de ${k.products} produtos dessa lista (${pct((k.covered / Math.max(1, k.products)) * 100)}).`);
  if (a.opportunities.length) out.push(`${a.opportunities.length} produtos vendem bem ou estão subindo e quase não aparecem nos nossos grupos: veja em Oportunidades.`);
  if (a.compare) out.push(`Desde ${dateBR(a.compare.ref_date)}: ${k.newItems} entraram na lista e ${k.dropped.length} saíram.`);
  return (
    <Card>
      <CardHeader title="Resumo" description="Leitura automática do retrato escolhido" />
      <CardContent>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13.5px]">{out.map((t) => <li key={t}>{t}</li>)}</ul>
      </CardContent>
    </Card>
  );
}

function Explorer({ radar, onSaved }: { radar: Index["radar"]; onSaved: () => void }) {
  const cat = radar.categorias[0] || "";
  const [path, setPath] = React.useState(`/api/v1/mais-vendidos?categoria=${encodeURIComponent(cat)}&dias=30&porMarca=50`);
  const [res, setRes] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const run = async (guardar: boolean) => {
    setBusy(true);
    try {
      const r = await api<{ dados: unknown; saved: { items: number } | null }>("/api/mercado", { method: "POST", json: { acao: "consultar", caminho: path, guardar } });
      setRes(JSON.stringify(r.dados, null, 2));
      if (r.saved) {
        toast.success(`Guardado: ${r.saved.items} produtos`);
        onSaved();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Consultar a API do RadarHub" description={`Qualquer caminho da API em ${radar.host}. "Guardar" salva a resposta como um retrato de hoje para analisar aqui.`} />
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Input value={path} onChange={(e) => setPath(e.target.value)} className="min-w-64 flex-1 font-mono text-[12.5px]" />
          <Button variant="outline" onClick={() => run(false)} loading={busy}>Consultar</Button>
          <Button variant="accent" onClick={() => run(true)} loading={busy}>Consultar e guardar</Button>
        </div>
        {res && <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-[11.5px]">{res.length > 30000 ? res.slice(0, 30000) + "\n…" : res}</pre>}
      </CardContent>
    </Card>
  );
}

function ImportBox({ onSaved, onClose }: { onSaved: (id: number) => void; onClose: () => void }) {
  const [endpoint, setEndpoint] = React.useState("mais-vendidos");
  const [categoria, setCategoria] = React.useState("");
  const [data, setData] = React.useState(new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10));
  const [dados, setDados] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    setBusy(true);
    try {
      JSON.parse(dados);
      const r = await api<{ saved: { id: number; items: number } }>("/api/mercado", { method: "POST", json: { acao: "importar", endpoint, categoria, data, dados } });
      toast.success(`Guardado: ${r.saved.items} produtos`);
      onSaved(r.saved.id);
      onClose();
    } catch (e) {
      toast.error((e as Error).message.includes("JSON") ? "Esse texto não é um JSON válido" : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Colar resposta do RadarHub" description="Cole o JSON que a API devolveu (mais vendidos, em alta ou outra lista de produtos). Ele vira um retrato com a data escolhida." />
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Lista">
            <Select value={endpoint} onChange={setEndpoint} options={[{ value: "mais-vendidos", label: "Mais vendidos" }, { value: "em-alta", label: "Em alta" }, { value: "outro", label: "Outra" }]} />
          </Field>
          <Field label="Categoria"><Input value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="ex.: perfumes importados" /></Field>
          <Field label="Data dos dados"><Input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
        </div>
        <Textarea value={dados} onChange={(e) => setDados(e.target.value)} rows={8} placeholder='{"marcas":[{"marca":"Lattafa","produtos":[...]}]}' className="font-mono text-[12px]" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="accent" onClick={save} loading={busy} disabled={!dados.trim()}>Guardar</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MercadoPage() {
  const { data: idx, reload } = useApi<Index>("/api/mercado");
  const [sel, setSel] = React.useState<number | null>(null);
  const [vs, setVs] = React.useState<number>(0);
  const [pasting, setPasting] = React.useState(false);
  const [pulling, setPulling] = React.useState(false);
  const [tab, setTab] = React.useState<"geral" | "marcas" | "produtos">("geral");
  const [brand, setBrand] = React.useState("");
  const pickBrand = (b: string) => {
    setBrand(b);
    setTab("produtos");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const snaps = idx?.snapshots || [];
  const first = snaps.find((s) => s.endpoint === "vendas") || snaps.find((s) => s.endpoint === "mais-vendidos") || snaps[0];
  const current = snaps.find((s) => s.id === sel) || first || null;
  React.useEffect(() => {
    if (!sel && first) setSel(first.id);
  }, [sel, first]);
  const sameList = snaps.filter((s) => current && s.id !== current.id && s.endpoint === current.endpoint && s.category === current.category && s.ref_date < current.ref_date);
  React.useEffect(() => setVs(sameList[0]?.id || 0), [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: a } = useApi<Analysis>(current ? `/api/mercado?id=${current.id}${vs ? `&vs=${vs}` : ""}` : null);
  const catUnits = a && a.days.length ? a.days.reduce((x, d) => x + d.units, 0) : null;
  const mode: Mode = !a ? "revenue" : a.kpis.revenue ? "revenue" : a.kpis.units ? "units" : "count";

  const pull = async () => {
    setPulling(true);
    try {
      await api("/api/mercado", { method: "POST", json: { acao: "puxar", dias: 15 } });
      toast.success("Puxando do RadarHub. As vendas de todos os dias levam alguns minutos.");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPulling(false);
    }
  };
  const running = !!idx?.pull?.running;
  const wasRunning = React.useRef(false);
  React.useEffect(() => {
    if (running) {
      wasRunning.current = true;
      const t = setInterval(reload, 8000);
      return () => clearInterval(t);
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      if (idx?.pull.error) toast.error(idx.pull.error);
      else {
        toast.success(idx?.pull.last || "Pronto");
        setSel(null);
      }
    }
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async () => {
    if (!current) return;
    await api("/api/mercado", { method: "POST", json: { acao: "apagar", id: current.id } });
    setSel(null);
    reload();
  };

  return (
    <>
      <PageHeader
        title="Estudo de Mercado"
        description="Vendas de perfume no Mercado Livre vindas do RadarHub, guardadas por data: quem lidera, o que está subindo, faixa de preço, tamanhos e o que a gente ainda não posta."
        actions={
          <>
            <Button variant="outline" onClick={() => setPasting((p) => !p)}><ClipboardPaste className="size-4" /> Colar JSON</Button>
            {idx?.radar.configured && <Button variant="accent" onClick={pull} loading={pulling || running}><RefreshCw className="size-4" /> {running ? "Puxando..." : "Puxar do RadarHub"}</Button>}
          </>
        }
      />

      <div className="flex flex-col gap-4">
        {idx && !idx.radar.configured && (
          <Card className="border-l-4 border-l-yellow-500 px-5 py-4 text-[13.5px]">
            <b>RadarHub ainda não está ligado no servidor.</b> Falta configurar <code>RADARHUB_URL</code> e <code>RADARHUB_TOKEN</code> (e <code>RADARHUB_CATEGORIAS</code>) no Railway. Enquanto isso, dá para colar aqui as respostas da API em &quot;Colar JSON&quot;.
          </Card>
        )}
        {pasting && <ImportBox onSaved={(id) => { setSel(id); reload(); }} onClose={() => setPasting(false)} />}

        {idx && !snaps.length && !pasting && (
          <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Telescope className="size-8 text-muted-foreground" />
            <div className="font-semibold">Nenhum dado de mercado guardado ainda</div>
            <p className="max-w-md text-[13px] text-muted-foreground">
              {idx.radar.configured ? 'Clique em "Puxar do RadarHub" para trazer os mais vendidos e em alta de hoje.' : 'Cole uma resposta da API do RadarHub em "Colar JSON".'}
            </p>
          </Card>
        )}

        {current && (
          <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
            <Field label="Retrato" className="min-w-64 flex-1">
              <Select value={String(current.id)} onChange={(v) => setSel(Number(v))} options={snaps.map((s) => ({ value: String(s.id), label: snapLabel(s) }))} />
            </Field>
            <Field label="Comparar com" className="min-w-56">
              <Select value={String(vs)} onChange={(v) => setVs(Number(v))} options={[{ value: "0", label: sameList.length ? "Não comparar" : "Sem data anterior" }, ...sameList.map((s) => ({ value: String(s.id), label: snapLabel(s) }))]} />
            </Field>
            <div className="pb-2 text-[12px] text-muted-foreground">guardado {timeAgo(current.created_at)}</div>
            <Button variant="ghost" size="icon" onClick={remove} title="Apagar este retrato"><Trash2 className="size-4" /></Button>
          </Card>
        )}

        {current && !a && <div className="h-64 animate-pulse rounded-xl bg-muted" />}

        {a && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi label={a.kpis.categoryRevenue ? "Faturamento da categoria" : "Faturamento"} value={money(a.kpis.categoryRevenue ?? a.kpis.revenue)} hint={a.days.length ? `${a.days.length} dias · ${dateBR(a.days[0].day)} a ${dateBR(a.days[a.days.length - 1].day)}` : a.kpis.top10Share != null ? `top 10 produtos = ${pct(a.kpis.top10Share * 100)}` : undefined} />
              <Kpi label="Unidades" value={big(catUnits ?? a.kpis.units)} />
              <Kpi label="Ticket médio" value={brl(catUnits && a.kpis.categoryRevenue ? a.kpis.categoryRevenue / catUnits : a.kpis.avgTicket)} />
              <Kpi label="Produtos analisados" value={big(a.kpis.products)} hint={a.days.length ? `os que mais faturam · ${big(a.kpis.brands)} marcas` : `${big(a.kpis.brands)} marcas`} />
              <Kpi label="Tendência mediana" value={<Growth g={a.kpis.medianGrowth} />} hint={`${a.kpis.rising} subindo · ${a.kpis.falling} caindo`} />
              <Kpi label="A gente posta" value={`${a.kpis.covered}/${a.kpis.products}`} hint={`${pct((a.kpis.covered / Math.max(1, a.kpis.products)) * 100)} da lista`} />
            </div>

            <div className="flex gap-1 overflow-x-auto border-b">
              {([["geral", "Visão geral"], ["marcas", "Marcas"], ["produtos", "Produtos"]] as const).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap", tab === k ? "border-violet-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                >
                  {l}
                </button>
              ))}
            </div>

            {tab === "geral" && (
              <>
                <Insights a={a} />
                {(a.days.length > 1 || a.shops.length > 0) && (
                  <div className="grid gap-4 lg:grid-cols-3">
                    {a.days.length > 1 && <div className="lg:col-span-2"><DailyChart days={a.days} /></div>}
                    {a.shops.length > 0 && (
                      <Card>
                        <CardHeader title="Lojas que mais vendem" description="Fatia do faturamento da categoria" />
                        <CardContent>
                          <Bars mode="revenue" total={a.kpis.categoryRevenue} rows={a.shops.map((x) => ({ label: `Loja ${x.id}`, value: x.revenue }))} />
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card>
                    <CardHeader title="Faixa de preço" description="Pelo preço mediano de cada produto" />
                    <CardContent><Bars mode={mode} rows={groupBars(a.bands, mode)} /></CardContent>
                  </Card>
                  <Card>
                    <CardHeader title="Origem" />
                    <CardContent><Bars mode={mode} rows={groupBars(a.origins, mode)} /></CardContent>
                  </Card>
                  <Card>
                    <CardHeader title="Tamanhos" />
                    <CardContent><Bars mode={mode} rows={groupBars(a.sizes, mode)} /></CardContent>
                  </Card>
                </div>
                <Card>
                  <CardHeader title="Oportunidades" description="Vende bem ou está subindo, e quase não aparece nos nossos grupos" />
                  <CardContent><MiniList rows={a.opportunities.slice(0, 15)} empty="Nada: a gente já cobre o que vende." right={(r) => <Growth g={r.growth} />} /></CardContent>
                </Card>
              </>
            )}

            {tab === "marcas" && (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader title="Marcas subindo" description="Só marcas com 0,2% ou mais da categoria" />
                    <CardContent><BrandList rows={a.brandRisers} empty="Essa lista não traz tendência." onPick={pickBrand} /></CardContent>
                  </Card>
                  <Card>
                    <CardHeader title="Marcas caindo" description="Só marcas com 0,2% ou mais da categoria" />
                    <CardContent><BrandList rows={a.brandFallers} empty="Nenhuma marca grande caindo." onPick={pickBrand} /></CardContent>
                  </Card>
                </div>
                <Card>
                  <CardHeader title="Maiores marcas" description={`Fatia ${mode === "units" ? "das unidades" : mode === "count" ? "dos produtos da lista" : "do faturamento"}${a.kpis.top3BrandShare != null ? ` · as 3 maiores = ${pct(a.kpis.top3BrandShare * 100)}` : ""}`} />
                  <CardContent>
                    <Bars
                      mode={mode}
                      total={mode === "revenue" ? a.kpis.categoryRevenue : null}
                      rows={a.brands.slice(0, 15).map((b) => ({
                        label: b.brand,
                        value: pick(b, mode),
                        extra: b.growth != null ? <span className="ml-1"><Growth g={b.growth} /></span> : null,
                      }))}
                    />
                  </CardContent>
                </Card>
                <BrandTable a={a} onPick={pickBrand} />
              </>
            )}

            {tab === "produtos" && (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader title="Produtos subindo" description="Só produtos com 0,1% ou mais da categoria" />
                    <CardContent><MiniList rows={a.risers} empty="Essa lista não traz tendência." right={(r) => <Growth g={r.growth} />} /></CardContent>
                  </Card>
                  <Card>
                    <CardHeader title="Produtos caindo" description="Só produtos com 0,1% ou mais da categoria" />
                    <CardContent><MiniList rows={a.fallers} empty="Ninguém caindo." right={(r) => <Growth g={r.growth} />} /></CardContent>
                  </Card>
                </div>
                {a.compare && a.kpis.dropped.length > 0 && (
                  <Card>
                    <CardHeader title={`Saíram da lista desde ${dateBR(a.compare.ref_date)}`} />
                    <CardContent className="flex flex-wrap gap-1.5">{a.kpis.dropped.map((n) => <Badge key={n}>{n}</Badge>)}</CardContent>
                  </Card>
                )}
                <Table a={a} brand={brand} setBrand={setBrand} />
              </>
            )}
          </>
        )}

        {idx?.radar.configured && <Explorer radar={idx.radar} onSaved={() => { setSel(null); reload(); }} />}
      </div>
    </>
  );
}
