import Link from "next/link";

export function RetroHeader() {
  return (
    <header className="sticky top-0 md:static z-30 border-b-2 border-[var(--border-ink)] bg-[var(--bg-surface)]/95 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-3 py-2.5 sm:px-6">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2.5 rounded-md px-1.5 py-1 text-[var(--text-ink)] no-underline hover:opacity-90"
        >
          <svg
            width="34"
            height="24"
            viewBox="0 0 34 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect
              x="1.5"
              y="1.5"
              width="31"
              height="21"
              rx="3"
              fill="var(--accent-mustard)"
              stroke="var(--border-ink)"
              strokeWidth="2.5"
            />
            <circle
              cx="11"
              cy="11"
              r="3.2"
              fill="var(--bg-surface)"
              stroke="var(--border-ink)"
              strokeWidth="2"
            />
            <circle
              cx="23"
              cy="11"
              r="3.2"
              fill="var(--bg-surface)"
              stroke="var(--border-ink)"
              strokeWidth="2"
            />
            <rect x="7" y="17" width="20" height="3.5" rx="1" fill="var(--border-ink)" />
          </svg>
          <span className="font-display text-lg sm:text-xl font-black tracking-tight">
            RetroTube
          </span>
        </Link>

        <nav aria-label="Primary navigation" className="flex items-center gap-2">
          <Link
            href="/history"
            className="retro-btn min-h-11 inline-flex items-center justify-center rounded-md bg-[var(--bg-surface-alt)] px-3 py-2 font-display text-xs sm:text-sm font-bold uppercase tracking-wider text-[var(--text-ink)] no-underline"
          >
            History
          </Link>
        </nav>
      </div>
    </header>
  );
}
