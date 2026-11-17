import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "outline" | "ghost" | "danger" | "accent";
type Size = "sm" | "md" | "icon";

// botões do Mosaic: escuro (principal), branco com borda, violeta (destaque)
const variants: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-gray-800 dark:hover:bg-white shadow-xs",
  outline: "border-border bg-card text-foreground hover:border-gray-300 dark:hover:border-gray-600 shadow-xs",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  danger: "bg-danger text-white hover:brightness-95 shadow-xs",
  accent: "bg-accent text-accent-foreground hover:bg-accent-strong shadow-xs",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  icon: "size-8",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent font-medium leading-5 whitespace-nowrap outline-none select-none",
        "transition duration-150",
        "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
