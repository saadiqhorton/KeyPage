import { type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "md" | "sm";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-brass/40 bg-brass/15 text-text hover:bg-brass/25 disabled:hover:bg-brass/15",
  secondary:
    "border border-hairline bg-surface/60 text-text hover:bg-surface disabled:hover:bg-surface/60",
  ghost:
    "border border-transparent text-muted hover:border-hairline hover:bg-surface/40 hover:text-text disabled:hover:bg-transparent disabled:hover:text-muted",
  danger:
    "border border-danger/50 bg-danger/15 text-text hover:bg-danger/25 disabled:hover:bg-danger/15",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "px-4 py-2.5 text-sm",
  sm: "px-3 py-1.5 text-xs",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "pressable inline-flex items-center justify-center gap-2 rounded-sm font-medium tracking-wide",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass/70",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : null}
      {children}
    </button>
  );
}
