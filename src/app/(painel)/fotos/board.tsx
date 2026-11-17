"use client";

import * as React from "react";
import { Ban, Check, Search } from "lucide-react";
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
  bank: Opt[];
  pins: Opt[];
  fragram: Opt[];
};
type Resp = { rows: Row[]; total: number; more: boolean; counts: { all: number; wait: number; none: number; fragram: number; pin: number } };
type Kind = "bank" | "pin" | "fragram";

const src = (k: Kind, o: Opt, big = false) =>
  k === "bank" ? `/api/fotos/${o.id}?w=${big ? 900 : 300}` : k === "pin" ? `/api/pinterest/${o.id}?w=${big ? 900 : 300}` : big ? o.url! : o.thumb || o.url!;

/**
 * Tela única: todos os perfumes, um por linha, com a foto que vai no post à esquerda
 * e todas as opções ao lado. Clicou numa opção, ela vira a principal na hora.
 */
export function PhotoBoard({ onOpen, Drop }: { onOpen: (id: number) => void; Drop: React.ComponentType<{ productId: number; onAdded: () => void }> }) {
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

  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

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
      await refreshRow(row.id);
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
    ["pin", `Com opções do Pinterest${c ? ` (${c.pin})` : ""}`],
    ["all", `Todos${c ? ` (${c.all})` : ""}`],
  ];

  function strip(row: Row, k: Kind, opts: Opt[], label: string) {
    if (!opts.length) return null;
    return (
      <div className="flex shrink-0 gap-1.5">
        <div className="flex w-5 items-center justify-center">
          <span className="rotate-180 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase [writing-mode:vertical-rl]">{label}</span>
        </div>
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
      </div>
    );
  }

  return (
    <>
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
        Cada linha é um perfume. A foto da esquerda é a que vai no post. Passe o mouse numa opção para ver grande e clique para trocar. A rolagem lateral mostra todas as fotos.
      </div>
      {!data ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : !data.rows.length ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted-foreground">Nenhum perfume nesse filtro.</Card>
      ) : (
        <div className="space-y-3">
          {data.rows.map((row) => (
            <Card key={row.id} className={cn("flex gap-4 p-3", row.blocked && "opacity-50", row.waiting && "ring-2 ring-warning")}>
              <div className="w-36 shrink-0">
                <div className="relative aspect-square overflow-hidden rounded-lg border bg-white">
                  {row.current ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/fotos/${row.current}?w=400`} alt="" className="size-full object-contain" />
                  ) : (
                    <div className="flex size-full items-center justify-center p-2 text-center text-[11px] text-muted-foreground">sem foto ainda</div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-[10px] text-white">
                    {row.main ? "★ escolhida por você" : "automática"}
                  </div>
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-start gap-2">
                  <button onClick={() => onOpen(row.id)} className="min-w-0 flex-1 text-left text-[14px] leading-snug font-semibold hover:underline">
                    {row.name}
                  </button>
                  {row.fragUrl ? (
                    <a href={row.fragUrl} target="_blank" rel="noreferrer" className="shrink-0 text-[11.5px] text-muted-foreground hover:underline">
                      Fragrantica
                    </a>
                  ) : null}
                  {row.fragUrl ? (
                    <button onClick={() => setEditing(editing === row.id ? null : row.id)} className="shrink-0 text-[11.5px] text-muted-foreground underline">
                      perfume errado? trocar link
                    </button>
                  ) : null}
                  <Button size="sm" variant="outline" className="h-7 shrink-0 text-[11.5px]" onClick={() => toggleBlock(row)}>
                    <Ban className="size-3.5" /> {row.blocked ? "Liberar" : "Não postar"}
                  </Button>
                </div>
                {row.waiting ? (
                  <div className="mb-2 rounded-md bg-warning/10 px-2 py-1 text-[12px] text-warning">
                    Post pronto esperando foto. Clique numa opção (ou arraste uma foto do Google abaixo) e ele sai na hora. Sem escolha em 3h, ele é descartado.
                  </div>
                ) : null}
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {strip(row, "fragram", row.fragram, "Fragrantica")}
                  {strip(row, "pin", row.pins, "Pinterest")}
                  {strip(row, "bank", row.bank, "Banco")}
                </div>
                {row.waiting && !row.fragram.length && !row.pins.length && !row.bank.length ? (
                  <div className="max-w-md">
                    <Drop productId={row.id} onAdded={() => refreshRow(row.id)} />
                  </div>
                ) : null}
                {!row.fragram.length || editing === row.id ? (
                  <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground">
                    <span>
                      {editing === row.id
                        ? "Cole o link da página certa do Fragrantica: o nome e as fotos são trocados."
                        : row.fragUrl ? "Sem fotos no Fragram Photos do Fragrantica." : "Ainda não achado no Fragrantica."}
                    </span>
                    <form
                      className="flex gap-1"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const inp = (e.currentTarget.elements.namedItem("u") as HTMLInputElement);
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
                      <Input name="u" placeholder="Colar link do Fragrantica" className="h-7 w-64 text-[11.5px]" />
                      <Button type="submit" size="sm" variant="outline" className="h-7 text-[11.5px]">Trazer fotos</Button>
                    </form>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
          <div ref={sentinel} className="py-4 text-center text-[12px] text-muted-foreground">
            {data.more ? (loadingMore ? "Carregando mais…" : "") : `${data.total} perfume(s)`}
          </div>
        </div>
      )}
      {preview ? (
        <div className="pointer-events-none fixed right-6 bottom-6 z-50 hidden overflow-hidden rounded-xl border bg-white shadow-2xl lg:block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" referrerPolicy="no-referrer" className="max-h-[70vh] max-w-[420px] object-contain" />
        </div>
      ) : null}
    </>
  );
}
