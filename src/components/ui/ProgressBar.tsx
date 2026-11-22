export interface ProgressBarProps {
  value: number;
  label: string;
  stageLabel?: string;
  speed?: string | null;
  etaSec?: number | null;
}

function formatEta(etaSec: number): string {
  if (etaSec < 60) return `${Math.max(1, Math.round(etaSec))}s`;
  const mins = Math.floor(etaSec / 60);
  const secs = Math.round(etaSec % 60);
  return `${mins}m ${secs}s`;
}

export function ProgressBar({
  value,
  label,
  stageLabel,
  speed,
  etaSec,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const roundedDisplay = Math.round(clamped);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-semibold">
        <span className="font-display uppercase tracking-wider text-[var(--text-ink)]">
          {stageLabel ?? label}
        </span>
        <span className="flex items-center gap-3 tabular-nums text-[var(--text-muted)]">
          {speed ? <span>{speed}</span> : null}
          {etaSec != null && etaSec > 0 ? <span>ETA {formatEta(etaSec)}</span> : null}
          <span className="font-display font-bold text-[var(--text-ink)]">
            {roundedDisplay}%
          </span>
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedDisplay}
        className="relative h-7 w-full overflow-hidden rounded-md border-2 border-[var(--border-ink)] bg-[var(--bg-surface-alt)] shadow-[inset_2px_2px_0_rgba(0,0,0,0.1)]"
      >
        <div
          className="vhs-tracking-fill h-full border-r-2 border-[var(--border-ink)] transition-[width] duration-200 ease-out"
          style={{ width: `${clamped}%` }}
        />
        {/* VHS Tracking Tick Marks */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex justify-between px-[25%]"
        >
          <span className="h-full w-px bg-[var(--border-ink)]/25" />
          <span className="h-full w-px bg-[var(--border-ink)]/25" />
          <span className="h-full w-px bg-[var(--border-ink)]/25" />
        </div>
      </div>
    </div>
  );
}
