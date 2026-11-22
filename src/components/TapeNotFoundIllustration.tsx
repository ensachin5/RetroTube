export interface TapeNotFoundIllustrationProps {
  code?: string;
}

export function TapeNotFoundIllustration({
  code = "NO SIGNAL",
}: TapeNotFoundIllustrationProps) {
  return (
    <div className="mx-auto flex flex-col items-center gap-3">
      <svg
        width="180"
        height="118"
        viewBox="0 0 180 118"
        fill="none"
        aria-hidden="true"
        className="text-[var(--text-ink)]"
      >
        {/* Unspooled loose ribbon */}
        <path
          d="M52 88 C 36 108, 70 114, 92 104 C 114 94, 134 114, 148 96"
          stroke="var(--accent-tomato)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        {/* Cassette shell */}
        <rect
          x="16"
          y="10"
          width="148"
          height="84"
          rx="8"
          fill="var(--bg-surface-alt)"
          stroke="currentColor"
          strokeWidth="3"
        />
        {/* Label sticker */}
        <rect
          x="28"
          y="20"
          width="124"
          height="42"
          rx="4"
          fill="var(--accent-mustard)"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        {/* Tape window */}
        <rect
          x="48"
          y="30"
          width="84"
          height="22"
          rx="3"
          fill="var(--bg-surface)"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="64"
          cy="41"
          r="7"
          fill="var(--bg-surface-alt)"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="116"
          cy="41"
          r="7"
          fill="var(--bg-surface-alt)"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle cx="64" cy="41" r="2.5" fill="var(--accent-tomato)" />
        <circle cx="116" cy="41" r="2.5" fill="var(--accent-teal)" />
        {/* Bottom trapezoid */}
        <path
          d="M46 94 L54 74 H126 L134 94 Z"
          fill="var(--bg-surface)"
          stroke="currentColor"
          strokeWidth="2.5"
        />
      </svg>
      <span className="inline-block rounded border-2 border-[var(--border-ink)] bg-[var(--accent-tomato)] px-3 py-1 font-display text-xs font-black uppercase tracking-widest text-[var(--on-tomato)]">
        {code}
      </span>
    </div>
  );
}
