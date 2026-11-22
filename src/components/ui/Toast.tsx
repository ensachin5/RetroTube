"use client";

export interface ToastProps {
  message: string;
  tone?: "info" | "error" | "success";
  onDismiss: () => void;
}

export function Toast({ message, tone = "info", onDismiss }: ToastProps) {
  const toneClasses =
    tone === "error"
      ? "bg-[var(--bg-error)] border-[var(--border-error)]"
      : tone === "success"
        ? "bg-[var(--bg-success)] border-[var(--border-success)]"
        : "bg-[var(--bg-surface)] border-[var(--border-ink)]";

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={`fixed inset-x-3 sm:inset-x-auto sm:right-5 bottom-[max(5rem,env(safe-area-inset-bottom))] md:bottom-5 z-50 sm:max-w-md rounded-lg border-2 p-3 shadow-[var(--shadow-retro)] flex items-center justify-between gap-3 ${toneClasses}`}
    >
      <p className="text-sm font-medium text-[var(--text-ink)]">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="min-h-11 min-w-11 shrink-0 rounded border border-[var(--border-ink)] bg-[var(--bg-surface-alt)] px-2 text-xs font-bold uppercase cursor-pointer hover:brightness-95"
      >
        OK
      </button>
    </div>
  );
}
