import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-gray-400/20 text-gray-600 dark:text-gray-300",
  success: "bg-green-500/20 text-green-700 dark:text-green-400",
  warning: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
  danger: "bg-red-500/20 text-red-700 dark:text-red-400",
  info: "bg-sky-500/20 text-sky-700 dark:text-sky-400",
  accent: "bg-violet-500/20 text-violet-700 dark:text-violet-300",
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
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap",
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
  photo: { label: "Esperando foto", tone: "warning" },
  review: { label: "Para aprovar", tone: "warning" },
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
