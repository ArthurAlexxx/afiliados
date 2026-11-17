"use client";

/**
 * Fotos dos perfumes: galeria com todos os perfumes. Clicou num card, abre o perfume com a foto
 * grande (como sai no post, 1:1) e um carrossel embaixo com todas as opções (Fragrantica e grupos).
 */
import * as React from "react";
import { Ban, Check, ChevronLeft, ChevronRight, Crop as CropIcon, EyeOff, ExternalLink, ImageOff, Loader2, Search, Star, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CropSquare, type Crop } from "@/components/crop-square";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { DropPhoto } from "./drop";

type Opt = { id: number; url?: string; thumb?: string | null; crop?: string | null; width?: number; height?: number };
type Row = {
  id: number;
  name: string;
  main: number | null;
  blocked: number;
  fragUrl: string | null;
  current: number | null;
  currentCrop: string | null;
  waiting: string | null;
  frag: { state: string; text: string; call?: string | null };
  ml: { url: string; title: string; group_name: string } | null;
  bank: Opt[];
  fragram: Opt[];
};
type Resp = { rows: Row[]; total: number; more: boolean; counts: { all: number; wait: number; none: number; fragram: number } };
type Kind = "bank" | "fragram";
type Item = { k: Kind; o: Opt };

const sq = (it: Item, w: number) =>
  it.k === "bank" ? `/api/fotos/square?img=${it.o.id}&w=${w}&c=${encodeURIComponent(it.o.crop || "")}` : `/api/fotos/square?frag=${it.o.id}&w=${w}`;
const orig = (it: Item) => (it.k === "bank" ? `/api/fotos/${it.o.id}?w=1200` : it.o.url!);
const parse = (c?: string | null): Crop | null => {
  try {
    return c ? (JSON.parse(c) as Crop) : null;
  } catch {
    return null;
  }
};
const itemsOf = (r: Row): Item[] => {
  const bank = r.bank.map((o) => ({ k: "bank" as const, o }));
  const cur = bank.findIndex((b) => b.o.id === r.current);
  // a escolhida primeiro, depois Fragrantica, depois as dos grupos
  const first = cur >= 0 ? bank.splice(cur, 1) : [];
  return [...first, ...r.fragram.map((o) => ({ k: "fragram" as const, o })), ...bank];
};

/* ---------------- card da galeria ---------------- */

function PerfumeCard({ r, onOpen }: { r: Row; onOpen: () => void }) {
  const items = itemsOf(r);
  const cover = r.current ? `/api/fotos/square?img=${r.current}&w=360&c=${encodeURIComponent(r.currentCrop || "")}` : items[0] ? sq(items[0], 360) : null;
  return (
    <button
      onClick={onOpen}
      className={cn(
        "group overflow-hidden rounded-xl border border-[var(--border-soft)] bg-card text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-md",
        r.blocked && "opacity-50",
      )}
    >
      <div className="relative aspect-square bg-muted">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" loading="lazy" className={cn("size-full object-cover", !r.current && "opacity-80 saturate-50")} />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-8 opacity-40" />
          </div>
        )}
        <span
          className={cn(
            "absolute top-2 left-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            r.current ? "bg-violet-600 text-white" : "bg-black/60 text-white",
          )}
        >
          {r.current ? <Star className="size-3" /> : null}
          {r.current ? "Escolhida" : "Sem foto escolhida"}
        </span>
        {r.waiting ? <span className="absolute top-2 right-2 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-gray-900">Post esperando</span> : null}
        {r.blocked ? <span className="absolute right-2 bottom-2 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-semibold text-white">Não postar</span> : null}
      </div>
      <div className="p-3">
        <div className="line-clamp-2 min-h-[2.6em] text-[13.5px] leading-snug font-semibold">{r.name}</div>
        <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <span>{items.length} foto(s)</span>
          {r.fragram.length ? <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">Fragrantica {r.fragram.length}</span> : null}
          {r.bank.length ? <span className="rounded bg-muted px-1.5 py-0.5">grupos {r.bank.length}</span> : null}
        </div>
      </div>
    </button>
  );
}

