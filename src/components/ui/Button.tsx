import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "accent" | "surface" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-[var(--accent-tomato)] text-[var(--on-tomato)] hover:brightness-105",
  secondary: "bg-[var(--accent-teal)] text-[var(--on-teal)] hover:brightness-105",
  accent: "bg-[var(--accent-mustard)] text-[var(--on-mustard)] hover:brightness-105",
  surface:
    "bg-[var(--bg-surface)] text-[var(--text-ink)] hover:bg-[var(--bg-surface-alt)]",
  ghost:
    "bg-transparent text-[var(--text-ink)] shadow-none border-transparent hover:bg-[var(--bg-surface-alt)]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "min-h-11 px-3 py-2 text-xs sm:text-sm",
  md: "min-h-11 px-4 py-2.5 text-sm sm:text-base",
  lg: "min-h-12 px-5 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const baseClass =
    variant === "ghost"
      ? "inline-flex items-center justify-center gap-2 rounded-md border-2 font-display font-bold tracking-wide transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      : "retro-btn inline-flex items-center justify-center gap-2 rounded-md font-display font-bold tracking-wide cursor-pointer";

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${baseClass} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`.trim()}
      {...props}
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
