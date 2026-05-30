/**
 * Shared skeleton-loading primitives so every table loads with the same
 * shimmer language (matching BountyTable's existing skeleton rows) instead of
 * a plain "Loading…" string. Desktop renders grid rows that mirror the real
 * column template; mobile renders stacked card skeletons — no layout shift
 * when data arrives.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-abyssal-ink/10 ${className}`} />;
}

export function SkeletonTableRows({
  count = 6,
  columns,
  gridTemplate,
}: {
  count?: number;
  columns: number;
  gridTemplate: string;
}) {
  return (
    <div className="divide-y divide-abyssal-ink/10">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} aria-busy="true">
          {/* desktop grid row */}
          <div
            className="hidden gap-4 px-4 py-4 md:grid"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {Array.from({ length: columns }).map((_, j) => (
              <Skeleton key={j} className="h-4" />
            ))}
          </div>
          {/* mobile card */}
          <div className="space-y-4 px-4 py-4 md:hidden">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-6 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}
