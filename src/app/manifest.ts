import type { MetadataRoute } from "next";

/** App no celular (PWA): abre direto em Posts, em tela cheia. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "2R PROMOS · Painel",
    short_name: "2R PROMOS",
    description: "Aprovar posts, escolher fotos e acompanhar a fila do grupo",
    start_url: "/fila",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3f4f6",
    theme_color: "#8470ff",
    lang: "pt-BR",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Para aprovar", url: "/fila", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Fotos dos perfumes", url: "/fotos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
