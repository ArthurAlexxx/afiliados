"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, Copy, Flame, ImagePlus, Pause, Play, Radio, Search, TrendingDown, X } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api, clockOf } from "@/lib/client";
import { cn } from "@/lib/utils";
import { CropSquare, type Crop } from "@/components/crop-square";
import { DropPhoto } from "../fotos/drop";

type Item = {
  id: number; pid: number; name: string; group: string; price: number | null; old: number | null; url: string | null; at: string;
  ok: boolean; label: string | null; pct: number | null; ref: number | null; min: number | null; samples: number; groups: number; why: string;
  post: { id: number; status: string; eta?: number | null; etaAt?: number } | null;
};
type Top = { pid: number; name: string; price: number | null; ref: number | null; pct: number | null; label: string | null; group: string; url: string | null; at: string };
type Stats = {
  hour: { n: number; p: number };
  byGroup: { g: string; n: number }[];
  trending: { pid: number; name: string; n: number; groups: number; price: number }[];
  top: Top[];
  passedHour: number;
  dealsGroup: string | null;
};

const MAX = 400;
const brl = (n: number | null | undefined) => (n == null ? "—" : `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const shortGroup = (g: string) => g.replace(/[#|🔥].*$/u, "").replace(/\s+-\s+.*$/, "").trim().slice(0, 22) || g.slice(0, 22);
const POST: Record<string, string> = { review: "esperando aprovação", photo: "esperando foto", queued: "na fila", sending: "enviando", sent: "publicado", skipped: "descartado", failed: "falhou" };

function adText(t: { name: string; price: number | null; ref: number | null; pct: number | null }) {
  return `🔥 ${t.name} por ${brl(t.price)}${t.ref ? ` (costuma sair por ${brl(t.ref)}, ${t.pct}% abaixo)` : ""}\nSó no nosso grupo de ofertas de perfume. Entre pelo link e ative as notificações!`;
}

type Foto = { id: number; width: number; height: number; disabled: number; group_name: string; crop?: string | null };

/** Fotos do perfume: escolher a que vai nos próximos posts ou mandar uma nova. */
/** "entra no grupo em ~3 min", contando sozinho. */
function EtaTag({ at }: { at: number }) {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 10000);
    return () => clearInterval(t);
  }, []);
  const sec = (at - Date.now()) / 1000;
  return <span className="font-medium text-accent"> · entra no grupo {sec < 45 ? "agora" : `em ~${Math.max(1, Math.round(sec / 60))} min`}</span>;
}

function PhotoSheet({ pid, name, onClose }: { pid: number; name: string; onClose: () => void }) {
  const [data, setData] = React.useState<{ images: Foto[]; used: number | null; product: { main_image_id: number | null } } | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Arthur (22/nov): ao escolher/soltar a foto, abre o ajuste do quadrado do post antes de salvar
  const [crop, setCrop] = React.useState<{ id: number; initial: Crop | null } | null>(null);
  const load = React.useCallback(() => fetch(`/api/fotos?id=${pid}`).then((r) => r.json()).then(setData), [pid]);
  React.useEffect(() => {
    load();
  }, [load]);
  const setMain = async (id: number, c?: Crop) => {
    setBusy(true);
    try {
      await api("/api/fotos", { method: "PATCH", json: { productId: pid, mainImageId: id, crop: c } });
      toast.success("Essa foto vai nos próximos posts");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const parse = (c?: string | null): Crop | null => {
    try {
      return c ? (JSON.parse(c) as Crop) : null;
    } catch {
      return null;
    }
  };
  const used = data?.product?.main_image_id ?? data?.used ?? null;
  const imgs = (data?.images || []).filter((i) => !i.disabled);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-background p-4 shadow-xl sm:max-w-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">{name}</div>
            <div className="text-[12px] text-muted-foreground">Toque numa foto para ajustar o quadrado do post e usar nos próximos posts.</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Fechar">
            <X className="size-4" />
          </button>
        </div>
        <div className="mb-3">
          <DropPhoto
            productId={pid}
            compact
            label="Arraste uma foto aqui (do Google, WhatsApp ou do computador)"
            onAdded={load}
            onUploaded={(id) => {
              void load();
              setCrop({ id, initial: null });
            }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {imgs.map((i) => (
            <button
              key={i.id}
              onClick={() => setCrop({ id: i.id, initial: parse(i.crop) })}
              disabled={busy}
              className={cn("relative aspect-square overflow-hidden rounded-lg border-2", used === i.id ? "border-green-500" : "border-transparent")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/fotos/square?img=${i.id}&w=300`} alt="" loading="lazy" className="size-full object-cover" />
              {used === i.id && (
                <span className="absolute top-1 right-1 rounded-full bg-green-500 p-0.5 text-white">
                  <Check className="size-3" />
                </span>
              )}
            </button>
          ))}
        </div>
        {data && !imgs.length && <p className="mt-3 text-[12px] text-muted-foreground">Esse perfume ainda não tem foto no banco: os posts usam a foto do anúncio do ML.</p>}
      </div>
      {crop ? (
        <div onClick={(e) => e.stopPropagation()}>
          <CropSquare
            src={`/api/fotos/${crop.id}?w=1200`}
            title={name}
            initial={crop.initial}
            confirmLabel="Usar nos próximos posts"
            onCancel={() => {
              const x = crop;
              setCrop(null);
              // foto nova solta: sem ajuste, salva do jeito que veio
              if (!x.initial && used !== x.id) void setMain(x.id);
            }}
            onConfirm={async (c) => {
              const x = crop;
              setCrop(null);
              await setMain(x.id, c);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export default function AoVivoPage() {
  const [items, setItems] = React.useState<Item[]>([]);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [paused, setPaused] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | "ok" | "otima" | "no">("all");
  const [group, setGroup] = React.useState("");
  const [q, setQ] = React.useState("");
  const [fresh, setFresh] = React.useState<Set<number>>(new Set());
  const [sheet, setSheet] = React.useState<{ pid: number; name: string } | null>(null);
  const last = React.useRef(0);
  const tick = React.useRef(0);
  const pausedRef = React.useRef(false);
  pausedRef.current = paused;

  const busy = React.useRef(false);
  const load = React.useCallback(async () => {
    if (pausedRef.current || document.hidden || busy.current) return;
    busy.current = true;
    tick.current++;
    const withStats = !last.current || tick.current % 10 === 0;
    try {
      // a cada ~15s também atualiza os posts que já estão na tela (status e tempo para entrar no grupo)
      const withPosts = !!last.current && tick.current % 5 === 0;
      const r = await fetch(`/api/aovivo?after=${last.current}${withStats ? "&stats=1" : ""}${withPosts ? "&posts=1" : ""}`, { cache: "no-store" });
      if (r.status === 401) return void (window.location.href = "/login");
      const j = (await r.json()) as { items: Item[]; stats: Stats | null; posts?: Record<number, Item["post"]> | null };
      const stamp = (p: Item["post"]) => (p && p.eta != null ? { ...p, etaAt: Date.now() + p.eta * 1000 } : p);
      j.items = j.items.map((i) => ({ ...i, post: stamp(i.post) }));
      if (j.stats) setStats(j.stats);
      if (j.posts) {
        const ps = j.posts;
        setItems((cur) => cur.map((i) => (i.id in ps ? { ...i, post: stamp(ps[i.id]) } : i)));
      }
      if (j.items.length) {
        const first = !last.current;
        last.current = Math.max(last.current, ...j.items.map((i) => i.id));
        setItems((cur) => {
          const seen = new Set(cur.map((i) => i.id));
          return [...j.items.filter((i) => !seen.has(i.id)), ...cur].slice(0, MAX);
        });
        if (!first) {
          const ids = new Set(j.items.map((i) => i.id));
          setFresh(ids);
          setTimeout(() => setFresh(new Set()), 4000);
          // contagem da hora sobe junto, sem esperar a próxima leitura dos números
          setStats((s) => (s ? { ...s, hour: { ...s.hour, n: s.hour.n + j.items.length }, passedHour: s.passedHour + j.items.filter((i) => i.ok).length } : s));
        }
      }
    } catch {
      /* sem rede: tenta de novo no próximo ciclo */
    } finally {
      busy.current = false;
    }
  }, []);

  React.useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    const vis = () => !document.hidden && load();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [load]);

  const groups = React.useMemo(() => [...new Set(items.map((i) => i.group))].sort(), [items]);
  const shown = React.useMemo(() => {
    const ql = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (filter === "all" || (filter === "ok" && i.ok) || (filter === "otima" && i.label === "otima") || (filter === "no" && !i.ok)) &&
        (!group || i.group === group) &&
        (!ql || i.name.toLowerCase().includes(ql)),
    );
  }, [items, filter, group, q]);

  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Texto copiado"), () => toast.error("Não consegui copiar"));

  return (
    <>
      <PageHeader
        title="Ao vivo"
        description="Toda promoção do Mercado Livre que chega dos grupos, com a análise do agente na hora."
        actions={
          <button
            onClick={() => setPaused((p) => !p)}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium", paused ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-background")}
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />} {paused ? "Continuar" : "Pausar"}
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Promoções na última hora", value: stats?.hour.n ?? "—", icon: Radio },
          { label: "Perfumes diferentes", value: stats?.hour.p ?? "—", icon: Search },
          { label: "Passaram na regra (1h)", value: stats?.passedHour ?? "—", icon: TrendingDown },
          { label: "Grupos ativos (1h)", value: stats?.byGroup.length ?? "—", icon: Flame },
        ].map((k) => (
          <Card key={k.label} className="flex items-center gap-3 p-4">
            <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
              <k.icon className="size-4 text-muted-foreground" />
            </span>
            <div>
              <div className="text-[20px] leading-none font-semibold tabular-nums">{k.value}</div>
              <div className="mt-1 text-[12px] text-muted-foreground">{k.label}</div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", paused ? "bg-amber-500" : "animate-pulse bg-green-500")} /> Promoções chegando
              </span>
            }
            description={`${shown.length} de ${items.length} na tela · atualiza a cada 3 s`}
          />
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <div className="flex rounded-lg border bg-background p-0.5 text-[12px]">
                {(
                  [
                    ["all", "Todas"],
                    ["ok", "Passaram"],
                    ["otima", "Ótimas"],
                    ["no", "Recusadas"],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} onClick={() => setFilter(k)} className={cn("h-7 rounded-md px-2.5 font-medium", filter === k ? "bg-muted text-foreground" : "text-muted-foreground")}>
                    {l}
                  </button>
                ))}
              </div>
              <select value={group} onChange={(e) => setGroup(e.target.value)} className="h-8 max-w-48 rounded-lg border bg-background px-2 text-[12.5px]">
                <option value="">Todos os grupos</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <div className="relative min-w-40 flex-1">
                <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar perfume" className="h-8 pl-8 text-[12.5px]" />
              </div>
            </div>

            <ul className="divide-y overflow-hidden rounded-lg border">
              {shown.map((i) => (
                <li
                  key={i.id}
                  onClick={() => setSheet({ pid: i.pid, name: i.name })}
                  style={{ contentVisibility: "auto", containIntrinsicSize: "0 64px" }}
                  className={cn("grid cursor-pointer grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50", fresh.has(i.id) && "bg-violet-500/10", i.ok && "border-l-2 border-l-green-500")}
                >
                  <div className="text-[11.5px] text-muted-foreground tabular-nums">{clockOf(i.at)}</div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{i.name}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">
                      {shortGroup(i.group)} · {i.why}
                      {i.post ? ` · post #${i.post.id} ${POST[i.post.status] || i.post.status}` : ""}
                      {i.post?.status === "queued" && i.post.etaAt ? <EtaTag at={i.post.etaAt} /> : null}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[13px] font-semibold tabular-nums">{brl(i.price)}</span>
                    {i.ok ? (
                      <Badge tone={i.label === "otima" ? "success" : "info"}>{i.label === "otima" ? "Ótima" : "Boa"} −{i.pct}%</Badge>
                    ) : i.pct != null ? (
                      <span className="text-[11px] text-muted-foreground tabular-nums">{i.pct >= 0 ? `−${i.pct}%` : `+${-i.pct}%`} vs {brl(i.ref)}</span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">sem histórico</span>
                    )}
                  </div>
                </li>
              ))}
              {!shown.length && <li className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">{items.length ? "Nada com esse filtro." : "Carregando…"}</li>}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Melhores para anúncio (6h)" description="Maior desconto contra o preço normal dos grupos. Copie o texto pronto." />
            <CardContent className="px-0 pb-2">
              <ul className="divide-y border-t">
                {stats?.top.map((t) => (
                  <li key={t.pid} className="flex items-center gap-2 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium">{t.name}</div>
                      <div className="text-[11.5px] text-muted-foreground tabular-nums">
                        {brl(t.price)} · normal {brl(t.ref)} · <b className="text-green-600 dark:text-green-400">−{t.pct}%</b>
                      </div>
                    </div>
                    <button onClick={() => copy(adText(t))} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Copiar texto do anúncio" title="Copiar texto do anúncio">
                      <Copy className="size-3.5" />
                    </button>
                  </li>
                ))}
                {stats && !stats.top.length && <li className="px-4 py-3 text-[12px] text-muted-foreground">Nenhuma oferta boa nas últimas 6h.</li>}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Em alta agora (3h)" description="Perfumes que mais grupos estão postando: bom sinal de procura." />
            <CardContent className="px-0 pb-2">
              <ul className="divide-y border-t">
                {stats?.trending.map((t) => (
                  <li key={t.pid} className="flex items-center gap-2 px-4 py-2 text-[12.5px]">
                    <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                    <span className="text-muted-foreground tabular-nums">{t.groups} grupos · desde {brl(t.price)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Grupos na última hora" />
            <CardContent className="space-y-1.5">
              {stats?.byGroup.map((g) => {
                const max = stats.byGroup[0]?.n || 1;
                return (
                  <div key={g.g} className="text-[12px]">
                    <div className="flex justify-between gap-2">
                      <span className="truncate">{g.g}</span>
                      <span className="text-muted-foreground tabular-nums">{g.n}</span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-muted">
                      <div className="h-1.5 rounded-full bg-violet-500" style={{ width: `${(g.n / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
      {sheet && <PhotoSheet pid={sheet.pid} name={sheet.name} onClose={() => setSheet(null)} />}
    </>
  );
}
