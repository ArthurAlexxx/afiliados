"use client";

/**
 * Shell do painel. Sidebar baseada no componente "Sidebar" (wensity) do 21st.dev:
 * colapsável em trilho de ícones, pílula ativa animada que desliza entre itens e
 * drawer no mobile.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  LogOut,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  {
    label: "Operação",
    items: [
      { href: "/", label: "Visão geral", icon: LayoutDashboard },
      { href: "/fila", label: "Fila de posts", icon: ListOrdered, badgeKey: "pending" as const },
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

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-accent text-[13px] font-bold text-accent-foreground shadow-sm">
        A
      </div>
      {!collapsed && (
        <div className="min-w-0 leading-none">
          <div className="truncate text-[14px] font-semibold tracking-tight">Afiliados</div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">Promo bot · WhatsApp</div>
        </div>
      )}
    </div>
  );
}

function NavItems({ collapsed, onNavigate, pending }: { collapsed: boolean; onNavigate?: () => void; pending: number }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2">
      {NAV.map((section) => (
        <div key={section.label} className="py-1">
          <div className="flex h-[26px] items-end px-[18px] pb-1.5">
            {!collapsed && (
              <span className="text-[10.5px] font-medium tracking-[0.08em] whitespace-nowrap text-muted-foreground uppercase">
                {section.label}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-px px-2">
            {section.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const Icon = item.icon;
              const badge = "badgeKey" in item && item.badgeKey === "pending" && pending > 0 ? pending : null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex w-full items-center gap-2.5 rounded-[10px] px-3 py-[8px] text-[13.5px] font-medium leading-none whitespace-nowrap outline-none select-none",
                    "transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                    active
                      ? "text-foreground"
                      : "text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground",
                  )}
                >
                  {active &&
                    (reduce ? (
                      <span className="pointer-events-none absolute inset-0 rounded-[10px] bg-foreground/[0.06]" />
                    ) : (
                      <motion.span
                        layoutId="active-pill"
                        transition={{ type: "spring", stiffness: 520, damping: 42 }}
                        className="pointer-events-none absolute inset-0 rounded-[10px] bg-foreground/[0.06]"
                      />
                    ))}
                  <Icon
                    className={cn(
                      "relative z-10 size-[18px] shrink-0",
                      active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                    )}
                    strokeWidth={1.75}
                  />
                  {!collapsed && <span className="relative z-10 min-w-0 flex-1 truncate">{item.label}</span>}
                  {!collapsed && badge ? (
                    <span className="relative z-10 rounded-md bg-warning/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-warning tabular-nums">
                      {badge}
                    </span>
                  ) : null}
                  {collapsed && badge ? (
                    <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-warning" />
                  ) : null}
                </Link>
              );
            })}
          </div>
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

function Footer({ collapsed }: { collapsed: boolean }) {
  const { dark, toggle } = useTheme();
  return (
    <div
      className={cn(
        "flex shrink-0 items-center border-t py-3",
        collapsed ? "flex-col gap-1 px-0" : "gap-1 px-3",
      )}
    >
      <button
        onClick={toggle}
        className="flex size-8 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
        aria-label="Alternar tema"
        title="Alternar tema"
      >
        {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
      <form action="/api/auth/logout" method="post" className={cn(!collapsed && "ml-auto")}>
        <button
          className="flex h-8 items-center gap-2 rounded-[10px] px-2 text-[12.5px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
          title="Sair"
        >
          <LogOut className="size-4" />
          {!collapsed && "Sair"}
        </button>
      </form>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [pending, setPending] = React.useState(0);
  const reduce = useReducedMotion();
  const pathname = usePathname();

  React.useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/stats")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && j && setPending(j.counts?.pending || 0))
        .catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Desktop */}
      <nav
        aria-label="Navegação principal"
        style={{ width: collapsed ? 64 : 244, transition: reduce ? "none" : "width 240ms cubic-bezier(0.23,1,0.32,1)" }}
        className="relative hidden h-full shrink-0 flex-col overflow-hidden border-r bg-card md:flex"
      >
        <div className={cn("flex shrink-0 items-center", collapsed ? "h-[60px] justify-center" : "h-[60px] gap-2 px-[16px]")}>
          {collapsed ? (
            <button onClick={() => setCollapsed(false)} aria-label="Expandir menu" className="rounded-[10px] p-1 hover:bg-foreground/[0.05]">
              <Logo collapsed />
            </button>
          ) : (
            <>
              <Logo collapsed={false} />
              <button
                onClick={() => setCollapsed(true)}
                aria-label="Recolher menu"
                className="ml-auto flex size-7 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <PanelLeftClose className="size-[17px]" strokeWidth={1.75} />
              </button>
            </>
          )}
        </div>
        <NavItems collapsed={collapsed} pending={pending} />
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            aria-label="Expandir menu"
            className="mx-auto mb-2 flex size-8 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-foreground/[0.06]"
          >
            <PanelLeftOpen className="size-[17px]" strokeWidth={1.75} />
          </button>
        )}
        <Footer collapsed={collapsed} />
      </nav>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.nav
              className="fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r bg-card md:hidden"
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: reduce ? 0 : 0.26, ease: EASE }}
            >
              <div className="flex h-[60px] items-center px-4">
                <Logo collapsed={false} />
                <button onClick={() => setMobileOpen(false)} className="ml-auto rounded-[10px] p-1.5 hover:bg-foreground/[0.05]" aria-label="Fechar menu">
                  <X className="size-4" />
                </button>
              </div>
              <NavItems collapsed={false} pending={pending} onNavigate={() => setMobileOpen(false)} />
              <Footer collapsed={false} />
            </motion.nav>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 md:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded-[10px] p-1.5 hover:bg-foreground/[0.05]" aria-label="Abrir menu">
            <Menu className="size-5" />
          </button>
          <Logo collapsed={false} />
        </header>
        <main className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>
      </div>
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
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
