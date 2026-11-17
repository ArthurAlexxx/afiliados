"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Download, EyeOff, Eye, ImagePlus, Search, Star, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, useApi, timeAgo } from "@/lib/client";
import { cn } from "@/lib/utils";
import { PhotoBoard } from "./board";

type Prod = { id: number; name: string; n: number; active: number; cover: number | null; main: number | null; main_pin: number | null; pin_pending: number; pin_searched: number; last: string };
type Img = { id: number; width: number; height: number; score: number; disabled: number; created_at: string; message_id: string | null; group_name: string };

function Lightbox({ imgs, index, onIndex, onClose, onToggle, mainId, onMain }: {
  imgs: Img[]; index: number; onIndex: (i: number) => void; onClose: () => void; onToggle: (i: Img) => void;
  mainId: number | null; onMain: (i: Img) => void;
}) {
  const img = imgs[index];
  const [zoom, setZoom] = React.useState(false);
  React.useEffect(() => setZoom(false), [index]);
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onIndex((index + 1) % imgs.length);
      if (e.key === "ArrowLeft") onIndex((index - 1 + imgs.length) % imgs.length);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [index, imgs.length, onClose, onIndex]);
  if (!img) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white" onClick={onClose}>
      <div className="flex items-center gap-3 px-4 py-3 text-[13px]" onClick={(e) => e.stopPropagation()}>
        <span className="tabular-nums opacity-70">{index + 1} / {imgs.length}</span>
        <span className="opacity-90">{img.width}×{img.height}px · nota {img.score}{img.group_name ? ` · ${img.group_name}` : ""}{img.message_id?.startsWith("fix:") ? " · refeita pela IA" : ""}</span>
        {img.disabled ? <Badge tone="warning">Desligada</Badge> : null}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => onMain(img)} className={cn("flex h-8 items-center gap-1.5 rounded-lg px-3", mainId === img.id ? "bg-accent text-accent-foreground" : "bg-white/10 hover:bg-white/20")}>
            <Star className="size-4" /> {mainId === img.id ? "Principal (tirar)" : "Definir como principal"}
          </button>
          <a href={`/api/fotos/${img.id}`} download={`foto-${img.id}.jpg`} className="flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 hover:bg-white/20">
            <Download className="size-4" /> Baixar
          </a>
          <button onClick={() => onToggle(img)} className="flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 hover:bg-white/20">
            {img.disabled ? <Eye className="size-4" /> : <EyeOff className="size-4" />} {img.disabled ? "Usar nos posts" : "Não usar nos posts"}
          </button>
          <button onClick={onClose} aria-label="Fechar" className="flex size-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className={cn("relative min-h-0 flex-1 px-14 pb-4", zoom ? "overflow-auto" : "flex items-center justify-center")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/fotos/${img.id}`}
          alt=""
          title={zoom ? "Clique para caber na tela" : "Clique para ver em 100% (resolução máxima)"}
          className={cn(zoom ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain")}
          onClick={(e) => { e.stopPropagation(); setZoom((z) => !z); }}
        />
        {imgs.length > 1 && (
          <>
            <button aria-label="Anterior" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + imgs.length) % imgs.length); }} className="absolute left-3 flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20">
              <ChevronLeft className="size-5" />
            </button>
            <button aria-label="Próxima" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % imgs.length); }} className="absolute right-3 flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20">
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Opções do Pinterest de um perfume, na página dele: buscar, ver e escolher sem sair da tela. */
function PinOptions({ productId, onChosen }: { productId: number; onChosen: () => void }) {
  const { data, reload } = useApi<{ rows: PinPhoto[] }>(`/api/pinterest?productId=${productId}`);
  const [searching, setSearching] = React.useState(false);
  const [busy, setBusy] = React.useState<number | null>(null);
  const [big, setBig] = React.useState<PinPhoto | null>(null);
  const rows = data?.rows || [];
  const search = async () => {
    setSearching(true);
    try {
      const r = await api<{ msg: string }>("/api/pinterest", { method: "POST", json: { productId } });
      toast.success(r.msg);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSearching(false);
    }
  };
  const decide = async (p: PinPhoto, ok: boolean) => {
    setBusy(p.id);
    try {
      await api("/api/pinterest", { method: "POST", json: ok ? { id: p.id, main: true } : { id: p.id, ok: false } });
      toast.success(ok ? "Escolhida: é a foto principal desse perfume nos próximos posts" : "Recusada");
      setBig(null);
      reload();
      if (ok) onChosen();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mb-6 rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Opções do Pinterest</div>
          <div className="text-[12px] text-muted-foreground">
            {searching
              ? "Buscando no Pinterest… leva uns 20 a 60 segundos."
              : rows.length
                ? `${rows.length} opção(ões). Clique em Escolher na melhor: ela vira a foto principal desse perfume.`
                : "Nenhuma opção ainda. Clique em Buscar para trazer fotos do Pinterest."}
          </div>
        </div>
        <Button size="sm" variant="accent" disabled={searching} onClick={search}>
          <Search className="size-4" /> {searching ? "Buscando…" : rows.length ? "Buscar mais" : "Buscar no Pinterest"}
        </Button>
      </div>
      {searching && !rows.length ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : null}
      {rows.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {rows.map((p) => (
            <div key={p.id} className={cn("overflow-hidden rounded-xl border bg-card", p.flags && "border-warning opacity-80")}>
              <button onClick={() => setBig(p)} className="block w-full" title={p.title || "Ver maior"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/pinterest/${p.id}?w=600`} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain" />
              </button>
              {p.flags ? <div className="border-t px-2 py-1 text-[11px] text-warning">{p.flags}</div> : null}
              <div className="px-2 pt-2 text-[11.5px] text-muted-foreground tabular-nums">{p.width}×{p.height}</div>
              <div className="grid grid-cols-[auto_1fr] gap-1.5 px-2 pt-1.5 pb-2">
                <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => decide(p, false)} aria-label="Recusar" title="Recusar"><X className="size-3.5" /></Button>
                <Button size="sm" variant="accent" disabled={busy === p.id} onClick={() => decide(p, true)}><Check className="size-3.5" /> Escolher</Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {big && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white" onClick={() => setBig(null)}>
          <div className="flex items-center gap-2 px-4 py-3 text-[13px]" onClick={(e) => e.stopPropagation()}>
            <span className="min-w-0 truncate opacity-90">{big.width}×{big.height}px{big.flags ? ` · ${big.flags}` : ""}</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => decide(big, false)} className="flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 hover:bg-white/20"><X className="size-4" /> Recusar</button>
              <button onClick={() => decide(big, true)} className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-accent-foreground"><Check className="size-4" /> Escolher como principal</button>
              <button onClick={() => setBig(null)} aria-label="Fechar" className="flex size-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"><X className="size-4" /></button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/pinterest/${big.id}`} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </div>
  );
}

type Frag = {
  url: string; name: string; brand: string; year: number | null; gender: string | null; description: string;
  top: string[]; middle: string[]; base: string[]; accords: { name: string; strength: number; color: string }[];
  seasons: Record<string, number>; longevity: number | null; sillage: number | null; rating: number | null; ratingCount: number | null;
};
const SEASONS: [string, string][] = [["winter", "Inverno"], ["autumn", "Outono"], ["spring", "Primavera"], ["summer", "Verão"], ["day", "Dia"], ["night", "Noite"]];
const LONG = ["", "muito fraca", "fraca", "moderada", "duradoura", "eterna"];
const SILL = ["", "íntima", "moderada", "forte", "enorme"];

/** Ficha da Fragrantica: descrição, notas, acordes, estações, fixação e projeção. */
function FragCard({ raw }: { raw: string }) {
  let f: Frag;
  try {
    f = JSON.parse(raw);
  } catch {
    return null;
  }
  const maxSeason = Math.max(1, ...SEASONS.map(([k]) => f.seasons?.[k] || 0));
  return (
    <Card className="mb-4 grid gap-4 p-4 text-[13px] md:grid-cols-[1.3fr_1fr]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <a href={f.url} target="_blank" rel="noreferrer" className="text-[14px] font-semibold hover:underline">{f.brand} {f.name}</a>
          <span className="text-muted-foreground">{[f.gender, f.year].filter(Boolean).join(" · ")}</span>
          {f.rating ? <Badge tone="success">★ {f.rating.toFixed(2)} ({f.ratingCount} votos)</Badge> : null}
        </div>
        {f.description ? <p className="text-muted-foreground">{f.description}</p> : null}
        <div className="grid gap-1">
          {[["Topo", f.top], ["Coração", f.middle], ["Fundo", f.base]].map(([l, n]) =>
            (n as string[]).length ? (
              <div key={l as string}><b>{l as string}:</b> {(n as string[]).join(", ")}</div>
            ) : null,
          )}
        </div>
        <div className="flex gap-4 text-muted-foreground">
          {f.longevity ? <span>Fixação: <b className="text-foreground">{LONG[Math.round(f.longevity)] || f.longevity.toFixed(1)}</b></span> : null}
          {f.sillage ? <span>Projeção: <b className="text-foreground">{SILL[Math.round(f.sillage)] || f.sillage.toFixed(1)}</b></span> : null}
        </div>
      </div>
      <div className="space-y-3">
        <div className="space-y-1">
          {f.accords.slice(0, 7).map((a) => (
            <div key={a.name} className="rounded px-2 py-0.5 text-[12px] font-medium text-black/80" style={{ width: `${Math.max(30, a.strength)}%`, background: a.color }}>{a.name}</div>
          ))}
        </div>
        <div className="grid grid-cols-6 items-end gap-1.5">
          {SEASONS.map(([k, l]) => (
            <div key={k} className="text-center text-[11px] text-muted-foreground">
              <div className="mx-auto mb-1 w-full rounded-sm bg-accent/70" style={{ height: `${Math.round(40 * ((f.seasons?.[k] || 0) / maxSeason)) + 2}px` }} />
              {l}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** Lê o que foi arrastado/colado: arquivo de imagem, ou o endereço da imagem (Google manda o link ou o HTML com a <img>). */
async function readDrop(dt: DataTransfer): Promise<{ data?: string; url?: string } | null> {
  const file = [...dt.files].find((f) => f.type.startsWith("image/")) || [...(dt.items || [])].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
  if (file)
    return new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res({ data: String(r.result) });
      r.onerror = () => res(null);
      r.readAsDataURL(file);
    });
  const html = dt.getData("text/html");
  const fromHtml = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&");
  const uri = (dt.getData("text/uri-list") || dt.getData("text/plain") || "").split("\n").map((x) => x.trim()).find((x) => /^(https?:|data:image)/.test(x));
  // o Google às vezes manda o link da página de resultados: o da <img> é o certo
  const pick = fromHtml && (!uri || /google\.[^/]+\/(imgres|search)/.test(uri)) ? fromHtml : uri || fromHtml;
  if (!pick) return null;
  const real = pick.match(/[?&]imgurl=([^&]+)/)?.[1];
  const url = real ? decodeURIComponent(real) : pick;
  return url.startsWith("data:") ? { data: url } : { url };
}

/** Fotos da seção "Fragram Photos" do Fragrantica. Clicou em "Usar", a foto é baixada e vira a principal. */
function Fragram({ productId, photos, onChosen }: { productId: number; photos: { id: number; url: string; thumb: string | null }[]; onChosen: () => void }) {
  const [busy, setBusy] = React.useState<number | null>(null);
  const [all, setAll] = React.useState(false);
  const shown = all ? photos : photos.slice(0, 24);
  async function use(p: { id: number; url: string }) {
    setBusy(p.id);
    try {
      const r = await api<{ msg: string }>("/api/fotos/upload", { method: "POST", json: { productId, url: p.url } });
      toast.success(r.msg || "Foto do Fragrantica virou a principal");
      onChosen();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 text-[13px] font-semibold">Fragram Photos · Fragrantica <span className="font-normal text-muted-foreground">({photos.length} fotos de usuários)</span></div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
        {shown.map((p) => (
          <div key={p.id} className="group relative overflow-hidden rounded-lg border">
            <a href={p.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumb || p.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full object-cover" />
            </a>
            <Button size="sm" className="absolute inset-x-1 bottom-1 h-7 text-[11px] opacity-0 group-hover:opacity-100" disabled={busy !== null} onClick={() => use(p)}>
              {busy === p.id ? "Baixando…" : "Usar como principal"}
            </Button>
          </div>
        ))}
      </div>
      {photos.length > 24 && !all ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setAll(true)}>Ver todas as {photos.length}</Button>
      ) : null}
    </Card>
  );
}

function DropPhoto({ productId, onAdded, compact }: { productId: number; onAdded: () => void; compact?: boolean }) {
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const send = async (dt: DataTransfer | null) => {
    if (!dt) return;
    const got = await readDrop(dt);
    if (!got) return toast.error("Não achei imagem no que foi solto. Arraste a própria foto (ou copie a imagem e cole aqui com Ctrl+V)");
    setBusy(true);
    try {
      const r = await api<{ msg: string }>("/api/fotos/upload", { method: "POST", json: { productId, ...got } });
      toast.success(r.msg);
      onAdded();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|TEXTAREA/.test(t.tagName)) return;
      // várias áreas na tela: Ctrl+V vai só para a que está sob o mouse
      const w = window as { __dropHover?: number };
      if (document.querySelectorAll("[data-drop]").length > 1 && w.__dropHover !== productId) return;
      if (e.clipboardData) void send(e.clipboardData);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });
  return (
    <div
      data-drop
      onMouseEnter={() => ((window as { __dropHover?: number }).__dropHover = productId)}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => (e.preventDefault(), setOver(false), void send(e.dataTransfer))}
      onClick={() => input.current?.click()}
      className={cn(
        compact
          ? "flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-3 text-[11.5px] transition-colors"
          : "mb-4 flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 text-[13px] transition-colors",
        over ? "border-accent bg-accent/10" : "border-border text-muted-foreground hover:border-accent/60",
      )}
    >
      <ImagePlus className="size-6 shrink-0" />
      <div className="min-w-0">
        <div className={cn("font-medium text-foreground", compact && "text-[12.5px] font-semibold")}>
          {busy ? "Baixando a foto…" : compact ? "Ou arraste uma foto do Google aqui" : "Arraste aqui uma foto do Google (ou cole com Ctrl+V, ou clique para escolher)"}
        </div>
        <div>
          {compact
            ? "Também dá para colar com Ctrl+V ou clicar para escolher do computador."
            : "No Google Imagens, clique na foto, espere ela abrir grande ao lado e arraste a grande para cá. Ela é baixada e vira a principal desse perfume."}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const dt = new DataTransfer();
          for (const f of e.target.files || []) dt.items.add(f);
          void send(dt);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ProductPhotos({ id, onBack }: { id: number; onBack: () => void }) {
  const { data, reload } = useApi<{ product: { id: number; name: string; main_image_id: number | null; blocked?: number; frag_data?: string | null; frag_url?: string | null }; images: Img[]; used: number | null; fragram?: { id: number; url: string; thumb: string | null }[] }>(`/api/fotos?id=${id}`);
  const blocked = Boolean(data?.product?.blocked);
  const setBlocked = async () => {
    try {
      await api("/api/fotos", { method: "PATCH", json: { productId: id, blocked: !blocked } });
      toast.success(blocked ? "Perfume liberado para postar" : "Esse perfume não será mais postado");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const mainId = data?.product?.main_image_id ?? null;
  const setMain = async (img: Img) => {
    const off = mainId === img.id;
    try {
      await api("/api/fotos", { method: "PATCH", json: { productId: id, mainImageId: off ? null : img.id } });
      toast.success(off ? "Voltou para a escolha automática da melhor foto" : "Foto principal definida: os próximos posts desse perfume usam ela");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const [open, setOpen] = React.useState<number | null>(null);
  const toggle = async (img: Img) => {
    try {
      await api("/api/fotos", { method: "PATCH", json: { id: img.id, disabled: !img.disabled } });
      toast.success(img.disabled ? "Foto volta a ser usada nos posts" : "Foto não será mais usada nos posts");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const imgs = data?.images || [];
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}><ChevronLeft className="size-4" /> Todos os perfumes</Button>
        <Button variant={blocked ? "accent" : "outline"} size="sm" className="order-last ml-auto" onClick={setBlocked}>
          {blocked ? "Bloqueado · liberar" : "Não postar este perfume"}
        </Button>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{data?.product?.name || "…"}</div>
          <div className="text-[12px] text-muted-foreground">
            {imgs.length} foto(s) ·{" "}
            {mainId
              ? "principal escolhida por você"
              : "escolha automática: o sistema usa a melhor foto, seguindo o gosto aprendido das suas principais. Não gostou? Torne outra principal."}
          </div>
        </div>
      </div>
      {data?.product?.frag_data ? <FragCard raw={data.product.frag_data} /> : null}
      <DropPhoto productId={id} onAdded={reload} />
      {data?.fragram?.length ? <Fragram productId={id} photos={data.fragram} onChosen={reload} /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {imgs.map((img, i) => (
          <div key={img.id} className={cn("group overflow-hidden rounded-xl border bg-card text-left", mainId === img.id && "ring-2 ring-accent", img.disabled && "opacity-50")}>
            <button onClick={() => setOpen(i)} className="block w-full overflow-hidden" title="Abrir em tela cheia">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/fotos/${img.id}?w=900`} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain transition-transform group-hover:scale-[1.02]" />
            </button>
            <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-[12px] text-muted-foreground">
              <Button size="sm" variant={mainId === img.id ? "accent" : "outline"} onClick={() => setMain(img)}>
                <Star className="size-3.5" /> {mainId === img.id ? "Principal" : "Tornar principal"}
              </Button>
              <span className="tabular-nums">{img.width}×{img.height}</span>
              <span>nota {img.score}</span>
              {data?.used === img.id ? <Badge tone="success">{mainId ? "Usada nos posts" : "Usada nos posts (automática)"}</Badge> : null}
              {img.message_id?.startsWith("fix:") ? <Badge tone="info">IA</Badge> : null}
              {img.message_id?.startsWith("manual:") ? <Badge tone="info">Você colocou</Badge> : null}
              {img.message_id?.startsWith("pin:") ? <Badge tone="info">Pinterest</Badge> : null}
              {img.message_id?.startsWith("frag:") ? <Badge tone="info">Fragrantica</Badge> : null}
              {img.disabled ? <Badge tone="warning">Desligada</Badge> : null}
              <span className="ml-auto truncate">{timeAgo(img.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
      {open != null && <Lightbox imgs={imgs} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onToggle={toggle} mainId={mainId} onMain={setMain} />}
    </>
  );
}

type PinPhoto = { id: number; product_id: number; name: string; width: number; height: number; title: string | null; bank: number; pick: number; flags: string | null; last_posted_at: string | null; queued: number | null };

type Training = { n: number; hits: number; top2: number; chance: number; likes: string[]; min: number; rate: number; auto: boolean };

function PinReview() {
  const { data, reload } = useApi<{ rows: PinPhoto[]; auto: boolean; training?: Training }>("/api/pinterest", 30_000);
  const t = data?.training;
  const [busy, setBusy] = React.useState<number | null>(null);
  const [big, setBig] = React.useState<PinPhoto | null>(null);
  const [showSus, setShowSus] = React.useState<Record<number, boolean>>({});
  const decide = async (p: PinPhoto, ok: boolean) => {
    setBusy(p.id);
    try {
      await api("/api/pinterest", { method: "POST", json: ok ? { id: p.id, main: true } : { id: p.id, ok: false } });
      toast.success(ok ? "Escolhida: é a foto principal desse perfume nos próximos posts" : "Recusada");
      setBig(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const groups = new Map<number, PinPhoto[]>();
  for (const r of data?.rows || []) groups.set(r.product_id, [...(groups.get(r.product_id) || []), r]);
  return (
    <>
      <div className="mb-4 rounded-xl bg-muted px-4 py-3 text-[12.5px] text-muted-foreground">
        Fotos achadas no Pinterest para perfumes das promoções com poucas fotos. Em cada perfume, clique em <b>Escolher</b> na melhor: ela vira a foto principal dos próximos posts.
        As outras não vão para os posts, mas ensinam o seu gosto: com as suas escolhas, o sistema aprende e passa a escolher sozinho.
        Recuse antes as que forem de outro perfume ou tiverem marca, @ ou texto.{" "}
        {data?.auto
          ? "Automático LIGADO: perfume das promoções sem foto principal ganha a melhor foto do Pinterest como principal, para sempre (você troca na página do perfume)."
          : "Automático desligado: nada daqui vai para os posts sem você aprovar."}
        {t ? (
          <div className="mt-2 rounded-lg bg-background px-3 py-2 text-foreground">
            <b>Treino da escolha automática:</b>{" "}
            {t.n
              ? `nas suas ${t.n} escolha(s) do Pinterest, o sistema escolheria a mesma foto em ${t.hits} (${Math.round((100 * t.hits) / t.n)}%; no chute seriam ~${t.chance}; entre as 2 primeiras dele: ${t.top2}).`
              : "ainda sem escolhas suas do Pinterest."}
            {t.likes.length ? ` Você tem preferido fotos ${t.likes.join(", ")}.` : ""}{" "}
            {t.auto
              ? "O automático está ligado."
              : `O automático liga sozinho quando o sistema acertar ${Math.round(t.rate * 100)}% de pelo menos ${t.min} escolhas suas.`}{" "}
            O selo <b>o sistema escolheria</b> mostra o palpite dele em cada perfume.
          </div>
        ) : null}
        <div className="mt-2">
          <Button size="sm" variant={data?.auto ? "outline" : "accent"} onClick={async () => {
            try {
              await api("/api/pinterest", { method: "POST", json: { auto: !data?.auto } });
              toast.success(data?.auto ? "Automático desligado" : "Automático ligado");
              reload();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}>{data?.auto ? "Desligar automático" : "Ligar automático"}</Button>
        </div>
      </div>
      {!data ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      ) : !groups.size ? (
        <Card className="px-5 py-12 text-center text-[13px] text-muted-foreground">Nenhuma foto do Pinterest esperando aprovação.</Card>
      ) : (
        [...groups.values()].map((list) => {
          const pid = list[0].product_id;
          const ok = list.filter((p) => !p.flags);
          const sus = list.filter((p) => p.flags);
          const shown = showSus[pid] ? list : ok;
          return (
            <div key={pid} className="mb-8">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/pinterest/${pid}?ref=1&w=160`} alt="" className="size-14 rounded-lg border bg-white object-contain" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} title="Referência: foto do perfume certo (grupos ou anúncio do ML)" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                    {list[0].name}
                    {list[0].queued ? (
                      <Badge tone="warning">na fila agora</Badge>
                    ) : list[0].last_posted_at ? (
                      <Badge tone="info">já postado {timeAgo(list[0].last_posted_at)}</Badge>
                    ) : (
                      <Badge tone="success">entre os próximos posts</Badge>
                    )}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {ok.length} foto(s) conferidas · à esquerda, a referência do perfume certo · {list[0].bank} foto(s) no banco hoje
                  </div>
                </div>
                {sus.length ? (
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => setShowSus((m) => ({ ...m, [pid]: !m[pid] }))}>
                    {showSus[pid] ? "Esconder suspeitas" : `Ver ${sus.length} suspeita(s) de outro perfume`}
                  </Button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                {shown.map((p) => (
                  <div key={p.id} className={cn("overflow-hidden rounded-xl border bg-card", p.flags && "border-warning opacity-80")}>
                    <button onClick={() => setBig(p)} className="block w-full" title={p.title || "Ver maior"}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/pinterest/${p.id}?w=600`} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain" />
                    </button>
                    {p.flags ? <div className="border-t px-2 py-1 text-[11px] text-warning">{p.flags}</div> : null}
                    <div className="flex flex-wrap items-center gap-1.5 border-t px-2 pt-2 text-[11.5px] text-muted-foreground">
                      <span className="tabular-nums">{p.width}×{p.height}</span>
                      {p.pick ? <Badge tone="success">o sistema escolheria</Badge> : null}
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-1.5 px-2 pt-1.5 pb-2">
                      <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => decide(p, false)} aria-label="Recusar" title="Recusar"><X className="size-3.5" /></Button>
                      <Button size="sm" variant="accent" disabled={busy === p.id} onClick={() => decide(p, true)}><Check className="size-3.5" /> Escolher</Button>
                    </div>
                  </div>
                ))}
                {!shown.length && <div className="col-span-full text-[12.5px] text-muted-foreground">Nenhuma foto com certeza de ser esse perfume. Veja as suspeitas ou recuse.</div>}
              </div>
            </div>
          );
        })
      )}
      {big && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white" onClick={() => setBig(null)}>
          <div className="flex items-center gap-2 px-4 py-3 text-[13px]" onClick={(e) => e.stopPropagation()}>
            <span className="min-w-0 truncate opacity-90">{big.name} · {big.width}×{big.height}px</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => decide(big, false)} className="flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-3 hover:bg-white/20"><X className="size-4" /> Recusar</button>
              <button onClick={() => decide(big, true)} className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-accent-foreground"><Check className="size-4" /> Escolher como principal</button>
              <button onClick={() => setBig(null)} aria-label="Fechar" className="flex size-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"><X className="size-4" /></button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/pinterest/${big.id}`} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        </div>
      )}
    </>
  );
}

export default function FotosPage() {
  // link direto: /fotos#pinterest abre a aba de escolha
  const [tab, setTabState] = React.useState<"board" | "fotos" | "pin">("board");
  React.useEffect(() => {
    if (window.location.hash === "#pinterest") setTabState("board");
    if (window.location.hash === "#perfumes") setTabState("fotos");
  }, []);
  const setTab = (t: "board" | "fotos" | "pin") => {
    setTabState(t);
    history.replaceState(null, "", t === "pin" ? "#pinterest" : t === "fotos" ? "#perfumes" : window.location.pathname);
  };
  const [q, setQ] = React.useState("");
  const [deb, setDeb] = React.useState("");
  const [sel, setSel] = React.useState<number | null>(null);
  const [filter, setFilter] = React.useState<"all" | "pin" | "own" | "none" | "choose">("all");
  React.useEffect(() => {
    const t = setTimeout(() => setDeb(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, reload: reloadList } = useApi<{ rows: Prod[]; total: number; learned: { n: number; likes: string[] } }>(`/api/fotos?q=${encodeURIComponent(deb)}`, 30_000);
  return (
    <>
      <PageHeader
        title="Fotos dos perfumes"
        description={`O banco de fotos de cada perfume, em resolução original. Clique numa foto para ver em tela cheia e clique de novo para ver em 100% (setas do teclado navegam). Escolha a foto principal de cada perfume: os posts dele sempre saem com ela. ${data ? `${data.total} fotos ativas.` : ""}`}
      />
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={tab === "board" ? "accent" : "outline"} onClick={() => setTab("board")}>Escolher fotos</Button>
        <Button size="sm" variant={tab === "fotos" ? "accent" : "outline"} onClick={() => setTab("fotos")}>Perfume por perfume</Button>
      </div>
      {tab === "board" ? (
        <PhotoBoard onOpen={(id) => { setSel(id); setTab("fotos"); }} Drop={DropPhoto} />
      ) : tab === "pin" ? (
        <PinReview />
      ) : sel ? (
        <ProductPhotos id={sel} onBack={() => { setSel(null); reloadList(); }} />
      ) : (
        <>
          {data && (
            <div className="mb-4 rounded-xl bg-muted px-4 py-3 text-[12.5px] text-muted-foreground">
              {data.learned.n
                ? `Escolha automática aprendendo com ${data.learned.n} foto(s) principal(is) que você escolheu${data.learned.likes.length ? `: você tem preferido fotos ${data.learned.likes.join(", ")}` : ""}. Quanto mais você escolher, mais ela acerta.`
                : "Nos perfumes sem principal, o sistema escolhe a melhor foto sozinho. Cada principal que você escolher ensina o seu gosto para a escolha automática."}
            </div>
          )}
          <div className="relative mb-4 max-w-md">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar perfume..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          {data && (() => {
            const c = {
              all: data.rows.length,
              pin: data.rows.filter((p) => p.main && p.main_pin).length,
              own: data.rows.filter((p) => p.main && !p.main_pin).length,
              none: data.rows.filter((p) => !p.main).length,
              choose: data.rows.filter((p) => p.pin_pending > 0).length,
            };
            const opts: [typeof filter, string][] = [
              ["all", `Todos (${c.all})`],
              ["own", `★ Com foto escolhida (${c.own + c.pin})`],
              ["none", `Sem principal (${c.none})`],
            ];
            return (
              <div className="mb-4 flex flex-wrap gap-2">
                {opts.map(([k, label]) => (
                  <Button key={k} size="sm" variant={filter === k ? "accent" : "outline"} onClick={() => setFilter(k)}>{label}</Button>
                ))}
              </div>
            );
          })()}
          {data ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {data.rows
                .filter((p) =>
                  filter === "pin" ? p.main && p.main_pin : filter === "own" ? !!p.main : filter === "none" ? !p.main : filter === "choose" ? p.pin_pending > 0 : true,
                )
                .map((p) => (
                <button key={p.id} onClick={() => setSel(p.id)} className="group overflow-hidden rounded-xl border bg-card text-left">
                  {p.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/fotos/${p.cover}?w=500`} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain transition-transform group-hover:scale-[1.03]" />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-[12px] text-muted-foreground">sem foto ativa</div>
                  )}
                  <div className="border-t px-3 py-2">
                    <div className="line-clamp-2 text-[12.5px] leading-snug font-medium">{p.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {p.active} foto(s){p.n > p.active ? ` · ${p.n - p.active} desligada(s)` : ""} · {p.main ? (p.main_pin ? "★ escolhida do Pinterest" : "★ escolhida") : "automática"}
                    </div>
{null}
                  </div>
                </button>
              ))}
              {!data.rows.length && <Card className="col-span-full px-5 py-12 text-center text-[13px] text-muted-foreground">Nenhum perfume com foto.</Card>}
            </div>
          ) : (
            <div className="h-64 animate-pulse rounded-xl bg-muted" />
          )}
        </>
      )}
    </>
  );
}
