"use client";

/**
 * Shell do painel no estilo do template Mosaic (cruip/tailwind-dashboard-template):
 * barra lateral branca com cantos arredondados, item ativo com faixa violeta, cabeçalho
 * fixo com sino de posts esperando foto, tema claro/escuro e conta.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WaitingWatch } from "./waiting-watch";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  LayoutDashboard,
  ListOrdered,
  Users,
  QrCode,
  FileText,
  Settings,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Moon,
  Sun,
  X,
  Sparkles,
  Gauge,
  Bell,
  ChevronDown,
  BadgeDollarSign,
  Images,
  MessageCircle,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  {
    label: "Operação",
    items: [
      { href: "/", label: "Visão geral", icon: LayoutDashboard },
      { href: "/curadoria", label: "Curadoria", icon: Sparkles },
      { href: "/precos", label: "Preços", icon: BadgeDollarSign },
      { href: "/mercado", label: "Estudo de Mercado", icon: TrendingUp },
      { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
      { href: "/fila", label: "Posts", icon: ListOrdered },
      { href: "/fotos", label: "Fotos dos perfumes", icon: Images },
      { href: "/scraping", label: "Scraping e API", icon: Gauge },
      { href: "/grupos", label: "Grupos", icon: Users },
      { href: "/conexao", label: "Conectar WhatsApp", icon: QrCode },
    ],
  },
  {
    label: "Configuração",
    items: [
      { href: "/template", label: "Template e teste", icon: FileText },
      { href: "/configuracoes", label: "Integrações e regras", icon: Settings },
      { href: "/logs", label: "Logs", icon: ScrollText },
    ],
  },
];

const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

/** Logo no lugar do símbolo do Mosaic: quadrado violeta com a inicial. */
function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white shadow-xs">A</span>
      {!collapsed && (
        <span className="min-w-0 leading-none">
          <span className="block truncate text-[15px] font-bold text-foreground">Afiliados</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">Promoções no WhatsApp</span>
        </span>
      )}
    </Link>
  );
}

