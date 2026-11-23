"use client";

import * as React from "react";

/**
 * Vitrine em carrossel: rola pro lado (scroll-snap) em vez de empilhar, que é a
 * regra da Supercopa pra conteúdo que não cabe. Setas só no desktop; no celular
 * é o dedo. Sem JS a lista continua rolável.
 */
export function GrupoCarrossel({ children }: { children: React.ReactNode }) {
  const trilho = React.useRef<HTMLUListElement>(null);
  const [pontas, setPontas] = React.useState({ ini: true, fim: false });

  const medir = React.useCallback(() => {
    const t = trilho.current;
    if (!t) return;
    setPontas({ ini: t.scrollLeft <= 4, fim: t.scrollLeft + t.clientWidth >= t.scrollWidth - 4 });
  }, []);

  React.useEffect(() => {
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [medir]);

  const passo = (dir: 1 | -1) => {
    const t = trilho.current;
    if (!t) return;
    const item = t.querySelector("li");
    const w = item ? item.getBoundingClientRect().width + 20 : t.clientWidth * 0.8;
    t.scrollBy({ left: dir * w, behavior: "smooth" });
  };

  return (
    <div className="lp-carrossel">
      <ul className="lp-chat" ref={trilho} onScroll={medir}>
        {children}
      </ul>
      <div className="lp-carrossel__setas">
        <button type="button" className="lp-carrossel__seta" onClick={() => passo(-1)} disabled={pontas.ini} aria-label="Promoção anterior">
          <span aria-hidden="true">←</span>
        </button>
        <button type="button" className="lp-carrossel__seta" onClick={() => passo(1)} disabled={pontas.fim} aria-label="Próxima promoção">
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
