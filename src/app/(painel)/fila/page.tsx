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
  detail?: {
    source: { group_name: string; created_at: string; price: number | null; old_price: number | null; pct: number | null; coupon: string | null; url: string | null } | null;
    groups: { g: string; price: number | null; at: string; n: number }[];
    score: number | null;
    median: number | null;
    realRef: number | null;
    realSamples: number | null;
    realLabel: string | null;
    inflated: boolean;
    origin: string | null;
    seenGroups: number | null;
    agent: string | null;
    photo: string | null;
  };
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
  { key: "rejected", label: "Rejeitados e descartados" },
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

const ORIGIN: Record<string, string> = { arabe: "Árabe", importado: "Importado", nacional: "Nacional" };
const LABEL: Record<string, { t: string; c: string }> = {
  otima: { t: "Ótimo preço", c: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  boa: { t: "Bom preço", c: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  normal: { t: "Preço normal", c: "bg-gray-500/15 text-muted-foreground" },
};

function Info({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-[var(--border-soft)] bg-muted/30 px-3 py-2", className)}>
      <div className="mb-1 text-[10.5px] font-semibold tracking-wide text-gray-400 uppercase">{label}</div>
      <div className="text-[12.5px] leading-relaxed">{children}</div>
    </div>
  );
}

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
  const d = p.detail;
  const src = d?.source;
  const old = src?.old_price && p.price && src.old_price > p.price ? src.old_price : null;
  const label = d?.realLabel ? LABEL[d.realLabel] : null;
  return (
    <Card className={cn("overflow-hidden p-0", first && "ring-2 ring-violet-500/60")}>
      {/* topo: horário de saída e de onde veio */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] px-4 py-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
            sending ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-violet-500/10 text-violet-700 dark:text-violet-300",
          )}
        >
          {sending ? <Send className="size-3" /> : <Clock className="size-3" />}
          {sending ? "Enviando agora" : `Sai ${until(p.eta)} · ${p.eta ? new Date(p.eta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}`}
        </span>
        {src ? (
          <span className="text-[12px] text-muted-foreground">
            veio de <b className="font-semibold text-foreground">{src.group_name}</b> {timeAgo(src.created_at)}
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">#{p.id}</span>
      </div>

      <div className="flex gap-4 p-4">
        <div className="relative size-24 shrink-0 overflow-hidden rounded-lg border bg-muted sm:size-32">
          {p.has_media ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${p.id}?v=${encodeURIComponent(p.mv)}`} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-[11px] text-muted-foreground">sem foto</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-snug font-semibold">{p.name || titleOf(p.formatted_text)}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {p.price ? <span className="text-[20px] font-bold tabular-nums">{brl(p.price)}</span> : null}
            {old ? <span className="text-[12.5px] text-muted-foreground line-through tabular-nums">{brl(old)}</span> : null}
            {p.discount ? (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300">-{p.discount}%</span>
            ) : null}
            {label ? <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", label.c)}>{label.t}</span> : null}
            {d?.origin ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground">{ORIGIN[d.origin] || d.origin}</span> : null}
          </div>
          {!sending ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
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
            </div>
          ) : null}
        </div>
      </div>

      {/* detalhes em blocos */}
      {d ? (
        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-4">
          <Info label="Origem da promoção">
            {src ? (
              <>
                <div className="font-semibold">{src.group_name}</div>
                <div className="text-muted-foreground">
                  {clockOf(src.created_at)} · {timeAgo(src.created_at)}
                </div>
                {src.coupon ? (
                  <div className="mt-1">
                    Cupom <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-amber-700 dark:text-amber-300">{src.coupon}</span>
                  </div>
                ) : null}
                {p.link ? (
                  <a href={p.link} target="_blank" rel="noreferrer" className="mt-1 inline-block font-medium text-violet-600 hover:underline dark:text-violet-400">
                    Abrir no Mercado Livre ↗
                  </a>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">{p.source_name}</span>
            )}
          </Info>
          <Info label="Preço">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 tabular-nums">
              <span className="text-muted-foreground">Agora</span>
              <span className="text-right font-semibold">{brl(p.price) || "?"}</span>
              {old ? (
                <>
                  <span className="text-muted-foreground">De (no anúncio)</span>
                  <span className={cn("text-right", d.inflated && "text-amber-600")}>{brl(old)}{d.inflated ? " ⚠" : ""}</span>
                </>
              ) : null}
              {d.realRef ? (
                <>
                  <span className="text-muted-foreground">Normal nos grupos</span>
                  <span className="text-right">{brl(d.realRef)}</span>
                </>
              ) : d.median ? (
                <>
                  <span className="text-muted-foreground">Mediana</span>
                  <span className="text-right">{brl(d.median)}</span>
                </>
              ) : null}
            </div>
            {d.realSamples ? <div className="mt-1 text-[11px] text-muted-foreground">base: {d.realSamples} preço(s) dos últimos 30 dias</div> : null}
            {d.inflated ? <div className="mt-1 text-[11px] text-amber-600">O &quot;de&quot; do anúncio está acima do normal</div> : null}
          </Info>
          <Info label={`Visto em ${d.groups.length || d.seenGroups || 0} grupo(s) nas últimas 24h`}>
            {d.groups.length ? (
              <ul className="space-y-0.5">
                {d.groups.slice(0, 5).map((g) => (
                  <li key={g.g} className="flex items-center gap-2">
                    <span className={cn("min-w-0 flex-1 truncate", src?.group_name === g.g && "font-semibold")}>{g.g}</span>
                    <span className="tabular-nums text-muted-foreground">{brl(g.price)}</span>
                  </li>
                ))}
                {d.groups.length > 5 ? <li className="text-[11px] text-muted-foreground">+ {d.groups.length - 5} grupo(s)</li> : null}
              </ul>
            ) : (
              <span className="text-muted-foreground">Só nesse grupo</span>
            )}
          </Info>
          <Info label="Por que vai sair">
            {d.agent ? <div>{d.agent}</div> : null}
            <div className="mt-1 flex flex-wrap gap-1.5 text-[11.5px] text-muted-foreground">
              {d.score != null ? <span className="rounded bg-muted px-1.5 py-0.5">nota {Math.round(d.score)}</span> : null}
              {d.photo ? <span className="rounded bg-muted px-1.5 py-0.5">foto: {d.photo === "banco" ? "escolhida por você" : d.photo}</span> : null}
            </div>
          </Info>
        </div>
      ) : null}

      <div className="border-t border-[var(--border-soft)] px-4 py-2">
        <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} /> {open ? "Esconder mensagem" : "Ver como sai no grupo"}
        </button>
        {open ? (
          <div className="mt-2">
            <WaPreview text={p.formatted_text} image={p.has_media ? `/api/media/${p.id}?v=${encodeURIComponent(p.mv)}` : null} className="max-w-md" />
          </div>
        ) : null}
      </div>
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

      <Section title="Enviados" hint="Tudo o que já saiu no grupo. Clique num card para ver a mensagem e os detalhes.">
        <SentGallery />
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


/* ---------- Enviados (galeria com filtros e páginas) ---------- */

type SentResp = { rows: QPost[]; total: number; page: number; pages: number; groups: { g: string; n: number }[]; today: number };

const PERIODS = [
  { k: "today", l: "Hoje" },
  { k: "7d", l: "7 dias" },
  { k: "30d", l: "30 dias" },
  { k: "all", l: "Tudo" },
];

function SentCard({ p, onOpen }: { p: QPost; onOpen: () => void }) {
  const src = p.detail?.source;
  return (
    <button onClick={onOpen} className="group overflow-hidden rounded-xl border border-[var(--border-soft)] bg-card text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-square bg-muted">
        {p.has_media ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/media/${p.id}?v=${encodeURIComponent(p.mv)}`} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-[12px] text-muted-foreground">sem foto</div>
        )}
        <span className="absolute top-2 left-2 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
          {clockOf(p.sent_at)} · {timeAgo(p.sent_at)}
        </span>
        {p.discount ? (
          <span className="absolute top-2 right-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[11.5px] font-bold text-white">-{p.discount}%</span>
        ) : null}
      </div>
      <div className="p-3">
        <div className="line-clamp-2 min-h-[2.6em] text-[14px] leading-snug font-semibold">{p.name || titleOf(p.formatted_text)}</div>
        <div className="mt-1.5 flex items-baseline gap-2">
          {p.price ? <span className="text-[18px] font-bold tabular-nums">{brl(p.price)}</span> : null}
          {src?.old_price && p.price && src.old_price > p.price ? <span className="text-[12px] text-muted-foreground line-through tabular-nums">{brl(src.old_price)}</span> : null}
        </div>
        <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--border-soft)] pt-2 text-[12px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            veio de <b className="font-semibold text-foreground">{src?.group_name || p.source_name}</b>
          </span>
          {p.detail?.groups.length ? <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px]">{p.detail.groups.length} grupo(s)</span> : null}
        </div>
      </div>
    </button>
  );
}

