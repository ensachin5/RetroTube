export interface TapeReelLoaderProps {
  label?: string;
}

export function TapeReelLoader({ label = "Loading tape..." }: TapeReelLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="inline-flex items-center gap-3"
    >
      <svg
        width="56"
        height="34"
        viewBox="0 0 56 34"
        fill="none"
        aria-hidden="true"
        className="shrink-0 text-[var(--text-ink)]"
      >
        <rect
          x="1.5"
          y="1.5"
          width="53"
          height="31"
          rx="4"
          fill="var(--bg-surface-alt)"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <rect
          x="10"
          y="25"
          width="36"
          height="5"
          rx="1"
          fill="var(--bg-surface)"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <g className="tape-reel-spin" style={{ transformOrigin: "17px 14px" }}>
          <circle
            cx="17"
            cy="14"
            r="6.5"
            fill="var(--bg-surface)"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="17" cy="14" r="2" fill="var(--accent-tomato)" />
          <path
            d="M17 9v2M17 17v2M12 14h2M20 14h2"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </g>
        <g className="tape-reel-spin" style={{ transformOrigin: "39px 14px" }}>
          <circle
            cx="39"
            cy="14"
            r="6.5"
            fill="var(--bg-surface)"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="39" cy="14" r="2" fill="var(--accent-teal)" />
          <path
            d="M39 9v2M39 17v2M34 14h2M42 14h2"
            stroke="currentColor"
            strokeWidth="1.6"
          />
        </g>
        <line
          x1="23.5"
          y1="14"
          x2="32.5"
          y2="14"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
      <span className="font-display font-bold text-sm uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}
