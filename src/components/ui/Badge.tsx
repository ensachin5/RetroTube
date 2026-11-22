import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "tomato" | "mustard" | "teal" | "outline";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-[var(--bg-surface-alt)] text-[var(--text-ink)] border-[var(--border-ink)]",
  tomato: "bg-[var(--accent-tomato)] text-[var(--on-tomato)] border-[var(--border-ink)]",
  mustard:
    "bg-[var(--accent-mustard)] text-[var(--on-mustard)] border-[var(--border-ink)]",
  teal: "bg-[var(--accent-teal)] text-[var(--on-teal)] border-[var(--border-ink)]",
  outline: "bg-transparent text-[var(--text-ink)] border-[var(--border-ink)]",
};

export function Badge({ tone = "neutral", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 border text-[11px] sm:text-xs font-bold uppercase tracking-wider leading-tight ${TONE_CLASSES[tone]} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