function SentDetail({ p, onClose }: { p: QPost; onClose: () => void }) {
  const [config, setConfig] = React.useState(false);
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const d = p.detail;
  const src = d?.source;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-full w-full max-w-4xl overflow-auto rounded-xl bg-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{p.name || titleOf(p.formatted_text)}</div>
            <div className="text-[12px] text-muted-foreground">Enviado {clockOf(p.sent_at)} · {timeAgo(p.sent_at)} · #{p.id}</div>
          </div>
          {p.product_id ? (
            <Button size="sm" variant={config ? "outline" : "accent"} onClick={() => setConfig((v) => !v)}>
              <CropIcon className="size-3.5" /> {config ? "Fechar foto" : "Configurar foto para os próximos"}
            </Button>
          ) : null}
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>
        {config && p.product_id ? (
          <div className="border-b border-[var(--border-soft)] bg-muted/20 p-4">
            <div className="mb-2 text-[12.5px] text-muted-foreground">
              Escolha a foto e enquadre no quadrado 1:1. Este post já saiu e não muda; os próximos desse perfume saem assim.
            </div>
            <PhotoBoard embedded only={p.product_id} onOpen={() => undefined} Drop={DropPhoto} />
          </div>
        ) : null}
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <WaPreview text={p.formatted_text} image={p.has_media ? `/api/media/${p.id}?v=${encodeURIComponent(p.mv)}` : null} time={clockOf(p.sent_at)} />
          <div className="space-y-2">
            <Info label="Origem da promoção">
              {src ? (
                <>
                  <div className="font-semibold">{src.group_name}</div>
                  <div className="text-muted-foreground">{clockOf(src.created_at)} · {timeAgo(src.created_at)}</div>
                  {src.coupon ? <div className="mt-1">Cupom <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold">{src.coupon}</span></div> : null}
                </>
              ) : (
                p.source_name
              )}
              {p.link ? (
                <a href={p.link} target="_blank" rel="noreferrer" className="mt-1 block font-medium text-violet-600 hover:underline dark:text-violet-400">Abrir no Mercado Livre ↗</a>
              ) : null}
            </Info>
            <Info label="Preço">
              <div className="grid grid-cols-[auto_1fr] gap-x-3 tabular-nums">
                <span className="text-muted-foreground">Postado por</span>
                <span className="text-right font-semibold">{brl(p.price) || "?"}</span>
                {src?.old_price ? (<><span className="text-muted-foreground">De (no anúncio)</span><span className="text-right">{brl(src.old_price)}</span></>) : null}
                {d?.realRef ? (<><span className="text-muted-foreground">Normal nos grupos</span><span className="text-right">{brl(d.realRef)}</span></>) : null}
                {p.discount ? (<><span className="text-muted-foreground">Abaixo do normal</span><span className="text-right font-semibold text-emerald-600">{p.discount}%</span></>) : null}
              </div>
            </Info>
            {d?.groups.length ? (
              <Info label={`Visto em ${d.groups.length} grupo(s) nas 24h antes`}>
                <ul className="space-y-0.5">
                  {d.groups.map((g) => (
                    <li key={g.g} className="flex gap-2">
                      <span className={cn("min-w-0 flex-1 truncate", src?.group_name === g.g && "font-semibold")}>{g.g}</span>
                      <span className="text-muted-foreground tabular-nums">{brl(g.price)}</span>
                    </li>
                  ))}
                </ul>
              </Info>
            ) : null}
            {d?.agent ? <Info label="Por que saiu">{d.agent}</Info> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SentGallery() {
  const [q, setQ] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [group, setGroup] = React.useState("");
  const [period, setPeriod] = React.useState("all");
  const [sort, setSort] = React.useState("recent");
  const [page, setPage] = React.useState(1);
  const [sel, setSel] = React.useState<QPost | null>(null);
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => setPage(1), [query, group, period, sort]);
  const { data, loading } = useApi<SentResp>(
    `/api/posts/sent?page=${page}&period=${period}&sort=${sort}${query ? `&q=${encodeURIComponent(query)}` : ""}${group ? `&group=${encodeURIComponent(group)}` : ""}`,
    30000,
  );
  const pages = data?.pages || 1;
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2);
  const sel2 = "h-9 rounded-lg border border-[var(--border-soft)] bg-card px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-violet-500/40";
  return (
    <>
      <Card className="mb-3 flex flex-wrap items-center gap-2 p-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar perfume..." value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-9" />
        </div>
        <select value={group} onChange={(e) => setGroup(e.target.value)} className={sel2}>
          <option value="">Todos os grupos de origem</option>
          {data?.groups.map((g) => (
            <option key={g.g} value={g.g}>
              {g.g} ({g.n})
            </option>
          ))}
        </select>
        <div className="flex rounded-lg border border-[var(--border-soft)] p-0.5">
          {PERIODS.map((x) => (
            <button
              key={x.k}
              onClick={() => setPeriod(x.k)}
              className={cn("h-8 rounded-md px-2.5 text-[12.5px] font-medium", period === x.k ? "bg-violet-500 text-white" : "text-muted-foreground hover:text-foreground")}
            >
              {x.l}
            </button>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className={sel2}>
          <option value="recent">Mais recentes</option>
          <option value="discount">Maior desconto</option>
          <option value="price">Menor preço</option>
        </select>
      </Card>
      <div className="mb-2 text-[12.5px] text-muted-foreground">
        {data ? `${data.total} post(s)${period === "all" ? ` · ${data.today} hoje` : ""}` : "Carregando…"}
      </div>
      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : data?.rows.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {data.rows.map((p) => (
            <SentCard key={p.id} p={p} onOpen={() => setSel(p)} />
          ))}
        </div>
      ) : (
        <Card className="px-5 py-10 text-center text-[13px] text-muted-foreground">Nenhum envio com esses filtros.</Card>
      )}
      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-1">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Anterior
          </Button>
          {nums.map((n, i) => (
            <React.Fragment key={n}>
              {i > 0 && n - nums[i - 1] > 1 ? <span className="px-1 text-muted-foreground">…</span> : null}
              <button
                onClick={() => setPage(n)}
                className={cn("h-8 min-w-8 rounded-lg px-2 text-[13px] font-medium tabular-nums", n === page ? "bg-violet-500 text-white" : "text-muted-foreground hover:bg-muted")}
              >
                {n}
              </button>
            </React.Fragment>
          ))}
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Próxima
          </Button>
        </div>
      ) : null}
      {sel ? <SentDetail p={sel} onClose={() => setSel(null)} /> : null}
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
              {["skipped", "duplicate"].includes(p.status) ? (
                <Button size="sm" variant="outline" loading={busy === "restore"} onClick={() => run("restore", "Voltou para a fila")}>
                  <RotateCcw className="size-3.5" /> Voltar para a fila
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


/* ---------- Rejeitados ---------- */

type Blocked = { id: number; name: string; main: number | null; post: number | null; post_at: string | null; has_media: number; url: string | null; grp: string | null; price: number | null };

function RejectedTab() {
  const { data, reload } = useApi<{ rows: Blocked[] }>("/api/posts/rejected", 30000);
  const [busy, setBusy] = React.useState<string | null>(null);
  async function unblock(b: Blocked, restore: boolean) {
    setBusy(`${b.id}:${restore}`);
    try {
      if (restore && b.post) {
        const r = await act(b.post, "restore");
        toast.success(r.msg || "Voltou para a fila");
      } else {
        await api("/api/fotos", { method: "PATCH", json: { productId: b.id, blocked: false } });
        toast.success("Liberado: as próximas ofertas dele podem sair");
      }
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <Section
        title="Marcados para não postar"
        hint="Perfumes que você tirou com “Não postar”. Nenhuma oferta deles sai até você liberar."
        count={data?.rows.length}
      >
        {!data ? (
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
        ) : data.rows.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.rows.map((b) => (
              <Card key={b.id} className="flex gap-3 p-3">
                <div className="size-20 shrink-0 overflow-hidden rounded-lg border bg-muted">
                  {b.main ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/fotos/square?img=${b.main}&w=200`} alt="" loading="lazy" className="size-full object-cover" />
                  ) : b.post && b.has_media ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/media/${b.post}`} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center text-[11px] text-muted-foreground">sem foto</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[13.5px] leading-snug font-semibold">{b.name}</div>
                  <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                    {b.price ? `${brl(b.price)} · ` : ""}
                    {b.grp || ""}
                    {b.post_at ? ` · ${timeAgo(b.post_at)}` : ""}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {b.post ? (
                      <Button size="sm" className="h-7 text-[12px]" loading={busy === `${b.id}:true`} onClick={() => unblock(b, true)}>
                        <RotateCcw className="size-3.5" /> Voltar para a fila
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" className="h-7 text-[12px]" loading={busy === `${b.id}:false`} onClick={() => unblock(b, false)}>
                      Só liberar
                    </Button>
                    {b.url ? (
                      <a href={b.url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center rounded-lg px-2 text-[12px] font-medium text-violet-600 hover:underline dark:text-violet-400">
                        Ver no ML ↗
                      </a>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="px-5 py-6 text-center text-[13px] text-muted-foreground">Nenhum perfume bloqueado.</Card>
        )}
      </Section>
      <Section title="Posts descartados" hint="Saíram da fila por algum motivo (sem foto em 3h, oferta velha, repetido…). Dá para voltar qualquer um.">
        <HistoryTab status="skipped,duplicate" />
      </Section>
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
                : t.key === "rejected"
                  ? (c.skipped || 0) + (c.duplicate || 0)
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
      {tab === "fila" ? <QueueTab /> : tab === "sent" ? <SentGallery /> : tab === "rejected" ? <RejectedTab /> : <HistoryTab key={tab} status={tab} />}
    </>
  );
}
