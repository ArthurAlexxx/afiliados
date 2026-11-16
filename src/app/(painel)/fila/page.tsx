"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Bot, Check, Send, Trash2, Pencil, X, RotateCcw, Search, Ban, ChevronDown, ImageOff } from "lucide-react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { WaPreview } from "@/components/wa-preview";
import { api, useApi, timeAgo, clockOf } from "@/lib/client";
import { cn } from "@/lib/utils";

type Post = {
  id: number;
  source_name: string;
  original_text: string;
  formatted_text: string;
  has_media: number;
  product_key: string | null;
  status: string;
  reason: string | null;
  attempts: number;
  created_at: string;
  sent_at: string | null;
  data_json: string;
};

const TABS = [
  { key: "sent", label: "Enviados" },
  { key: "queued,sending", label: "Na fila" },
  { key: "skipped,duplicate", label: "Descartados" },
  { key: "failed", label: "Falhas" },
  { key: "all", label: "Todos" },
];

function Tabs({ value, onChange, counts }: { value: string; onChange: (v: string) => void; counts: Record<string, number> }) {
  return (
    <div className="flex w-full gap-1 overflow-x-auto rounded-xl border bg-card p-1 sm:w-fit">
      {TABS.map((t) => {
        const n = t.key === "all" ? null : t.key.split(",").reduce((a, k) => a + (counts[k] || 0), 0);
        const active = value === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              "relative flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span layoutId="tab-pill" transition={{ type: "spring", stiffness: 520, damping: 42 }} className="absolute inset-0 rounded-[9px] bg-muted" />
            )}
            <span className="relative">{t.label}</span>
            {n ? <span className="relative text-[11px] text-muted-foreground tabular-nums">{n}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function PostCard({ p, onChanged }: { p: Post; onChanged: () => void }) {
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(p.formatted_text);
  const [showOrig, setShowOrig] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const act = async (action: string, extra: Record<string, unknown> = {}, msg?: string) => {
    setBusy(action);
    try {
      await api(`/api/posts/${p.id}`, { method: "PATCH", json: { action, ...extra } });
      if (msg) toast.success(msg);
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const del = async () => {
    setBusy("delete");
    try {
      await api(`/api/posts/${p.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const agent = React.useMemo(() => {
    try {
      return (JSON.parse(p.data_json).agent || null) as { approve: boolean; reason: string; by: string; checks: { ok: boolean; label: string }[] } | null;
    } catch {
      return null;
    }
  }, [p.data_json]);

  const conversions = React.useMemo(() => {
    try {
      return (JSON.parse(p.data_json).conversions || []) as { original: string; affiliateUrl?: string; ok: boolean; error?: string }[];
    } catch {
      return [];
    }
  }, [p.data_json]);

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <span className="text-[12px] font-medium text-muted-foreground tabular-nums">#{p.id}</span>
          <span className="truncate text-[13px] font-medium">{p.source_name || "Origem desconhecida"}</span>
          <span className="text-[12px] text-muted-foreground">· {timeAgo(p.created_at)}</span>
          {p.product_key ? <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{p.product_key}</span> : null}
          <div className="ml-auto"><StatusBadge status={p.status} /></div>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            {editing ? (
              <div className="flex flex-col gap-2">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-64 font-mono text-[12.5px]" />
                <div className="flex gap-2">
                  <Button size="sm" loading={busy === "save"} onClick={() => act("save", { formatted_text: text }, "Texto salvo")}>
                    <Check className="size-3.5" /> Salvar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setText(p.formatted_text); }}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <WaPreview text={p.formatted_text} image={p.has_media ? `/api/media/${p.id}` : null} time={clockOf(p.sent_at || p.created_at)} />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            {agent ? (
              <div className={cn("rounded-xl border px-3 py-2.5", agent.approve ? "border-success/30" : "border-danger/30")}>
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                  <Bot className="size-3.5" /> Decisão do agente{agent.by === "claude" ? " (Claude)" : ""}
                </div>
                <div className={cn("mt-1 text-[13px] font-medium", agent.approve ? "text-success" : "text-danger")}>{agent.reason}</div>
                {agent.checks?.length ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {agent.checks.map((c, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        {c.ok ? <Check className="size-3 text-success" /> : <X className="size-3 text-danger" />}
                        {c.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : p.reason ? (
              <div className={cn("rounded-xl px-3 py-2 text-[12.5px]", p.status === "failed" ? "bg-danger/10 text-danger" : "bg-muted text-muted-foreground")}>
                {p.reason}
              </div>
            ) : null}
            {agent && p.status === "failed" && p.reason ? (
              <div className="rounded-xl bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{p.reason}</div>
            ) : null}

            {conversions.length ? (
              <div className="rounded-xl border">
                <div className="border-b px-3 py-2 text-[12px] font-medium text-muted-foreground">Links convertidos</div>
                <ul className="divide-y">
                  {conversions.map((c, i) => (
                    <li key={i} className="px-3 py-2 text-[12px]">
                      <div className="truncate text-muted-foreground line-through decoration-muted-foreground/40">{c.original}</div>
                      <div className={cn("truncate font-medium", c.ok ? "text-success" : "text-danger")}>
                        {c.ok ? c.affiliateUrl : c.error}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <button onClick={() => setShowOrig((v) => !v)} className="flex items-center gap-1 self-start text-[12.5px] font-medium text-muted-foreground hover:text-foreground">
              <ChevronDown className={cn("size-3.5 transition-transform", showOrig && "rotate-180")} />
              Mensagem original
            </button>
            <AnimatePresence initial={false}>
              {showOrig && (
                <motion.pre
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="wa-text overflow-hidden rounded-xl bg-muted px-3 py-2 font-sans text-[12.5px] text-muted-foreground"
                >
                  {p.original_text}
                </motion.pre>
              )}
            </AnimatePresence>

            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              {["queued", "failed"].includes(p.status) && (
                <Button size="sm" loading={busy === "send"} onClick={() => act("send", {}, "Enviado!")}>
                  <Send className="size-3.5" /> Enviar agora
                </Button>
              )}
              {["skipped", "duplicate"].includes(p.status) && (
                <Button size="sm" variant="outline" loading={busy === "send"} onClick={() => act("send", {}, "Enviado!")}>
                  <Send className="size-3.5" /> Postar mesmo assim
                </Button>
              )}
              {["failed", "sent"].includes(p.status) && (
                <Button size="sm" variant="outline" loading={busy === "requeue"} onClick={() => act("requeue", {}, "De volta para a fila")}>
                  <RotateCcw className="size-3.5" /> {p.status === "sent" ? "Reenviar" : "Tentar de novo"}
                </Button>
              )}
              {!editing && p.status !== "sent" && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil className="size-3.5" /> Editar
                </Button>
              )}
              {p.has_media && p.status !== "sent" ? (
                <Button size="sm" variant="ghost" onClick={() => act("media", { removeMedia: true }, "Imagem removida")}>
                  <ImageOff className="size-3.5" /> Sem imagem
                </Button>
              ) : null}
              {p.status === "queued" && (
                <Button size="sm" variant="ghost" loading={busy === "discard"} onClick={() => act("discard", {}, "Descartado")}>
                  <Ban className="size-3.5" /> Descartar
                </Button>
              )}
              <Button size="icon" variant="ghost" className="ml-auto" title="Excluir" loading={busy === "delete"} onClick={del}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

export default function FilaPage() {
  const [tab, setTab] = React.useState("sent");
  const [q, setQ] = React.useState("");
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading, reload } = useApi<{ rows: Post[]; total: number }>(
    `/api/posts?status=${tab}&limit=50${query ? `&q=${encodeURIComponent(query)}` : ""}`,
    10000,
  );
  const { data: stats, reload: reloadStats } = useApi<{ counts: Record<string, number> }>("/api/stats", 10000);

  const refresh = () => {
    reload();
    reloadStats();
  };

  const runQueue = async () => {
    try {
      const r = await api<{ result: string }>("/api/queue", { method: "POST" });
      toast(`Fila: ${r.result}`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader
        title="Posts"
        description="O agente decide sozinho o que vai para o grupo. Aqui você acompanha cada decisão e o motivo."
        actions={
          <Button variant="outline" size="sm" onClick={runQueue}>
            <Send className="size-3.5" /> Processar fila agora
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs value={tab} onChange={setTab} counts={stats?.counts || {}} />
        <div className="relative sm:ml-auto sm:w-64">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          {q && (
            <button className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" onClick={() => setQ("")} aria-label="Limpar">
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {loading && !data ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => <div key={i} className="h-56 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : data?.rows.length ? (
        <div className="flex flex-col gap-3">
          <AnimatePresence mode="popLayout">
            {data.rows.map((p) => <PostCard key={`${p.id}-${p.status}-${p.formatted_text.length}`} p={p} onChanged={refresh} />)}
          </AnimatePresence>
          {data.total > data.rows.length && (
            <p className="py-2 text-center text-[12px] text-muted-foreground">Mostrando {data.rows.length} de {data.total}</p>
          )}
        </div>
      ) : (
        <Card className="flex flex-col items-center px-4 py-14 text-center">
          <div className="text-[14px] font-medium">Nada por aqui</div>
          <p className="mt-1 text-[13px] text-muted-foreground">Quando o agente tomar uma decisão desse tipo, ela aparece aqui.</p>
        </Card>
      )}
    </>
  );
}
