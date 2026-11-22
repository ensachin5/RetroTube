import type { HTMLAttributes, ReactNode } from "react";

export type CardTone = "default" | "alt" | "error" | "success";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  children: ReactNode;
}

const TONE_CLASSES: Record<CardTone, string> = {
  default: "retro-card",
  alt: "retro-card-alt",
  error:
    "bg-[var(--bg-error)] border-2 border-[var(--border-error)] shadow-[var(--shadow-retro)]",
  success:
    "bg-[var(--bg-success)] border-2 border-[var(--border-success)] shadow-[var(--shadow-retro)]",
};

export function Card({
  tone = "default",
  className = "",
  children,
  ...props
}: CardProps) {
  return (
    <div className={`rounded-lg ${TONE_CLASSES[tone]} ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}
