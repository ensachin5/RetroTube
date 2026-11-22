export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md border-2 border-[var(--border-ink)]/25 bg-[var(--bg-surface-alt)] ${className}`.trim()}
    />
  );
}
