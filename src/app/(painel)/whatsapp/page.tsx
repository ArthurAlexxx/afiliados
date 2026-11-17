"use client";

/**
 * WhatsApp: espelho da caixa de entrada do nosso número, no visual do WhatsApp.
 * Somente leitura. O nosso grupo fica fixado no topo para acompanhar os posts saindo.
 */
import * as React from "react";
import { ArrowLeft, Check, CheckCheck, FileText, Lock, Mic, Pin, Play, Search, Users } from "lucide-react";
import { api } from "@/lib/client";
import { cn } from "@/lib/utils";
import { waToHtml } from "@/components/wa-preview";

type Msg = { id: string; fromMe: boolean; ts: number; sender: string | null; senderJid: string | null; type: string; text: string; media: boolean; thumb: string | null; quoted: string | null; status: string | null; w: number | null; h: number | null };
type Chat = { jid: string; name: string; pic: string | null; group: boolean; pinned: boolean; ts: number; unread: number; last: Msg | null; role: string | null };

const NAME_COLORS = ["#06cf9c", "#53bdeb", "#ff72a1", "#ffbc38", "#a5b337", "#fc9775", "#d88deb", "#7f66ff", "#25d366", "#e26ab6"];
const colorOf = (s: string) => NAME_COLORS[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % NAME_COLORS.length];
const initials = (n: string) => n.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "#";

function hhmm(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function dayKey(ts: number) {
  return new Date(ts * 1000).toDateString();
}
function dayLabel(ts: number) {
  const d = new Date(ts * 1000), t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return "Hoje";
  if (d.toDateString() === y.toDateString()) return "Ontem";
  if (t.getTime() - d.getTime() < 6 * 86400e3) return d.toLocaleDateString("pt-BR", { weekday: "long" });
  return d.toLocaleDateString("pt-BR");
}
function listTime(ts: number) {
  if (!ts) return "";
  const l = dayLabel(ts);
  return l === "Hoje" ? hhmm(ts) : l;
}

function Avatar({ name, pic, group, size = 49 }: { name: string; pic?: string | null; group?: boolean; size?: number }) {
  const [err, setErr] = React.useState(false);
  if (pic && !err)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={pic} alt="" onError={() => setErr(true)} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full text-white" style={{ width: size, height: size, background: colorOf(name) }}>
      {group ? <Users className="size-[45%] opacity-90" /> : <span className="text-[15px] font-semibold">{initials(name)}</span>}
    </div>
  );
}

function Ticks({ status }: { status: string | null }) {
  const read = /READ|PLAYED|4|5/.test(String(status || ""));
  const delivered = read || /DELIVERY|DELIVERED|3/.test(String(status || ""));
  const Icon = delivered ? CheckCheck : Check;
  return <Icon className={cn("inline size-[15px]", read ? "text-[#53bdeb]" : "text-[#667781] dark:text-[#8696a0]")} />;
}

function preview(m: Msg | null, group: boolean) {
  if (!m) return "";
  const icon = m.type === "image" ? "📷 " : m.type === "video" ? "🎥 " : m.type === "audio" ? "🎤 " : m.type === "sticker" ? "Figurinha" : m.type === "document" ? "📄 " : "";
  const body = (m.text || (m.type === "image" ? "Foto" : m.type === "video" ? "Vídeo" : m.type === "audio" ? "Áudio" : "")).split("\n")[0].replace(/[*_~]/g, "");
  const who = m.fromMe ? "" : group && m.sender ? `${m.sender}: ` : "";
  return `${who}${icon}${body}`;
}

/** Caixa da foto no tamanho padrão do WhatsApp: largura fixa e altura pela proporção (limitada), sem pular de tamanho. */
function Frame({ m, children }: { m: Msg; children: React.ReactNode }) {
  const ratio = m.w && m.h ? Math.min(1.9, Math.max(0.56, m.w / m.h)) : 1;
  return (
    <div className="relative mb-1 w-[330px] max-w-full overflow-hidden rounded-[6px] bg-black/10" style={{ aspectRatio: String(ratio) }}>
      {children}
    </div>
  );
}

