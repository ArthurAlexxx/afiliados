"use client";

import * as React from "react";
import { Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type Crop = { l: number; t: number; w: number };

/**
 * Enquadramento 1:1 do post: o quadrado tem formato fixo, o Arthur só arrasta para o ponto principal
 * da foto e aproxima/afasta (roda do mouse, botões ou barra). Fora do quadrado fica escurecido.
 */
export function CropSquare({
  src,
  title,
  initial,
  confirmLabel = "Usar esta foto",
  onCancel,
  onConfirm,
}: {
  src: string;
  title?: string;
  initial?: Crop | null;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (c: Crop) => Promise<void> | void;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const [nat, setNat] = React.useState<{ w: number; h: number } | null>(null);
  const [disp, setDisp] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 });
  // posição em pixels de exibição: canto do quadrado e lado
  const [sq, setSq] = React.useState<{ x: number; y: number; s: number } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const drag = React.useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const minSide = Math.min(disp.w, disp.h);
  const clamp = React.useCallback(
    (x: number, y: number, s: number) => {
      const side = Math.max(minSide * 0.25, Math.min(minSide, s));
      return { s: side, x: Math.max(0, Math.min(disp.w - side, x)), y: Math.max(0, Math.min(disp.h - side, y)) };
    },
    [disp, minSide],
  );

  function onLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const im = e.currentTarget;
    const n = { w: im.naturalWidth, h: im.naturalHeight };
    const maxW = Math.min(window.innerWidth - 64, 720), maxH = window.innerHeight - 260;
    const k = Math.min(maxW / n.w, maxH / n.h, 1.6);
    const d = { w: Math.round(n.w * k), h: Math.round(n.h * k) };
    setNat(n);
    setDisp(d);
    const m = Math.min(d.w, d.h);
    if (initial) {
      const s = initial.w * d.w;
      setSq({ s: Math.min(m, s), x: initial.l * d.w, y: initial.t * d.h });
    } else setSq({ s: m, x: (d.w - m) / 2, y: (d.h - m) / 2 });
  }

  function zoom(f: number) {
    setSq((q) => {
      if (!q) return q;
      const s = q.s * f;
      const c = clamp(q.x + q.s / 2 - s / 2, q.y + q.s / 2 - s / 2, s);
      return c;
    });
  }

  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && sq) void confirm();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  async function confirm() {
    if (!sq || !disp.w || saving) return;
    setSaving(true);
    try {
      await onConfirm({ l: sq.x / disp.w, t: sq.y / disp.h, w: sq.s / disp.w });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="max-h-full overflow-auto rounded-xl bg-[var(--card,#fff)] p-4 shadow-2xl dark:bg-gray-800">
        <div className="mb-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Enquadramento do post (1:1)</div>
            <div className="text-[12px] text-muted-foreground">
              {title ? `${title} · ` : ""}Arraste o quadrado até o ponto principal. Roda do mouse aproxima ou afasta.
            </div>
          </div>
          <button onClick={onCancel} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>
        <div
          ref={box}
          className="relative mx-auto touch-none overflow-hidden rounded-lg bg-black select-none"
          style={nat ? { width: disp.w, height: disp.h } : { width: 320, height: 320 }}
          onWheel={(e) => zoom(e.deltaY > 0 ? 1.06 : 1 / 1.06)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" referrerPolicy="no-referrer" draggable={false} onLoad={onLoad} className="pointer-events-none block size-full" />
          {!nat ? <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/70">carregando a foto…</div> : null}
          {sq ? (
            <div
              className="absolute cursor-move rounded-sm border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.6)]"
              style={{ left: sq.x, top: sq.y, width: sq.s, height: sq.s }}
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                drag.current = { px: e.clientX, py: e.clientY, x: sq.x, y: sq.y };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                setSq((q) => (q ? clamp(d.x + e.clientX - d.px, d.y + e.clientY - d.py, q.s) : q));
              }}
              onPointerUp={() => (drag.current = null)}
            >
              {/* grade dos terços para ajudar a centralizar */}
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="border border-white/20" />
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => zoom(1.1)} title="Afastar">
            <Minus className="size-4" />
          </Button>
          <input
            type="range"
            min={100}
            max={400}
            value={sq && minSide ? Math.round((minSide / sq.s) * 100) : 100}
            onChange={(e) => {
              const s2 = (minSide * 100) / Number(e.target.value);
              setSq((q) => (q ? clamp(q.x + q.s / 2 - s2 / 2, q.y + q.s / 2 - s2 / 2, s2) : q));
            }}
            className="w-40 accent-violet-500"
            title="Aproximar"
          />
          <Button size="sm" variant="outline" onClick={() => zoom(1 / 1.1)} title="Aproximar">
            <Plus className="size-4" />
          </Button>
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button size="sm" variant="accent" disabled={!sq || saving} onClick={() => void confirm()}>
            {saving ? "Salvando…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
