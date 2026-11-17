"use client";

import * as React from "react";
import { toast } from "sonner";
import { Ban, ChevronDown, Clock, Crop as CropIcon, Hand, Pause, Play, RotateCcw, Search, Send, Trash2, X, Pencil, Check } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { WaPreview } from "@/components/wa-preview";
import { CropSquare, type Crop } from "@/components/crop-square";
import { api, useApi, timeAgo, clockOf } from "@/lib/client";
import { cn } from "@/lib/utils";
import { PhotoBoard } from "../fotos/board";
import { DropPhoto } from "../fotos/drop";

type QPost = {
  id: number;
  product_id: number | null;
  name: string | null;
  source_name: string;
  formatted_text: string;
  has_media: number;
  mv: string;
  status: string;
  reason: string | null;
  created_at: string;
  sent_at: string | null;
  main: number | null;
  price: number | null;
  discount: number | null;
  link: string | null;
  eta?: string;
};
type QueueResp = {
  queued: QPost[];
  waiting: QPost[];
  sent: QPost[];
  intervalSeconds: number;
  lastSentAt: string | null;
  inWindow: boolean;
  window: string | null;
  counts: Record<string, number>;
};
type Post = {
  id: number;
  source_name: string;
  original_text: string;
  formatted_text: string;
  has_media: number;
  status: string;
  reason: string | null;
  created_at: string;
  sent_at: string | null;
};

const TABS = [
  { key: "fila", label: "Fila" },
  { key: "sent", label: "Enviados" },
  { key: "skipped,duplicate", label: "Descartados" },
  { key: "failed", label: "Falhas" },
  { key: "all", label: "Todos" },
];

