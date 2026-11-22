import { forwardRef, type InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { hasError = false, className = "", ...props },
  ref,
) {
  const errorBorder = hasError
    ? "border-[var(--border-error)] ring-2 ring-[var(--border-error)]/30"
    : "";

  return (
    <input
      ref={ref}
      className={`retro-input min-h-12 w-full rounded-md px-3.5 py-2.5 text-base font-medium leading-snug ${errorBorder} ${className}`.trim()}
      {...props}
    />
  );
});
