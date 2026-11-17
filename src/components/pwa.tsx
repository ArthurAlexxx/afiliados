"use client";

import * as React from "react";
import { BellRing, Download, X } from "lucide-react";
import { toast } from "sonner";

/** Registra o service worker (app no celular e avisos). */
export function PwaRegister() {
  React.useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}

function b64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type BIP = Event & { prompt: () => Promise<void> };

/**
 * Cartão no topo de Posts, só no celular: instalar o app e ligar os avisos
 * (perfume novo para aprovar, fotos que chegaram). Some quando já está tudo ligado.
 */
export function PhoneSetup() {
  const [state, setState] = React.useState<"loading" | "off" | "on" | "denied" | "unsupported">("loading");
  const [install, setInstall] = React.useState<BIP | null>(null);
  const [standalone, setStandalone] = React.useState(true);
  const [ios, setIos] = React.useState(false);
  const [hidden, setHidden] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    try {
      setHidden(localStorage.getItem("phone-setup-hidden") === "1");
    } catch {}
    setStandalone(matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onBip = (e: Event) => {
      e.preventDefault();
      setInstall(e as BIP);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const { publicKey } = await fetch("/api/push").then((r) => r.json());
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
      await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), test: true }) });
      setState("on");
      toast.success("Avisos ligados neste celular");
    } catch (e) {
      toast.error(`Não deu para ligar os avisos: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const needInstall = !standalone;
  const needPush = state === "off";
  if (hidden || state === "loading" || (!needInstall && !needPush)) return null;
  // no iPhone os avisos só funcionam com o app instalado na tela de início
  const iosNoPush = ios && !standalone;

  return (
    <div className="relative mb-4 rounded-2xl border border-violet-500/25 bg-violet-500/[0.07] p-4 lg:hidden">
      <button
        className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground"
        aria-label="Esconder"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem("phone-setup-hidden", "1");
          } catch {}
        }}
      >
        <X className="size-4" />
      </button>
      <div className="pr-6 text-[14px] font-semibold">Use o painel como app no celular</div>
      <div className="mt-2 space-y-2.5 text-[13px] text-muted-foreground">
        {needInstall ? (
          install ? (
            <button onClick={() => install.prompt().then(() => setInstall(null))} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 px-3 py-2.5 font-semibold text-white">
              <Download className="size-4" /> Instalar o app
            </button>
          ) : ios ? (
            <p>
              <b className="text-foreground">Instalar:</b> toque em Compartilhar (o quadrado com a seta) e depois em <b className="text-foreground">Adicionar à Tela de Início</b>.
            </p>
          ) : (
            <p>
              <b className="text-foreground">Instalar:</b> abra o menu do navegador (⋮) e toque em <b className="text-foreground">Instalar app</b> ou <b className="text-foreground">Adicionar à tela inicial</b>.
            </p>
          )
        ) : null}
        {needPush && !iosNoPush ? (
          <button disabled={busy} onClick={() => void enable()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-500/40 bg-card px-3 py-2.5 font-semibold text-foreground">
            <BellRing className="size-4 text-violet-500" /> {busy ? "Ligando…" : "Ligar avisos: perfume para aprovar e fotos que chegaram"}
          </button>
        ) : needPush && iosNoPush ? (
          <p>Depois de instalar, abra pelo ícone e ligue os avisos aqui.</p>
        ) : null}
        {state === "denied" ? <p>Os avisos estão bloqueados para este site. Libere nas configurações do navegador para receber.</p> : null}
      </div>
    </div>
  );
}