const brl = (n: number | null) => (n == null ? "" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
/** 1ª linha útil do texto do post, sem a formatação do WhatsApp */
const titleOf = (t: string) =>
  (t.split("\n").map((l) => l.replace(/[*_~]/g, "").trim()).find((l) => l.length > 6 && !/^https?:/.test(l)) || "Post").slice(0, 120);
const until = (iso?: string) => {
  if (!iso) return "";
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (s <= 5) return "agora";
  if (s < 60) return `em ${s}s`;
  return `em ${Math.round(s / 60)} min`;
};

async function act(id: number, action: string, extra: Record<string, unknown> = {}) {
  return api<{ ok: boolean; msg?: string }>(`/api/posts/${id}`, { method: "PATCH", json: { action, ...extra } });
}

/* ---------- Fila ---------- */

function QueueItem({ p, first, onChanged, onCrop }: { p: QPost; first: boolean; onChanged: () => void; onCrop: (p: QPost) => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async (a: string, msg: string) => {
    setBusy(a);
    try {
      await act(p.id, a);
      toast.success(msg);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const sending = p.status === "sending";
  return (
    <Card className={cn("overflow-hidden p-0", first && "ring-2 ring-violet-500/60")}>
      <div className="flex gap-4 p-3">
        <div className="relative size-24 shrink-0 overflow-hidden rounded-lg border bg-muted sm:size-28">
          {p.has_media ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${p.id}?v=${encodeURIComponent(p.mv)}`} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-[11px] text-muted-foreground">sem foto</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                sending ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-violet-500/10 text-violet-700 dark:text-violet-300",
              )}
            >
              {sending ? <Send className="size-3" /> : <Clock className="size-3" />}
              {sending ? "Enviando agora" : `Sai ${until(p.eta)} · ${p.eta ? new Date(p.eta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}`}
            </span>
            <span className="text-[11.5px] text-muted-foreground">#{p.id} · {p.source_name}</span>
          </div>
          <div className="mt-1 truncate text-[14.5px] font-semibold">{p.name || titleOf(p.formatted_text)}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12.5px] text-muted-foreground">
            {p.price ? <span className="font-semibold text-foreground">{brl(p.price)}</span> : null}
            {p.discount ? <span className="text-emerald-600 dark:text-emerald-400">{p.discount}% abaixo do normal</span> : null}
            {p.reason ? <span>{p.reason}</span> : null}
          </div>
          {!sending ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.main ? (
                <Button size="sm" variant="outline" className="h-7 text-[12px]" onClick={() => onCrop(p)}>
                  <CropIcon className="size-3.5" /> Ajustar foto
                </Button>
              ) : null}
              <Button size="sm" variant="outline" className="h-7 text-[12px]" loading={busy === "hold"} onClick={() => run("hold", "Segurado: está em Esperando foto")}>
                <Hand className="size-3.5" /> Segurar
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[12px]" loading={busy === "send"} onClick={() => run("send", "Enviado")}>
                <Send className="size-3.5" /> Enviar agora
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[12px]" loading={busy === "discard"} onClick={() => run("discard", "Descartado")}>
                <Ban className="size-3.5" /> Descartar
              </Button>
              <button onClick={() => setOpen((v) => !v)} className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
                <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} /> Ver mensagem
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="border-t border-[var(--border-soft)] p-3">
          <WaPreview text={p.formatted_text} image={p.has_media ? `/api/media/${p.id}?v=${encodeURIComponent(p.mv)}` : null} className="max-w-md" />
        </div>
      ) : null}
    </Card>
  );
}

function Section({ title, hint, count, children, right }: { title: string; hint?: string; count?: number; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[16px] font-bold">
            {title}
            {count != null ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground tabular-nums">{count}</span> : null}
          </h2>
          {hint ? <p className="text-[12.5px] text-muted-foreground">{hint}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function QueueTab() {
  const { data, reload } = useApi<QueueResp>("/api/posts/queue", 5000);
  const [, tick] = React.useState(0);
  const [waitN, setWaitN] = React.useState<number | null>(null);
  const [crop, setCrop] = React.useState<{ p: QPost; initial: Crop | null } | null>(null);
  React.useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function openCrop(p: QPost) {
    if (!p.main || !p.product_id) return;
    const b = await api<{ rows: { currentCrop: string | null }[] }>(`/api/fotos/board?id=${p.product_id}`).catch(() => null);
    let initial: Crop | null = null;
    try {
      initial = b?.rows[0]?.currentCrop ? (JSON.parse(b.rows[0].currentCrop) as Crop) : null;
    } catch {}
    setCrop({ p, initial });
  }

  return (
    <>
      <Section
        title="Saindo agora"
        hint={
          data
            ? `Um post a cada ${Math.round(data.intervalSeconds / 60) || 1} min${data.window ? ` · horário ${data.window}` : ""}. Os que já têm foto escolhida saem sozinhos; ajuste ou segure antes da hora se quiser.`
            : undefined
        }
        count={data?.queued.length}
        right={
          data ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
                data.inWindow ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
              )}
            >
              {data.inWindow ? <Play className="size-3" /> : <Pause className="size-3" />}
              {data.inWindow ? "Postando" : "Fora do horário"}
            </span>
          ) : null
        }
      >
        {!data ? (
          <div className="h-32 animate-pulse rounded-xl bg-muted" />
        ) : data.queued.length ? (
          <div className="space-y-2">
            {data.queued.map((p, i) => (
              <QueueItem key={`${p.id}-${p.mv}`} p={p} first={i === 0} onChanged={reload} onCrop={openCrop} />
            ))}
          </div>
        ) : (
          <Card className="px-5 py-6 text-center text-[13px] text-muted-foreground">
            Nada na fila agora. Quando a curadoria escolher uma oferta com foto pronta, ela aparece aqui antes de sair.
          </Card>
        )}
      </Section>

      <Section
        title="Esperando foto"
        hint="Sem foto escolhida o post não sai. As fotos do Fragrantica chegam sozinhas: clique numa, enquadre no quadrado 1:1 e ele entra na fila."
        count={waitN ?? data?.waiting.length}
      >
        <PhotoBoard embedded onCount={setWaitN} onOpen={() => (window.location.href = "/fotos")} Drop={DropPhoto} />
      </Section>

      <Section title="Últimos enviados" count={undefined}>
        {data?.sent.length ? (
          <Card className="divide-y divide-[var(--border-soft)] p-0">
            {data.sent.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2">
                <div className="size-10 shrink-0 overflow-hidden rounded-md border bg-muted">
                  {p.has_media ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/media/${p.id}?v=${encodeURIComponent(p.mv)}`} alt="" loading="lazy" className="size-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{p.name || titleOf(p.formatted_text)}</div>
                  <div className="text-[11.5px] text-muted-foreground">{p.source_name}</div>
                </div>
                {p.price ? <span className="text-[12.5px] font-semibold tabular-nums">{brl(p.price)}</span> : null}
                <span className="w-16 text-right text-[11.5px] whitespace-nowrap text-muted-foreground">{clockOf(p.sent_at)}</span>
              </div>
            ))}
          </Card>
        ) : (
          <Card className="px-5 py-6 text-center text-[13px] text-muted-foreground">Nenhum envio ainda.</Card>
        )}
      </Section>

      {crop ? (
        <CropSquare
          src={`/api/fotos/${crop.p.main}?w=1200`}
          title={crop.p.name || undefined}
          initial={crop.initial}
          confirmLabel="Salvar e refazer o post"
          onCancel={() => setCrop(null)}
          onConfirm={async (c) => {
            const x = crop;
            setCrop(null);
            try {
              await api("/api/fotos", { method: "PATCH", json: { productId: x.p.product_id, mainImageId: x.p.main, crop: c } });
              toast.success("Foto ajustada: o post da fila foi refeito");
              reload();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      ) : null}
    </>
  );
}

/* ---------- Histórico (enviados, descartados, falhas) ---------- */

function HistoryRow({ p, onChanged }: { p: Post; onChanged: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(p.formatted_text);
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async (a: string, msg: string, extra: Record<string, unknown> = {}) => {
    setBusy(a);
    try {
      await act(p.id, a, extra);
      toast.success(msg);
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const del = async () => {
    setBusy("delete");
    try {
      await api(`/api/posts/${p.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40">
        <div className="size-11 shrink-0 overflow-hidden rounded-md border bg-muted">
          {p.has_media ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${p.id}`} alt="" loading="lazy" className="size-full object-cover" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium">{titleOf(p.formatted_text)}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            #{p.id} · {p.source_name}
            {p.reason ? ` · ${p.reason}` : ""}
          </div>
        </div>
        <StatusBadge status={p.status} />
        <span className="hidden w-20 text-right text-[11.5px] whitespace-nowrap text-muted-foreground sm:block">{timeAgo(p.sent_at || p.created_at)}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="grid gap-4 border-t border-[var(--border-soft)] bg-muted/20 p-3 md:grid-cols-2">
          {editing ? (
            <div className="flex flex-col gap-2">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-64 font-mono text-[12.5px]" />
              <div className="flex gap-2">
                <Button size="sm" loading={busy === "save"} onClick={() => run("save", "Texto salvo", { formatted_text: text })}>
                  <Check className="size-3.5" /> Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <WaPreview text={p.formatted_text} image={p.has_media ? `/api/media/${p.id}` : null} time={clockOf(p.sent_at || p.created_at)} />
          )}
          <div className="flex flex-col gap-3">
            <details className="rounded-lg border border-[var(--border-soft)] bg-card px-3 py-2 text-[12.5px]">
              <summary className="cursor-pointer font-medium text-muted-foreground">Mensagem original do grupo</summary>
              <pre className="wa-text mt-2 font-sans whitespace-pre-wrap text-muted-foreground">{p.original_text}</pre>
            </details>
            <div className="mt-auto flex flex-wrap gap-2">
              {["failed", "skipped", "duplicate"].includes(p.status) ? (
                <Button size="sm" loading={busy === "send"} onClick={() => run("send", "Enviado")}>
                  <Send className="size-3.5" /> {p.status === "failed" ? "Tentar de novo agora" : "Postar mesmo assim"}
                </Button>
              ) : null}
              {p.status === "sent" ? (
                <Button size="sm" variant="outline" loading={busy === "requeue"} onClick={() => run("requeue", "De volta para a fila")}>
                  <RotateCcw className="size-3.5" /> Reenviar
                </Button>
              ) : null}
              {!editing && p.status !== "sent" ? (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-3.5" /> Editar texto
                </Button>
              ) : null}
              <Button size="icon" variant="ghost" className="ml-auto" title="Excluir" loading={busy === "delete"} onClick={del}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HistoryTab({ status }: { status: string }) {
  const [q, setQ] = React.useState("");
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading, reload } = useApi<{ rows: Post[]; total: number }>(
    `/api/posts?status=${status}&limit=60${query ? `&q=${encodeURIComponent(query)}` : ""}`,
    15000,
  );
  return (
    <>
      <div className="relative mb-3 sm:w-72">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar perfume ou grupo..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        {q ? (
          <button className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" onClick={() => setQ("")} aria-label="Limpar">
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      {loading && !data ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : data?.rows.length ? (
        <Card className="divide-y divide-[var(--border-soft)] overflow-hidden p-0">
          {data.rows.map((p) => (
            <HistoryRow key={`${p.id}-${p.status}`} p={p} onChanged={reload} />
          ))}
          {data.total > data.rows.length ? (
            <p className="py-2 text-center text-[12px] text-muted-foreground">Mostrando {data.rows.length} de {data.total}</p>
          ) : null}
        </Card>
      ) : (
        <Card className="px-4 py-12 text-center text-[13px] text-muted-foreground">Nada por aqui.</Card>
      )}
    </>
  );
}

export default function FilaPage() {
  const [tab, setTab] = React.useState("fila");
  const { data: counts } = useApi<{ counts: Record<string, number> }>("/api/stats", 15000);
  const c = counts?.counts || {};

  const runQueue = async () => {
    try {
      const r = await api<{ result: string }>("/api/queue", { method: "POST" });
      toast(`Fila: ${r.result}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Posts"
        description="O que vai sair no grupo, o que espera foto e tudo o que já saiu."
        actions={
          <Button variant="outline" size="sm" onClick={runQueue}>
            <Send className="size-3.5" /> Processar fila agora
          </Button>
        }
      />
      <div className="mb-5 flex w-full gap-1 overflow-x-auto rounded-xl border bg-card p-1 sm:w-fit">
        {TABS.map((t) => {
          const n =
            t.key === "fila"
              ? (c.queued || 0) + (c.sending || 0) + (c.photo || 0)
              : t.key === "all"
                ? null
                : t.key.split(",").reduce((a, k) => a + (c[k] || 0), 0);
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                tab === t.key ? "bg-violet-500 text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {n ? <span className={cn("text-[11px] tabular-nums", tab === t.key ? "text-white/80" : "text-muted-foreground")}>{n}</span> : null}
            </button>
          );
        })}
      </div>
      {tab === "fila" ? <QueueTab /> : <HistoryTab key={tab} status={tab} />}
    </>
  );
}
