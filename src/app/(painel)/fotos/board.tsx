"use client";

import * as React from "react";
import { AlertCircle, Ban, Check, CheckCircle2, Clock, ExternalLink, Link2, Loader2, PauseCircle, Search, SearchX, Star } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

type Opt = { id: number; url?: string; thumb?: string | null; message_id?: string | null };
type Row = {
  id: number;
  name: string;
  main: number | null;
  blocked: number;
  fragUrl: string | null;
  current: number | null;
  waiting: string | null;
  expires: string | null;
  frag: { state: "ready" | "busy" | "queued" | "found" | "nophotos" | "notfound" | "skip" | "paused" | "idle"; text: string; call?: string | null };
  bank: Opt[];
  pins: Opt[];
  fragram: Opt[];
};
type Resp = { rows: Row[]; total: number; more: boolean; apifyOff?: string | null; counts: { all: number; wait: number; none: number; fragram: number; pin: number } };
type Kind = "bank" | "pin" | "fragram";

// prévia já no formato do post (quadrada 1:1), igual sai no grupo
const src = (k: Kind, o: Opt, big = false) =>
  k === "bank" ? `/api/fotos/square?img=${o.id}&w=${big ? 640 : 240}` : k === "pin" ? `/api/pinterest/${o.id}?w=${big ? 900 : 300}` : `/api/fotos/square?frag=${o.id}&w=${big ? 640 : 240}`;

/**
 * Tela única: todos os perfumes, um por linha, com a foto que vai no post à esquerda
 * e todas as opções ao lado. Clicou numa opção, ela vira a principal na hora.
 */
