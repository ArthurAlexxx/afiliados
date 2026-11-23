"use client";

import * as React from "react";

/** Botão fixo do celular: entra quando o botão do hero sai da tela, e sai quando o CTA final aparece. */
export function GrupoFixo({ children }: { children: React.ReactNode }) {
  const [visivel, setVisivel] = React.useState(false);
  React.useEffect(() => {
    const alvos = [document.querySelector("[data-hero-cta]"), document.getElementById("entrar")].filter(Boolean) as Element[];
    if (!alvos.length) return setVisivel(true);
    const vendo = new Set<Element>();
    const io = new IntersectionObserver((es) => {
      for (const e of es) e.isIntersecting ? vendo.add(e.target) : vendo.delete(e.target);
      setVisivel(vendo.size === 0);
    });
    alvos.forEach((a) => io.observe(a));
    return () => io.disconnect();
  }, []);
  return (
    <div className="lp-fixo" data-visivel={visivel ? "" : undefined} inert={!visivel}>
      {children}
    </div>
  );
}
