export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl bg-surface-muted/80 dark:bg-surface-muted/40 ${className}`}
    />
  );
}

export function GridSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-8 w-full" />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    </div>
  );
}
