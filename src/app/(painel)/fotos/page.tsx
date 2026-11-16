"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Download, EyeOff, Eye, Search, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, useApi, timeAgo } from "@/lib/client";
import { cn } from "@/lib/utils";

type Prod = { id: number; name: string; n: number; active: number; cover: number | null; last: string };
type Img = { id: number; width: number; height: number; score: number; disabled: number; created_at: string; message_id: string | null; group_name: string };

function Lightbox({ imgs, index, onIndex, onClose, onToggle }: {
  imgs: Img[]; index: number; onIndex: (i: number) => void; onClose: () => void; onToggle: (i: Img) => void;
}) {
  const img = imgs[index];
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
          <a href={`/api/fotos/${img.id}`} download={`foto-${img.id}.jpg`} className="flex h-8 items-center gap-1.5 rounded-[10px] bg-white/10 px-3 hover:bg-white/20">
            <Download className="size-4" /> Baixar
          </a>
          <button onClick={() => onToggle(img)} className="flex h-8 items-center gap-1.5 rounded-[10px] bg-white/10 px-3 hover:bg-white/20">
            {img.disabled ? <Eye className="size-4" /> : <EyeOff className="size-4" />} {img.disabled ? "Usar nos posts" : "Não usar nos posts"}
          </button>
          <button onClick={onClose} aria-label="Fechar" className="flex size-8 items-center justify-center rounded-[10px] bg-white/10 hover:bg-white/20">
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/fotos/${img.id}`} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
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

function ProductPhotos({ id, onBack }: { id: number; onBack: () => void }) {
  const { data, reload } = useApi<{ product: { id: number; name: string }; images: Img[] }>(`/api/fotos?id=${id}`);
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
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{data?.product?.name || "…"}</div>
          <div className="text-[12px] text-muted-foreground">{imgs.length} foto(s) · a de nota maior é a usada nos posts</div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {imgs.map((img, i) => (
          <button key={img.id} onClick={() => setOpen(i)} className={cn("group overflow-hidden rounded-xl border bg-card text-left", img.disabled && "opacity-50")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/fotos/${img.id}?w=900`} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain transition-transform group-hover:scale-[1.02]" />
            <div className="flex items-center gap-2 border-t px-3 py-2 text-[12px] text-muted-foreground">
              <span className="tabular-nums">{img.width}×{img.height}</span>
              <span>nota {img.score}</span>
              {i === 0 && !img.disabled ? <Badge tone="success">Usada nos posts</Badge> : null}
              {img.message_id?.startsWith("fix:") ? <Badge tone="info">IA</Badge> : null}
              {img.disabled ? <Badge tone="warning">Desligada</Badge> : null}
              <span className="ml-auto truncate">{timeAgo(img.created_at)}</span>
            </div>
          </button>
        ))}
      </div>
      {open != null && <Lightbox imgs={imgs} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onToggle={toggle} />}
    </>
  );
}

export default function FotosPage() {
  const [q, setQ] = React.useState("");
  const [deb, setDeb] = React.useState("");
  const [sel, setSel] = React.useState<number | null>(null);
  React.useEffect(() => {
    const t = setTimeout(() => setDeb(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data } = useApi<{ rows: Prod[]; total: number }>(`/api/fotos?q=${encodeURIComponent(deb)}`);
  return (
    <>
      <PageHeader
        title="Fotos dos perfumes"
        description={`O banco de fotos de cada perfume, em resolução original. Clique numa foto para ver em tela cheia (setas do teclado navegam). ${data ? `${data.total} fotos ativas.` : ""}`}
      />
      {sel ? (
        <ProductPhotos id={sel} onBack={() => setSel(null)} />
      ) : (
        <>
          <div className="relative mb-4 max-w-md">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar perfume..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          {data ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {data.rows.map((p) => (
                <button key={p.id} onClick={() => setSel(p.id)} className="group overflow-hidden rounded-xl border bg-card text-left">
                  {p.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/fotos/${p.cover}?w=500`} alt="" loading="lazy" className="aspect-square w-full bg-white object-contain transition-transform group-hover:scale-[1.03]" />
                  ) : (
                    <div className="flex aspect-square items-center justify-center text-[12px] text-muted-foreground">sem foto ativa</div>
                  )}
                  <div className="border-t px-3 py-2">
                    <div className="line-clamp-2 text-[12.5px] leading-snug font-medium">{p.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">{p.active} foto(s){p.n > p.active ? ` · ${p.n - p.active} desligada(s)` : ""}</div>
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