function Media({ m }: { m: Msg }) {
  const [full, setFull] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const src = `/api/whatsapp/media?id=${encodeURIComponent(m.id)}`;
  if (m.type === "image")
    return (
      <Frame m={m}>
        {/* miniatura borrada até a foto inteira chegar, no mesmo tamanho */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {m.thumb && !loaded ? <img src={m.thumb} alt="" className="size-full scale-105 object-cover blur-[2px]" /> : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" onLoad={() => setLoaded(true)} className={cn("size-full object-cover", !loaded && "absolute size-0 opacity-0")} />
      </Frame>
    );
  if (m.type === "sticker")
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="lazy" className="size-[150px] object-contain" />;
  if (m.type === "video")
    return full ? (
      <Frame m={m}>
        <video src={src} controls autoPlay className="size-full bg-black object-contain" />
      </Frame>
    ) : (
      <Frame m={m}>
        <button onClick={() => setFull(true)} className="relative block size-full bg-black/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {m.thumb ? <img src={m.thumb} alt="" className="size-full object-cover" /> : null}
          <span className="absolute inset-0 m-auto flex size-12 items-center justify-center rounded-full bg-black/50 text-white"><Play className="ml-0.5 size-6" /></span>
        </button>
      </Frame>
    );
  if (m.type === "audio")
    return (
      <div className="flex min-w-[240px] items-center gap-2 px-1 py-1">
        <Mic className="size-5 shrink-0 text-[#667781]" />
        <audio src={src} controls preload="none" className="h-9 w-full" />
      </div>
    );
  if (m.type === "document")
    return (
      <a href={src} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-[6px] bg-black/5 px-3 py-2.5 dark:bg-white/5">
        <FileText className="size-7 text-[#ff5e5e]" />
        <span className="truncate text-[13px]">{m.text || "Documento"}</span>
      </a>
    );
  return null;
}

function Bubble({ m, group, first }: { m: Msg; group: boolean; first: boolean }) {
  const sticker = m.type === "sticker";
  const showText = m.text && m.type !== "document";
  return (
    <div className={cn("flex px-[6%] md:px-[7%]", m.fromMe ? "justify-end" : "justify-start", first ? "mt-2.5" : "mt-0.5")}>
      <div
        className={cn(
          "relative max-w-[85%] text-[14.2px] leading-[19px] md:max-w-[65%]",
          (m.type === "image" || m.type === "video") && "w-[336px] md:max-w-[336px]",
          sticker ? "" : "rounded-[7.5px] p-[3px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
          !sticker && (m.fromMe ? "bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]" : "bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]"),
          first && !sticker && (m.fromMe ? "rounded-tr-none" : "rounded-tl-none"),
        )}
      >
        {first && !sticker ? (
          <span
            className={cn("absolute top-0 h-[13px] w-[8px]", m.fromMe ? "-right-[8px] text-[#d9fdd3] dark:text-[#005c4b]" : "-left-[8px] text-white dark:text-[#202c33]")}
          >
            <svg viewBox="0 0 8 13" className="size-full fill-current">
              {m.fromMe ? <path d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" /> : <path d="M2.812 1H8v11.193L1.533 3.568C.474 2.156 1.042 1 2.812 1z" />}
            </svg>
          </span>
        ) : null}
        {group && !m.fromMe && first && m.sender ? (
          <div className="px-[6px] pt-[3px] pb-[2px] text-[12.8px] font-medium" style={{ color: colorOf(m.senderJid || m.sender) }}>
            {m.sender}
          </div>
        ) : null}
        {m.quoted ? (
          <div className="mx-[3px] mb-1 line-clamp-3 rounded-[6px] border-l-4 border-[#06cf9c] bg-black/5 px-2 py-1.5 text-[12.8px] text-[#667781] dark:bg-white/5 dark:text-[#8696a0]">
            {m.quoted}
          </div>
        ) : null}
        {m.media ? <Media m={m} /> : null}
        <div className={cn(showText ? "px-[6px] pt-[3px] pb-[6px]" : sticker ? "" : "px-[6px] pb-[3px]")}>
          {showText ? <span className="wa-text break-words whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: waToHtml(m.text) }} /> : null}
          <span className={cn("float-right ml-2 flex translate-y-[5px] items-center gap-1 text-[11px] text-[#667781] dark:text-[#8696a0]", sticker && "rounded-full bg-black/30 px-1.5 text-white", !showText && m.media && !sticker && "-mt-6 mr-1 rounded-full bg-black/30 px-1.5 text-white")}>
            {hhmm(m.ts)}
            {m.fromMe ? <Ticks status={m.status} /> : null}
          </span>
          <span className="clear-both block" />
        </div>
      </div>
    </div>
  );
}

const FILTERS = [
  { k: "all", label: "Tudo" },
  { k: "unread", label: "Não lidas" },
  { k: "groups", label: "Grupos" },
  { k: "contacts", label: "Conversas" },
] as const;

export default function WhatsAppPage() {
  const [chats, setChats] = React.useState<Chat[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]["k"]>("all");
  const [open, setOpen] = React.useState<string | null>(null);
  const [msgs, setMsgs] = React.useState<Msg[] | null>(null);
  const [pic, setPic] = React.useState<string | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const atBottom = React.useRef(true);

  const loadChats = React.useCallback(async () => {
    try {
      const r = await api<{ chats: Chat[] }>("/api/whatsapp");
      setChats(r.chats);
      setError(null);
      setOpen((o) => o ?? (typeof window !== "undefined" && window.innerWidth >= 768 ? r.chats.find((c) => c.pinned)?.jid ?? null : null));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  React.useEffect(() => {
    loadChats();
    const t = setInterval(loadChats, 12_000);
    return () => clearInterval(t);
  }, [loadChats]);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setMsgs(null);
    setPic(null);
    atBottom.current = true;
    const load = async () => {
      try {
        const r = await api<{ messages: Msg[]; pic: string | null }>(`/api/whatsapp/messages?jid=${encodeURIComponent(open)}`);
        if (!alive) return;
        setMsgs((old) => (old && old.length === r.messages.length && old[old.length - 1]?.id === r.messages[r.messages.length - 1]?.id ? old : r.messages));
        setPic(r.pic);
      } catch {
        /* tenta de novo no próximo ciclo */
      }
    };
    load();
    const t = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open]);

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const chat = chats?.find((c) => c.jid === open) || null;
  const shown = (chats || []).filter(
    (c) =>
      (!q || c.name.toLowerCase().includes(q.toLowerCase())) &&
      (filter === "all" || (filter === "unread" && c.unread > 0) || (filter === "groups" && c.group) || (filter === "contacts" && !c.group)),
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold md:text-3xl">WhatsApp</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">As conversas do nosso número, como no app. O nosso grupo fica fixado no topo para acompanhar os posts saindo.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
          <Lock className="size-3.5" /> Só visualização
        </span>
      </div>
      <div className="flex h-[calc(100dvh-14rem)] min-h-[520px] overflow-hidden rounded-2xl border border-[#d1d7db] bg-white text-[#111b21] shadow-[0_10px_40px_-12px_rgba(0,0,0,0.25)] dark:border-[#222d34] dark:bg-[#111b21] dark:text-[#e9edef]">
        {/* lista de conversas */}
        <aside className={cn("flex w-full shrink-0 flex-col border-r border-[#e9edef] md:w-[380px] dark:border-[#222d34]", open && "hidden md:flex")}>
          <header className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="text-[20px] font-bold">Conversas</h2>
            <span className="text-[12px] text-[#667781] dark:text-[#8696a0]">{chats ? `${chats.length}` : ""}</span>
          </header>
          <div className="px-3 pb-2">
            <div className="flex items-center gap-3 rounded-full bg-[#f0f2f5] px-4 py-2 dark:bg-[#202c33]">
              <Search className="size-4 text-[#54656f] dark:text-[#8696a0]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" className="w-full bg-transparent text-[14px] outline-none placeholder:text-[#667781] dark:placeholder:text-[#8696a0]" />
            </div>
          </div>
          <div className="flex gap-2 px-3 pb-2">
            {FILTERS.map((f) => (
              <button
                key={f.k}
                onClick={() => setFilter(f.k)}
                className={cn(
                  "rounded-full px-3 py-1 text-[13.5px]",
                  filter === f.k ? "bg-[#d9fdd3] text-[#008069] dark:bg-[#0a332c] dark:text-[#00a884]" : "bg-[#f0f2f5] text-[#54656f] dark:bg-[#202c33] dark:text-[#8696a0]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {error ? <div className="p-6 text-center text-[13px] text-[#667781]">Não consegui ler o WhatsApp agora: {error}</div> : null}
            {!chats && !error
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-3">
                    <div className="size-[49px] animate-pulse rounded-full bg-[#f0f2f5] dark:bg-[#202c33]" />
                    <div className="h-4 flex-1 animate-pulse rounded bg-[#f0f2f5] dark:bg-[#202c33]" />
                  </div>
                ))
              : null}
            {shown.map((c) => (
              <button
                key={c.jid}
                onClick={() => setOpen(c.jid)}
                className={cn("flex w-full items-center gap-3 px-3 text-left hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]", open === c.jid && "bg-[#f0f2f5] dark:bg-[#2a3942]")}
              >
                <Avatar name={c.name} pic={c.pic} group={c.group} />
                <div className="min-w-0 flex-1 border-b border-[#e9edef] py-3 dark:border-[#222d34]">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[16px]">{c.name}</span>
                    <span className={cn("ml-auto shrink-0 text-[12px]", c.unread ? "text-[#1fa855] dark:text-[#00a884]" : "text-[#667781] dark:text-[#8696a0]")}>{listTime(c.ts)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[14px] text-[#667781] dark:text-[#8696a0]">
                    {c.last?.fromMe ? <Ticks status={c.last.status} /> : null}
                    <span className="truncate">{c.pinned && !c.last ? "Nosso grupo de ofertas" : preview(c.last, c.group)}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      {c.pinned ? <Pin className="size-[15px] rotate-45" /> : null}
                      {c.unread ? <span className="min-w-[20px] rounded-full bg-[#25d366] px-1.5 text-center text-[12px] leading-[20px] font-semibold text-white dark:text-[#111b21]">{c.unread}</span> : null}
                    </span>
                  </div>
                </div>
              </button>
            ))}
            {chats && !shown.length ? <div className="p-6 text-center text-[13px] text-[#667781]">Nenhuma conversa.</div> : null}
          </div>
        </aside>

        {/* conversa aberta */}
        <section className={cn("relative min-w-0 flex-1 flex-col bg-[#efeae2] dark:bg-[#0b141a]", open ? "flex" : "hidden md:flex")}>
          {!chat ? (
            <div className="m-auto max-w-sm px-6 text-center text-[#667781] dark:text-[#8696a0]">
              <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-[#25d366]/15 text-[#25d366]"><Lock className="size-8" /></div>
              <div className="text-[22px] font-light text-[#41525d] dark:text-[#e9edef]">WhatsApp do Radar</div>
              <p className="mt-2 text-[14px]">Escolha uma conversa para ver as mensagens. O nosso grupo fica fixado no topo.</p>
            </div>
          ) : (
            <>
              <header className="z-10 flex items-center gap-3 bg-[#f0f2f5] px-3 py-2.5 dark:bg-[#202c33]">
                <button className="md:hidden" onClick={() => setOpen(null)} aria-label="Voltar"><ArrowLeft className="size-5" /></button>
                <Avatar name={chat.name} pic={pic || chat.pic} group={chat.group} size={40} />
                <div className="min-w-0">
                  <div className="truncate text-[16px]">{chat.name}</div>
                  <div className="truncate text-[13px] text-[#667781] dark:text-[#8696a0]">
                    {chat.pinned ? "Nosso grupo · fixado" : chat.role === "source" ? "Grupo de origem (monitorado)" : chat.group ? "Grupo" : chat.jid.split("@")[0]}
                  </div>
                </div>
              </header>
              <div
                ref={scroller}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                }}
                className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.06)_1px,transparent_0)] [background-size:16px_16px] py-3 dark:bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.04)_1px,transparent_0)]"
              >
                {!msgs ? (
                  <div className="mt-10 text-center text-[13px] text-[#667781]">Carregando mensagens…</div>
                ) : !msgs.length ? (
                  <div className="mt-10 text-center text-[13px] text-[#667781]">Sem mensagens guardadas nessa conversa.</div>
                ) : (
                  msgs.map((m, i) => {
                    const prev = msgs[i - 1];
                    const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts);
                    const first = newDay || !prev || prev.fromMe !== m.fromMe || (!m.fromMe && (prev.senderJid || prev.sender) !== (m.senderJid || m.sender));
                    return (
                      <React.Fragment key={m.id + i}>
                        {newDay ? (
                          <div className="my-3 flex justify-center">
                            <span className="rounded-[7.5px] bg-white px-3 py-1.5 text-[12.5px] text-[#54656f] uppercase shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:bg-[#182229] dark:text-[#8696a0]">{dayLabel(m.ts)}</span>
                          </div>
                        ) : null}
                        <Bubble m={m} group={chat.group} first={first} />
                      </React.Fragment>
                    );
                  })
                )}
              </div>
              <footer className="flex items-center gap-3 bg-[#f0f2f5] px-4 py-3 dark:bg-[#202c33]">
                <div className="flex-1 rounded-full bg-white px-5 py-2.5 text-[14px] text-[#667781] dark:bg-[#2a3942] dark:text-[#8696a0]">
                  Só visualização: as mensagens saem pelo robô
                </div>
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