/* ---------------- modal do perfume ---------------- */

function PerfumeModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: (r: Row | null) => void }) {
  const [r, setR] = React.useState<Row | null>(null);
  const [i, setI] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [crop, setCrop] = React.useState<{ it: Item; initial: Crop | null; adjust?: boolean; dropped?: boolean } | null>(null);
  const strip = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    const d = await api<Resp>(`/api/fotos/board?id=${id}`);
    const row = d.rows[0] || null;
    setR(row);
    onChanged(row);
    return row;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  React.useEffect(() => {
    void load().then(() => setI(0));
  }, [load]);

  const items = r ? itemsOf(r) : [];
  const it = items[Math.min(i, Math.max(0, items.length - 1))];
  const isCur = !!it && it.k === "bank" && it.o.id === r?.current;

  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (crop) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(items.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  React.useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [i]);

  async function use(item: Item, c?: Crop) {
    if (!r) return;
    setBusy("use");
    try {
      if (item.k === "bank") await api("/api/fotos", { method: "PATCH", json: { productId: r.id, mainImageId: item.o.id, crop: c } });
      else await api("/api/fotos/upload", { method: "POST", json: { productId: r.id, url: item.o.url, crop: c } });
      toast.success(r.waiting ? "Foto escolhida: o post está saindo" : "Foto principal trocada");
      await load();
      setI(0);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function hide(item: Item) {
    if (!r) return;
    await api("/api/fotos", { method: "PATCH", json: { id: item.o.id, disabled: true } }).catch((e) => toast.error((e as Error).message));
    toast.success("Foto escondida");
    await load();
  }
  async function toggleBlock() {
    if (!r) return;
    await api("/api/fotos", { method: "PATCH", json: { productId: r.id, blocked: !r.blocked } });
    toast.success(r.blocked ? "Liberado para postar" : "Não vai ser postado (Posts › Rejeitados)");
    await load();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-card shadow-2xl">
        {/* topo */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-bold">{r?.name || "Carregando…"}</div>
            {r ? (
              <div className="truncate text-[12px] text-muted-foreground">
                Fragrantica: {r.frag.text}
                {r.ml?.title ? ` · anúncio: ${r.ml.title}` : ""}
              </div>
            ) : null}
          </div>
          {r?.ml ? (
            <a href={r.ml.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-yellow-300 px-3 text-[12px] font-semibold text-gray-900 hover:bg-yellow-400">
              Mercado Livre <ExternalLink className="size-3.5" />
            </a>
          ) : null}
          {r?.fragUrl ? (
            <a href={r.fragUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-soft)] px-3 text-[12px] font-medium hover:bg-muted">
              Fragrantica <ExternalLink className="size-3.5" />
            </a>
          ) : null}
          {r ? (
            <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={toggleBlock}>
              <Ban className="size-3.5" /> {r.blocked ? "Liberar" : "Não postar"}
            </Button>
          ) : null}
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Fechar">
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!r ? (
            <div className="flex h-80 items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : (
            <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1fr)_280px]">
              {/* foto grande */}
              <div>
                <div className="relative mx-auto aspect-square w-full max-w-[520px] overflow-hidden rounded-xl border bg-muted">
                  {it ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={sq(it, 720)} src={sq(it, 720)} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
                      <ImageOff className="size-10 opacity-40" />
                      <span className="text-[13px]">Nenhuma foto ainda</span>
                    </div>
                  )}
                  {it ? (
                    <>
                      <span className="absolute top-3 left-3 rounded-full bg-black/65 px-2.5 py-1 text-[11.5px] font-medium text-white">
                        {isCur ? "★ Vai no post" : it.k === "fragram" ? "Fragrantica" : "Foto dos grupos"} · prévia 1:1
                      </span>
                      <button
                        onClick={() => setI((x) => Math.max(0, x - 1))}
                        disabled={i === 0}
                        className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white disabled:opacity-0"
                        aria-label="Anterior"
                      >
                        <ChevronLeft className="size-5" />
                      </button>
                      <button
                        onClick={() => setI((x) => Math.min(items.length - 1, x + 1))}
                        disabled={i >= items.length - 1}
                        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white disabled:opacity-0"
                        aria-label="Próxima"
                      >
                        <ChevronRight className="size-5" />
                      </button>
                      <span className="absolute right-3 bottom-3 rounded-full bg-black/65 px-2 py-0.5 text-[11px] text-white tabular-nums">
                        {i + 1}/{items.length}
                      </span>
                    </>
                  ) : null}
                </div>
                {it ? (
                  <div className="mx-auto mt-3 flex max-w-[520px] flex-wrap gap-2">
                    {isCur ? (
                      <Button
                        size="sm"
                        variant="accent"
                        onClick={() => setCrop({ it, initial: parse(r.currentCrop), adjust: true })}
                      >
                        <CropIcon className="size-4" /> Ajustar enquadramento
                      </Button>
                    ) : (
                      <Button size="sm" variant="accent" loading={busy === "use"} onClick={() => setCrop({ it, initial: parse(it.o.crop) })}>
                        <Check className="size-4" /> Usar esta foto
                      </Button>
                    )}
                    {it.k === "bank" && !isCur ? (
                      <Button size="sm" variant="ghost" onClick={() => hide(it)}>
                        <EyeOff className="size-4" /> Esconder
                      </Button>
                    ) : null}
                    {it.k === "fragram" && it.o.url ? (
                      <a href={it.o.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center px-2 text-[12px] text-muted-foreground hover:underline">
                        Abrir original ↗
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* lateral: outras formas de achar a foto */}
              <div className="space-y-3">
                <DropPhoto
                  productId={r.id}
                  onAdded={() => void load()}
                  onUploaded={(imgId) => setCrop({ it: { k: "bank", o: { id: imgId } }, initial: null, dropped: true })}
                  compact
                  label="Arraste uma foto da internet"
                />
                <div className="rounded-lg border border-[var(--border-soft)] p-3">
                  <div className="text-[12.5px] font-semibold">{r.fragUrl ? "Perfume errado no Fragrantica?" : "Sabe a página no Fragrantica?"}</div>
                  <div className="mb-2 text-[11.5px] text-muted-foreground">Cole o link e eu trago as fotos de lá.</div>
                  <form
                    className="flex gap-1.5"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const inp = e.currentTarget.elements.namedItem("u") as HTMLInputElement;
                      setBusy("link");
                      try {
                        const x = await api<{ msg: string }>("/api/fotos/fraglink", { method: "POST", json: { productId: r.id, url: inp.value } });
                        toast.success(x.msg);
                        inp.value = "";
                        await load();
                      } catch (err) {
                        toast.error((err as Error).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    <Input name="u" placeholder="https://www.fragrantica.com.br/…" className="h-8 min-w-0 flex-1 text-[12px]" />
                    <Button type="submit" size="sm" className="h-8 text-[12px]" loading={busy === "link"}>
                      Trazer
                    </Button>
                  </form>
                </div>
                <div className="rounded-lg bg-muted/50 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
                  Setas do teclado passam as fotos. A foto escolhida vale para todos os próximos posts desse perfume, com o enquadramento que você salvar.
                </div>
              </div>
            </div>
          )}

          {/* carrossel */}
          {r && items.length ? (
            <div ref={strip} className="scroll-thin flex gap-2 overflow-x-auto border-t border-[var(--border-soft)] bg-muted/30 px-4 py-3">
              {items.map((x, n) => {
                const cur = x.k === "bank" && x.o.id === r.current;
                return (
                  <button
                    key={`${x.k}:${x.o.id}`}
                    data-i={n}
                    onClick={() => setI(n)}
                    className={cn(
                      "relative size-20 shrink-0 overflow-hidden rounded-lg border-2 bg-card transition",
                      n === i ? "border-violet-500" : "border-transparent opacity-80 hover:opacity-100",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sq(x, 160)} alt="" loading="lazy" className="size-full object-cover" />
                    {cur ? (
                      <span className="absolute top-1 left-1 rounded-full bg-violet-600 p-0.5 text-white">
                        <Star className="size-3" />
                      </span>
                    ) : null}
                    <span className="absolute inset-x-0 bottom-0 bg-black/55 py-px text-center text-[9.5px] text-white">{x.k === "fragram" ? "Fragrantica" : "grupos"}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      {crop ? (
        <CropSquare
          src={orig(crop.it)}
          title={r?.name}
          initial={crop.initial}
          confirmLabel={crop.adjust ? "Salvar enquadramento" : r?.waiting ? "Usar e postar" : "Usar esta foto"}
          onCancel={() => {
            const x = crop;
            setCrop(null);
            if (x.dropped) void use(x.it);
          }}
          onConfirm={async (c) => {
            const x = crop;
            setCrop(null);
            await use(x.it, c);
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------------- página ---------------- */

const FILTERS = [
  { k: "all", l: "Todos" },
  { k: "none", l: "Sem foto escolhida" },
  { k: "fragram", l: "Com fotos do Fragrantica" },
  { k: "wait", l: "Post esperando" },
] as const;

export default function FotosPage() {
  const [q, setQ] = React.useState("");
  const [deb, setDeb] = React.useState("");
  const [f, setF] = React.useState<(typeof FILTERS)[number]["k"]>("all");
  const [data, setData] = React.useState<Resp | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [open, setOpen] = React.useState<number | null>(null);
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
      .then((r) => alive && setData(r))
      .catch((e) => toast.error((e as Error).message));
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
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const c = data?.counts;
  return (
    <>
      <PageHeader title="Fotos dos perfumes" description="Todos os perfumes com as fotos de cada um. Clique num perfume para escolher a foto que vai nos posts dele." />
      <Card className="sticky top-16 z-10 mb-4 flex flex-wrap items-center gap-2 p-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar perfume..." value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-9" />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((x) => {
            const n = c ? (x.k === "all" ? c.all : x.k === "none" ? c.none : x.k === "fragram" ? c.fragram : c.wait) : null;
            return (
              <button
                key={x.k}
                onClick={() => setF(x.k)}
                className={cn(
                  "h-9 rounded-lg px-3 text-[12.5px] font-medium whitespace-nowrap",
                  f === x.k ? "bg-violet-500 text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {x.l}
                {n != null ? <span className={cn("ml-1.5 text-[11px] tabular-nums", f === x.k ? "text-white/80" : "")}>{n}</span> : null}
              </button>
            );
          })}
        </div>
      </Card>

      {!data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, n) => (
            <div key={n} className="aspect-[4/5] animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : !data.rows.length ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted-foreground">Nenhum perfume nesse filtro.</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {data.rows.map((r) => (
              <PerfumeCard key={r.id} r={r} onOpen={() => setOpen(r.id)} />
            ))}
          </div>
          <div ref={sentinel} className="py-6 text-center text-[12px] text-muted-foreground">
            {data.more ? (loadingMore ? "Carregando mais…" : "") : `${data.total} perfume(s)`}
          </div>
        </>
      )}

      {open ? (
        <PerfumeModal
          id={open}
          onClose={() => setOpen(null)}
          onChanged={(row) => row && setData((d) => (d ? { ...d, rows: d.rows.map((x) => (x.id === row.id ? row : x)) } : d))}
        />
      ) : null}
    </>
  );
}
