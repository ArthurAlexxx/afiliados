import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info",
  accent: "bg-accent/60 text-accent-foreground",
} as const;

export function Badge({
  tone = "neutral",
  children,
  className,
  dot,
}: {
  tone?: keyof typeof tones;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-5 whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export const STATUS: Record<string, { label: string; tone: keyof typeof tones }> = {
  queued: { label: "Na fila", tone: "info" },
  sending: { label: "Enviando", tone: "info" },
  sent: { label: "Enviado", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  skipped: { label: "Descartado pelo agente", tone: "neutral" },
  duplicate: { label: "Duplicado", tone: "neutral" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] || { label: status, tone: "neutral" as const };
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}