function NavItems({ collapsed, onNavigate, waiting }: { collapsed: boolean; onNavigate?: () => void; waiting: number }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  return (
    <div className="scroll-thin min-h-0 flex-1 space-y-8 overflow-x-hidden overflow-y-auto">
      {NAV.map((section) => (
        <div key={section.label}>
          <h3 className="pl-3 text-xs font-semibold text-gray-400 uppercase dark:text-gray-500">
            {collapsed ? <span className="block w-6 text-center" aria-hidden="true">•••</span> : section.label}
          </h3>
          <ul className="mt-3">
            {section.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const Icon = item.icon;
              const badge = item.href === "/fila" && waiting > 0 ? waiting : null;
              return (
                <li key={item.href} className="relative mb-0.5 last:mb-0">
                  {active &&
                    (reduce ? (
                      <span className="pointer-events-none absolute inset-0 rounded-lg bg-linear-to-r from-violet-500/[0.12] to-violet-500/[0.04] dark:from-violet-500/[0.24]" />
                    ) : (
                      <motion.span
                        layoutId="active-pill"
                        transition={{ type: "spring", stiffness: 520, damping: 42 }}
                        className="pointer-events-none absolute inset-0 rounded-lg bg-linear-to-r from-violet-500/[0.12] to-violet-500/[0.04] dark:from-violet-500/[0.24]"
                      />
                    ))}
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center rounded-lg py-2 pr-3 pl-4 text-sm font-medium whitespace-nowrap outline-none transition duration-150",
                      "focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                      active ? "text-gray-800 dark:text-gray-100" : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-violet-500" : "text-gray-400 dark:text-gray-500")} strokeWidth={2} />
                    {!collapsed && <span className="ml-4 min-w-0 flex-1 truncate">{item.label}</span>}
                    {!collapsed && badge ? (
                      <span className="ml-2 rounded-sm bg-violet-400 px-2 text-xs font-medium text-white tabular-nums">{badge}</span>
                    ) : null}
                    {collapsed && badge ? <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-violet-500" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function useTheme() {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  };
  return { dark, toggle };
}

/** Lista dos posts esperando foto, ouvida do aviso em tempo real (WaitingWatch). */
function useWaiting() {
  const [rows, setRows] = React.useState<{ id: number; name: string }[]>([]);
  React.useEffect(() => {
    const on = (e: Event) => setRows(((e as CustomEvent).detail || []) as { id: number; name: string }[]);
    window.addEventListener("waiting-photos", on);
    return () => window.removeEventListener("waiting-photos", on);
  }, []);
  return rows;
}

const ROUND_BTN =
  "flex size-8 items-center justify-center rounded-full text-gray-500/80 hover:bg-gray-200 dark:text-gray-400/80 dark:hover:bg-gray-800";

function Header({ onMenu, waiting }: { onMenu: () => void; waiting: { id: number; name: string }[] }) {
  const { dark, toggle } = useTheme();
  const [open, setOpen] = React.useState<null | "bell" | "user">(null);
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }
  return (
    <header className="sticky top-0 z-30 before:absolute before:inset-0 before:-z-10 before:backdrop-blur-md max-lg:shadow-xs max-lg:before:bg-white/90 lg:before:bg-gray-100/90 dark:max-lg:before:bg-gray-800/90 dark:lg:before:bg-gray-900/90">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between border-gray-200 lg:border-b dark:border-gray-700/60">
          <button onClick={onMenu} className="text-gray-500 hover:text-gray-600 lg:hidden dark:hover:text-gray-400" aria-label="Abrir menu">
            <Menu className="size-6" />
          </button>
          <div className="hidden lg:block" />
          <div ref={box} className="flex items-center gap-3">
            <div className="relative">
              <button onClick={() => setOpen(open === "bell" ? null : "bell")} className={cn(ROUND_BTN, "relative", open === "bell" && "bg-gray-200 dark:bg-gray-800")} aria-label="Posts esperando foto">
                <Bell className="size-4" />
                {waiting.length ? (
                  <span className="absolute top-0 right-0 flex size-4 items-center justify-center rounded-full border-2 border-gray-100 bg-red-500 text-[9px] font-bold text-white dark:border-gray-900">
                    {waiting.length}
                  </span>
                ) : null}
              </button>
              {open === "bell" && (
                <div className="absolute top-full right-0 z-10 mt-1 w-80 overflow-hidden rounded-lg border border-gray-200 bg-white py-1.5 shadow-lg dark:border-gray-700/60 dark:bg-gray-800">
                  <div className="px-4 pt-1.5 pb-2 text-xs font-semibold text-gray-400 uppercase dark:text-gray-500">Esperando foto</div>
                  {waiting.length ? (
                    waiting.slice(0, 8).map((w) => (
                      <Link
                        key={w.id}
                        href="/fila"
                        onClick={() => setOpen(null)}
                        className="block border-b border-gray-200 px-4 py-2 text-sm last:border-0 hover:bg-gray-50 dark:border-gray-700/60 dark:hover:bg-gray-700/20"
                      >
                        <span className="font-medium text-gray-800 dark:text-gray-100">📸 {w.name}</span>
                        <span className="block text-xs text-gray-500">Escolha a foto para o post sair</span>
                      </Link>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-sm text-gray-500">Nenhum post esperando foto.</div>
                  )}
                </div>
              )}
            </div>
            <button onClick={toggle} className={ROUND_BTN} aria-label="Alternar tema" title="Claro / escuro">
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <hr className="h-6 w-px border-none bg-gray-200 dark:bg-gray-700/60" />
            <div className="relative">
              <button onClick={() => setOpen(open === "user" ? null : "user")} className="group flex items-center gap-2" aria-label="Conta">
                <span className="flex size-8 items-center justify-center rounded-full bg-violet-500/20 text-sm font-semibold text-violet-600 dark:text-violet-300">A</span>
                <span className="hidden truncate text-sm font-medium text-gray-600 group-hover:text-gray-800 md:block dark:text-gray-100 dark:group-hover:text-white">Arthur</span>
                <ChevronDown className="hidden size-3 text-gray-400 md:block" />
              </button>
              {open === "user" && (
                <div className="absolute top-full right-0 z-10 mt-1 min-w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1.5 shadow-lg dark:border-gray-700/60 dark:bg-gray-800">
                  <div className="mb-1 border-b border-gray-200 px-3 pt-0.5 pb-2 dark:border-gray-700/60">
                    <div className="font-medium text-gray-800 dark:text-gray-100">Arthur</div>
                    <div className="text-xs text-gray-500 italic">Administrador</div>
                  </div>
                  <Link href="/configuracoes" onClick={() => setOpen(null)} className="flex px-3 py-1 text-sm font-medium text-violet-500 hover:text-violet-600">
                    Configurações
                  </Link>
                  <button onClick={logout} className="flex px-3 py-1 text-sm font-medium text-violet-500 hover:text-violet-600">
                    Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

/** Barra de baixo no celular (app instalado): o que o Arthur usa no dia a dia, a um toque. */
function BottomBar({ waiting, onMenu }: { waiting: number; onMenu: () => void }) {
  const pathname = usePathname();
  const items = [
    { href: "/fila", label: "Posts", icon: ListOrdered, badge: waiting },
    { href: "/fotos", label: "Fotos", icon: Images },
    { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle },
    { href: "/", label: "Início", icon: LayoutDashboard },
  ];
  return (
    <nav
      aria-label="Atalhos"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden dark:border-gray-700/60 dark:bg-gray-800/95"
    >
      <div className="grid grid-cols-5">
        {items.map((it) => {
          const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
          const Icon = it.icon;
          return (
            <Link key={it.href} href={it.href} className={cn("relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", active ? "text-violet-500" : "text-gray-500 dark:text-gray-400")}>
              <Icon className="size-[22px]" />
              {it.label}
              {it.badge ? (
                <span className="absolute top-1.5 left-1/2 ml-2 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] leading-[18px] font-bold text-white tabular-nums">{it.badge}</span>
              ) : null}
            </Link>
          );
        })}
        <button onClick={onMenu} className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
          <Menu className="size-[22px]" />
          Mais
        </button>
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const reduce = useReducedMotion();
  const waiting = useWaiting();

  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebar-collapsed") === "1");
    } catch {}
  }, []);
  const setCol = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem("sidebar-collapsed", v ? "1" : "0");
    } catch {}
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <WaitingWatch />
      {/* Barra lateral (computador) */}
      <nav
        aria-label="Navegação principal"
        style={{ width: collapsed ? 80 : 256, transition: reduce ? "none" : "width 200ms ease-in-out" }}
        className="relative hidden h-full shrink-0 flex-col rounded-r-2xl bg-card p-4 shadow-xs lg:flex"
      >
        <div className={cn("mb-10 flex shrink-0 items-center", collapsed ? "justify-center" : "pr-3 sm:px-2")}>
          <Logo collapsed={collapsed} />
        </div>
        <NavItems collapsed={collapsed} waiting={waiting.length} />
        <div className="mt-auto flex justify-end pt-3">
          <button
            onClick={() => setCol(!collapsed)}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            className="px-3 py-2 text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
          >
            {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
          </button>
        </div>
      </nav>

      {/* Gaveta (celular) */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-gray-900/30 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.nav
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col rounded-r-2xl bg-card p-4 shadow-xs lg:hidden"
              initial={{ x: -272 }}
              animate={{ x: 0 }}
              exit={{ x: -272 }}
              transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
            >
              <div className="mb-10 flex items-center justify-between pr-3 sm:px-2">
                <Logo collapsed={false} />
                <button onClick={() => setMobileOpen(false)} className="text-gray-500 hover:text-gray-400" aria-label="Fechar menu">
                  <X className="size-5" />
                </button>
              </div>
              <NavItems collapsed={false} waiting={waiting.length} onNavigate={() => setMobileOpen(false)} />
            </motion.nav>
          </>
        )}
      </AnimatePresence>

      <div className="scroll-thin relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <Header onMenu={() => setMobileOpen(true)} waiting={waiting} />
        <main className="grow">
          <div className="mx-auto w-full max-w-[96rem] px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
      <BottomBar waiting={waiting.length} onMenu={() => setMobileOpen(true)} />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 sm:mb-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-gray-800 md:text-3xl dark:text-gray-100">{title}</h1>
        {description ? <p className="mt-1 hidden max-w-2xl text-sm text-muted-foreground sm:block">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">{actions}</div> : null}
    </div>
  );
}