const FRAG_LOOK: Record<Row["frag"]["state"], { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  ready: { cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", Icon: CheckCircle2 },
  busy: { cls: "bg-violet-500/10 text-violet-700 dark:text-violet-300", Icon: Loader2 },
  queued: { cls: "bg-sky-500/10 text-sky-700 dark:text-sky-300", Icon: Clock },
  found: { cls: "bg-gray-500/10 text-muted-foreground", Icon: CheckCircle2 },
  nophotos: { cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300", Icon: AlertCircle },
  notfound: { cls: "bg-rose-500/10 text-rose-700 dark:text-rose-300", Icon: SearchX },
  skip: { cls: "bg-gray-500/10 text-muted-foreground", Icon: SearchX },
  paused: { cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300", Icon: PauseCircle },
  idle: { cls: "bg-gray-500/10 text-muted-foreground", Icon: Clock },
};

function left(iso: string | null) {
  if (!iso) return "";
  const m = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

export function PhotoBoard({ onOpen, Drop }: { onOpen: (id: number) => void; Drop: React.ComponentType<{ productId: number; onAdded: () => void; compact?: boolean }> }) {
  const [q, setQ] = React.useState("");
  const [deb, setDeb] = React.useState("");
  const [f, setFState] = React.useState<"wait" | "all" | "none" | "fragram" | "pin">("wait");
  const picked = React.useRef(false);
  const setF = (v: typeof f) => {
    picked.current = true;
    setFState(v);
  };
  const [data, setData] = React.useState<Resp | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<number | null>(null);
  const sentinel = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDeb(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const url = (offset: number) => `/api/fotos/board?f=${f}&q=${encodeURIComponent(deb)}&offset=${offset}`;

  React.useEffect(() => {
    let alive = true;
    setData(null);
    api<Resp>(url(0))
      .then((r) => {
        if (!alive) return;
        // nada esperando foto: abre direto nos que têm fotos do Fragrantica
        if (!picked.current && f === "wait" && !r.counts.wait) return setFState("fragram");
        setData(r);
      }).catch((e) => toast.error((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, deb]);

  const loadMore = React.useCallback(async () => {
    if (!data?.more || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api<Resp>(url(data.rows.length));
      setData((d) => (d ? { ...r, rows: [...d.rows, ...r.rows.filter((x) => !d.rows.some((y) => y.id === x.id))] } : r));
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loadingMore]);

  // chegou ou saiu post esperando foto (aviso global a cada 8s): atualiza a lista sem recarregar a página
  const waitKey = React.useRef("");
  React.useEffect(() => {
    const on = (e: Event) => {
      const rows = (e as CustomEvent<{ post: number }[]>).detail;
      const key = rows.map((r) => `${r.post}:${(r as { photos?: number }).photos || 0}:${(r as { searched?: number }).searched || 0}`).join(",");
      if (waitKey.current && key !== waitKey.current) {
        api<Resp>(url(0))
          .then((r) => {
            if (!picked.current && f === "fragram" && r.counts.wait) return setFState("wait");
            setData((d) => (d && f !== "wait" ? { ...r, rows: [...r.rows, ...d.rows.filter((x) => !r.rows.some((y) => y.id === x.id))] } : r));
          })
          .catch(() => undefined);
      }
      waitKey.current = key;
    };
    window.addEventListener("waiting-photos", on);
    return () => window.removeEventListener("waiting-photos", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, deb]);

  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  // perfume sendo procurado agora: atualiza o card sozinho até as fotos chegarem
  const pending = (data?.rows || []).filter((r) => r.frag.state === "busy" || r.frag.state === "queued").map((r) => r.id).join(",");
  React.useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => pending.split(",").forEach((id) => void refreshRow(Number(id)).catch(() => undefined)), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  async function refreshRow(id: number) {
    const r = await api<Resp>(`/api/fotos/board?id=${id}`);
    const nr = r.rows[0];
    if (nr && f === "wait" && !nr.waiting) setData((d) => (d ? { ...d, rows: d.rows.filter((x) => x.id !== id), counts: { ...d.counts, wait: d.counts.wait - 1 } } : d));
    else if (nr) setData((d) => (d ? { ...d, rows: d.rows.map((x) => (x.id === id ? nr : x)) } : d));
  }

  async function choose(row: Row, k: Kind, o: Opt) {
    const key = `${k}:${o.id}`;
    setBusy(key);
    try {
      if (k === "bank") await api("/api/fotos", { method: "PATCH", json: { productId: row.id, mainImageId: o.id } });
      else if (k === "pin") await api("/api/pinterest", { method: "POST", json: { id: o.id, main: true } });
      else await api("/api/fotos/upload", { method: "POST", json: { productId: row.id, url: o.url } });
      toast.success(row.waiting ? `Foto escolhida: o post de ${row.name} está saindo agora` : `Foto principal de ${row.name} trocada`);
      setPreview(null);
      // post resolvido: sai da lista de esperando na hora, sem precisar atualizar a página
      if (row.waiting && f === "wait")
        setData((d) => (d ? { ...d, rows: d.rows.filter((x) => x.id !== row.id), counts: { ...d.counts, wait: Math.max(0, d.counts.wait - 1) } } : d));
      else await refreshRow(row.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleBlock(row: Row) {
    await api("/api/fotos", { method: "PATCH", json: { productId: row.id, blocked: !row.blocked } });
    toast.success(row.blocked ? "Liberado para postar" : "Não vai mais ser postado");
    refreshRow(row.id);
  }

  const c = data?.counts;
  const filters: [typeof f, string][] = [
    ["wait", `⏳ Posts esperando foto${c ? ` (${c.wait})` : ""}`],
    ["fragram", `Com fotos do Fragrantica${c ? ` (${c.fragram})` : ""}`],
    ["none", `Sem foto escolhida${c ? ` (${c.none})` : ""}`],
    ["all", `Todos${c ? ` (${c.all})` : ""}`],
  ];

  function tiles(row: Row, k: Kind, opts: Opt[]) {
    if (!opts.length) return null;
    return (
      <>
        {opts.map((o) => {
          const key = `${k}:${o.id}`;
          const isCur = k === "bank" && row.current === o.id;
          return (
            <button
              key={key}
              title="Clique para usar como foto do post"
              disabled={!!busy}
              onClick={() => choose(row, k, o)}
              onMouseEnter={() => setPreview(src(k, o, true))}
              onMouseLeave={() => setPreview(null)}
              className={cn(
                "relative size-24 shrink-0 overflow-hidden rounded-lg border bg-white transition hover:scale-[1.04] hover:ring-2 hover:ring-accent",
                isCur && "ring-2 ring-accent",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(k, o)} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
              {busy === key ? <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[11px] text-white">baixando…</div> : null}
              {isCur ? (
                <div className="absolute top-1 right-1 rounded-full bg-accent p-0.5 text-accent-foreground">
                  <Check className="size-3" />
                </div>
              ) : null}
            </button>
          );
        })}
      </>
    );
  }

  return (
    <>
      {data?.apifyOff && (
        <div className="mb-3 rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠️ {data.apifyOff}. Fotos novas do Fragrantica não chegam até o saldo voltar; as que já estão aqui continuam valendo.
        </div>
      )}
      <div className="sticky top-0 z-10 -mx-1 mb-4 flex flex-wrap items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar perfume..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        {filters.map(([k, label]) => (
          <Button key={k} size="sm" variant={f === k ? "accent" : "outline"} onClick={() => setF(k)}>
            {label}
          </Button>
        ))}
      </div>
      <div className="mb-3 text-[12.5px] text-muted-foreground">
        Só sai post com foto escolhida por você. Sem foto, o post espera aqui enquanto eu procuro no Fragrantica; passe o mouse para ver grande e clique para escolher.
      </div>
      {!data ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : !data.rows.length ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted-foreground">Nenhum perfume nesse filtro.</Card>
      ) : (
        <div className="space-y-3">
          {data.rows.map((row) => {
            const look = FRAG_LOOK[row.frag.state];
            const busyFrag = row.frag.state === "busy" || row.frag.state === "queued";
            const noOptions = !row.fragram.length && !row.bank.length;
            return (
              <Card key={row.id} className={cn("overflow-hidden p-0", row.blocked && "opacity-50", row.waiting && "ring-2 ring-amber-400/70")}>
                {/* topo: nome, situação no Fragrantica e ações */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border-soft)] px-4 py-3">
                  <button onClick={() => onOpen(row.id)} className="min-w-0 flex-1 text-left text-[15px] leading-snug font-semibold hover:underline">
                    {row.name}
                  </button>
                  {row.waiting ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11.5px] font-semibold text-amber-700 dark:text-amber-300">
                      <Clock className="size-3.5" /> Post esperando · descarta em {left(row.expires)}
                    </span>
                  ) : null}
                  <Button size="sm" variant="outline" className="h-7 shrink-0 text-[11.5px]" onClick={() => toggleBlock(row)}>
                    <Ban className="size-3.5" /> {row.blocked ? "Liberar" : "Não postar"}
                  </Button>
                </div>
                <div className="flex flex-col gap-4 p-4 sm:flex-row">
                  {/* foto que vai no post */}
                  <div className="w-full shrink-0 sm:w-40">
                    <div className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-gray-400 uppercase">Vai no post</div>
                    <div className={cn("relative aspect-square overflow-hidden rounded-lg border bg-white", !row.current && "border-dashed bg-muted/40")}>
                      {row.current ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/fotos/square?img=${row.current}&w=400`} alt="" className="size-full object-cover" />
                      ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-1 p-3 text-center text-[11.5px] text-muted-foreground">
                          <Star className="size-5 opacity-40" />
                          Nenhuma foto escolhida
                        </div>
                      )}
                      {row.current ? (
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-violet-600/90 py-0.5 text-[10.5px] font-medium text-white">
                          <Star className="size-3" /> escolhida por você
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    {/* situação no Fragrantica */}
                    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-[12.5px]", look.cls)}>
                      <look.Icon className={cn("size-4 shrink-0", row.frag.state === "busy" && "animate-spin")} />
                      <span className="font-semibold">Fragrantica:</span>
                      <span>{row.frag.text}</span>
                      {row.frag.call ? <span className="text-[11px] opacity-70">{row.frag.call}</span> : null}
                      <span className="ml-auto flex items-center gap-3 text-[11.5px]">
                        {row.fragUrl ? (
                          <a href={row.fragUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                            Ver página <ExternalLink className="size-3" />
                          </a>
                        ) : null}
                        {row.fragUrl && editing !== row.id ? (
                          <button onClick={() => setEditing(row.id)} className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                            <Link2 className="size-3" /> Perfume errado?
                          </button>
                        ) : null}
                      </span>
                    </div>

                    {/* opções de foto */}
                    {row.fragram.length ? (
                      <div>
                        <div className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-gray-400 uppercase">Fotos do Fragrantica · já no formato do post (1:1) · clique para usar</div>
                        <div className="flex gap-2 overflow-x-auto pb-1">{tiles(row, "fragram", row.fragram)}</div>
                      </div>
                    ) : busyFrag ? (
                      <div>
                        <div className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-gray-400 uppercase">Fotos do Fragrantica</div>
                        <div className="flex gap-2">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <div key={i} className="size-24 shrink-0 animate-pulse rounded-lg bg-muted" />
                          ))}
                        </div>
                        <div className="mt-1.5 text-[11.5px] text-muted-foreground">As fotos aparecem aqui sozinhas e você recebe um aviso.</div>
                      </div>
                    ) : null}
                    {row.bank.length ? (
                      <div>
                        <div className="mb-1.5 text-[10.5px] font-semibold tracking-wide text-gray-400 uppercase">Fotos dos grupos · clique para usar</div>
                        <div className="flex gap-2 overflow-x-auto pb-1">{tiles(row, "bank", row.bank)}</div>
                      </div>
                    ) : null}

                    {/* plano B: link certo do Fragrantica ou foto do Google */}
                    {(!row.fragram.length && !busyFrag) || editing === row.id ? (
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="rounded-lg border border-[var(--border-soft)] p-3">
                          <div className="mb-1 text-[12.5px] font-semibold">{editing === row.id ? "Trocar a página do Fragrantica" : "Sabe a página no Fragrantica?"}</div>
                          <div className="mb-2 text-[11.5px] text-muted-foreground">Cole o link e eu trago as fotos de lá.</div>
                          <form
                            className="flex gap-1.5"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const inp = e.currentTarget.elements.namedItem("u") as HTMLInputElement;
                              try {
                                const r = await api<{ msg: string }>("/api/fotos/fraglink", { method: "POST", json: { productId: row.id, url: inp.value } });
                                toast.success(r.msg);
                                setEditing(null);
                                refreshRow(row.id);
                              } catch (err) {
                                toast.error((err as Error).message);
                              }
                            }}
                          >
                            <Input name="u" placeholder="https://www.fragrantica.com.br/perfume/…" className="h-8 min-w-0 flex-1 text-[12px]" />
                            <Button type="submit" size="sm" variant="accent" className="h-8 text-[12px]">Trazer fotos</Button>
                            {editing === row.id ? (
                              <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => setEditing(null)}>Cancelar</Button>
                            ) : null}
                          </form>
                        </div>
                        {editing !== row.id && (row.waiting || noOptions) ? <Drop productId={row.id} onAdded={() => refreshRow(row.id)} compact /> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
          <div ref={sentinel} className="py-4 text-center text-[12px] text-muted-foreground">
            {data.more ? (loadingMore ? "Carregando mais…" : "") : `${data.total} perfume(s)`}
          </div>
        </div>
      )}
      {preview ? (
        <div className="pointer-events-none fixed right-6 bottom-6 z-50 hidden overflow-hidden rounded-xl border bg-white shadow-2xl lg:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" referrerPolicy="no-referrer" className="size-[420px] object-cover" />
          <div className="bg-black/70 py-1 text-center text-[11px] text-white">Assim sai no grupo (1:1)</div>
        </div>
      ) : null}
    </>
  );
}
