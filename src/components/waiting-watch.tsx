"use client";

import * as React from "react";
import { toast } from "sonner";

type W = { post: number; id: number; name: string };

/** Bipe curto (sem arquivo de som). */
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    for (const [f, t] of [[880, 0], [1320, 0.18]] as const) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.15, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.17);
    }
  } catch {}
}

/**
 * Em qualquer tela do painel: chegou post esperando foto → bipe, aviso e contador no título da aba.
 * Também avisa a tela de fotos (evento "waiting-photos") para ela se atualizar sozinha.
 */
export function WaitingWatch() {
  const seen = React.useRef<Set<number> | null>(null);
  React.useEffect(() => {
    let alive = true;
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    const load = async () => {
      try {
        const r = await fetch("/api/fotos/waiting");
        if (!r.ok) return;
        const { rows } = (await r.json()) as { rows: W[] };
        if (!alive) return;
        const ids = new Set(rows.map((x) => x.post));
        const fresh = seen.current ? rows.filter((x) => !seen.current!.has(x.post)) : [];
        seen.current = ids;
        document.title = rows.length ? `(${rows.length}) ${base}` : base;
        window.dispatchEvent(new CustomEvent("waiting-photos", { detail: rows }));
        if (fresh.length) {
          beep();
          for (const x of fresh)
            toast.warning(`Post esperando foto: ${x.name}`, {
              duration: 15000,
              action: { label: "Escolher", onClick: () => (window.location.href = "/fotos") },
            });
        }
      } catch {}
    };
    load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return null;
}
