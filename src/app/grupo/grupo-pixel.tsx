"use client";

import Script from "next/script";
import * as React from "react";

type Fbq = ((...a: unknown[]) => void) & { callMethod?: unknown; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };

/**
 * Pixel do Meta da landing page. Sem ID configurado, não carrega nada.
 * PageView ao abrir; Lead em todo clique num botão `[data-lead]` (o anúncio
 * pode otimizar por quem clicou em entrar, não só por quem abriu a página).
 */
export function GrupoPixel({ pixelId }: { pixelId: string }) {
  React.useEffect(() => {
    if (!pixelId) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("[data-lead]");
      const fbq = (window as unknown as { fbq?: Fbq }).fbq;
      if (a && fbq) fbq("track", "Lead", { content_name: "grupo-whatsapp" });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [pixelId]);

  if (!/^\d{5,20}$/.test(pixelId)) return null;
  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`}
    </Script>
  );
}
