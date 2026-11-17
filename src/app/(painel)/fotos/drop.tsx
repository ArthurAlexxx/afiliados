"use client";

import * as React from "react";
import { ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

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

export function DropPhoto({ productId, onAdded, compact }: { productId: number; onAdded: () => void; compact?: boolean }) {
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
