"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { QrCode, Smartphone, RefreshCw, CheckCircle2, LogOut, KeyRound, Copy } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";

type Status = { configured: boolean; state?: string; error?: string };
type ConnectResult = { base64?: string; code?: string; pairingCode?: string; state?: string; created?: boolean };

const STATE_LABEL: Record<string, string> = {
  open: "Conectado",
  connecting: "Aguardando leitura",
  close: "Desconectado",
};

export default function ConexaoPage() {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [qr, setQr] = React.useState<ConnectResult | null>(null);
  const [number, setNumber] = React.useState("");
  const [mode, setMode] = React.useState<"qr" | "code">("qr");
  const [loading, setLoading] = React.useState(false);
  const [seconds, setSeconds] = React.useState(0);

  const loadStatus = React.useCallback(async () => {
    try {
      const s = await api<Status>("/api/evolution");
      setStatus(s);
      if (s.state === "open") setQr(null);
      return s;
    } catch {
      return null;
    }
  }, []);

  React.useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // enquanto há QR na tela: checa a conexão a cada 3s e renova o QR a cada 40s
  React.useEffect(() => {
    if (!qr) return;
    const poll = setInterval(async () => {
      const s = await loadStatus();
      if (s?.state === "open") toast.success("WhatsApp conectado!");
    }, 3000);
    const tick = setInterval(() => setSeconds((x) => x + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [qr, loadStatus]);

  React.useEffect(() => {
    if (qr && seconds >= 40) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  const generate = async () => {
    setLoading(true);
    setSeconds(0);
    try {
      const r = await api<ConnectResult>("/api/evolution", {
        method: "POST",
        json: { action: "connect", number: mode === "code" ? number : undefined },
      });
      if (r.state === "open") {
        toast.success("Esse número já está conectado");
        setQr(null);
        loadStatus();
      } else {
        if (r.created) toast.success("Instância criada na Evolution API");
        setQr(r);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      await api("/api/evolution", { method: "POST", json: { action: "logout" } });
      toast.success("Desconectado");
      loadStatus();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const connected = status?.state === "open";
  const qrSrc = qr?.base64 ? (qr.base64.startsWith("data:") ? qr.base64 : `data:image/png;base64,${qr.base64}`) : null;

  return (
    <>
      <PageHeader title="Conectar WhatsApp" description="Conecte o número do WhatsApp Business na sua instância da Evolution API." />

      {!status ? (
        <div className="h-96 animate-pulse rounded-2xl bg-muted" />
      ) : !status.configured ? (
        <Card className="px-6 py-12 text-center">
          <div className="text-[14px] font-medium">Configure a Evolution API primeiro</div>
          <p className="mt-1 text-[13px] text-muted-foreground">Informe URL, API key e o nome da instância (se ela não existir, eu crio).</p>
          <Link href="/configuracoes"><Button size="sm" className="mt-4">Ir para Integrações</Button></Link>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card>
            <CardHeader
              title="Status da instância"
              action={
                <Badge tone={connected ? "success" : status.error ? "danger" : "warning"} dot>
                  {status.error ? "Erro" : STATE_LABEL[status.state || ""] || status.state || "—"}
                </Badge>
              }
            />
            <CardContent className="flex flex-col gap-4">
              {status.error && <div className="rounded-xl bg-muted px-3 py-2 text-[12.5px] text-muted-foreground">{status.error}</div>}

              <div className="flex rounded-[10px] border bg-background p-0.5">
                {([
                  { k: "qr", label: "QR code", icon: QrCode },
                  { k: "code", label: "Código de pareamento", icon: KeyRound },
                ] as const).map((t) => (
                  <button
                    key={t.k}
                    onClick={() => setMode(t.k)}
                    className={cn("relative flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] font-medium", mode === t.k ? "text-foreground" : "text-muted-foreground")}
                  >
                    {mode === t.k && <motion.span layoutId="conn-mode" className="absolute inset-0 rounded-[8px] bg-muted" transition={{ type: "spring", stiffness: 520, damping: 42 }} />}
                    <t.icon className="relative size-3.5" />
                    <span className="relative">{t.label}</span>
                  </button>
                ))}
              </div>

              {mode === "code" && (
                <Field label="Número do WhatsApp" hint="Com DDI e DDD, só números. Ex: 5511999998888">
                  <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="5511999998888" inputMode="numeric" />
                </Field>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={generate} loading={loading} disabled={connected || (mode === "code" && number.replace(/\D/g, "").length < 12)}>
                  {!loading && <RefreshCw className="size-4" />}
                  {mode === "qr" ? "Gerar QR code" : "Gerar código"}
                </Button>
                {connected && (
                  <Button variant="outline" onClick={logout}>
                    <LogOut className="size-4" /> Desconectar
                  </Button>
                )}
              </div>

              <ol className="flex flex-col gap-2 rounded-xl bg-muted/60 p-4 text-[12.5px] text-muted-foreground">
                <li>1. No celular, abra o <b className="text-foreground">WhatsApp Business</b>.</li>
                <li>2. Toque em <b className="text-foreground">⋮ / Configurações → Dispositivos conectados → Conectar dispositivo</b>.</li>
                <li>
                  3.{" "}
                  {mode === "qr" ? (
                    <>Aponte a câmera para o QR code ao lado.</>
                  ) : (
                    <>Toque em <b className="text-foreground">Conectar com número de telefone</b> e digite o código ao lado.</>
                  )}
                </li>
                <li>4. Depois de conectado, vá em <Link href="/grupos" className="font-medium text-foreground underline underline-offset-2">Grupos</Link> e sincronize.</li>
              </ol>
            </CardContent>
          </Card>

          <Card className="flex min-h-[380px] items-center justify-center p-6">
            <AnimatePresence mode="wait">
              {connected ? (
                <motion.div key="ok" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center text-center">
                  <div className="flex size-16 items-center justify-center rounded-2xl bg-success/10">
                    <CheckCircle2 className="size-8 text-success" />
                  </div>
                  <div className="mt-4 text-[16px] font-semibold">WhatsApp conectado</div>
                  <p className="mt-1 text-[13px] text-muted-foreground">O robô já pode ler os grupos e postar no seu grupo.</p>
                  <Link href="/grupos"><Button size="sm" variant="outline" className="mt-4">Sincronizar grupos</Button></Link>
                </motion.div>
              ) : qr && (qrSrc || qr.pairingCode) ? (
                <motion.div key="qr" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center text-center">
                  {mode === "code" && qr.pairingCode ? (
                    <>
                      <div className="text-[13px] text-muted-foreground">Código de pareamento</div>
                      <div className="mt-3 rounded-2xl border bg-background px-6 py-4 font-mono text-[34px] font-semibold tracking-[0.25em]">
                        {qr.pairingCode.replace(/(.{4})(?=.)/, "$1-")}
                      </div>
                      <Button size="sm" variant="ghost" className="mt-3" onClick={() => navigator.clipboard.writeText(qr.pairingCode!).then(() => toast.success("Copiado"))}>
                        <Copy className="size-3.5" /> Copiar
                      </Button>
                    </>
                  ) : qrSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrSrc} alt="QR code do WhatsApp" className="size-72 rounded-2xl border bg-white p-3" />
                  ) : (
                    <p className="text-[13px] text-muted-foreground">A Evolution não devolveu código de pareamento. Tente o QR code.</p>
                  )}
                  <div className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground">
                    <span className="size-1.5 animate-pulse rounded-full bg-warning" />
                    Aguardando leitura · renova em {Math.max(0, 40 - seconds)}s
                  </div>
                </motion.div>
              ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center text-center">
                  <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
                    {mode === "qr" ? <QrCode className="size-7 text-muted-foreground" /> : <Smartphone className="size-7 text-muted-foreground" />}
                  </div>
                  <div className="mt-4 text-[14px] font-medium">{mode === "qr" ? "Gere o QR code" : "Gere o código"}</div>
                  <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">Ele aparece aqui e se renova sozinho até o WhatsApp conectar.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </div>
      )}
    </>
  );
}
