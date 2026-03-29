import { cn } from '@/lib/utils'

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-md bg-muted motion-safe:animate-pulse',
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  )
}

/** A skeleton shaped like a single table/list row. */
function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 px-4 py-3', className)} aria-hidden="true">
      <Skeleton className="h-4 w-16 shrink-0" />
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-4 w-20 shrink-0" />
      <Skeleton className="h-4 w-24 shrink-0" />
    </div>
  )
}

/** A skeleton shaped like a summary card. */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-lg border border-gray-200 bg-white p-4 space-y-3', className)}
      aria-hidden="true"
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  )
}

/** A skeleton shaped like a detail/full-page view. */
function SkeletonDetail({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-4', className)} aria-hidden="true">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-4/6" />
      <div className="flex gap-3 pt-2">
        <Skeleton className="h-8 w-24 rounded" />
        <Skeleton className="h-8 w-24 rounded" />
      </div>
    </div>
  )
}

export { Skeleton, SkeletonRow, SkeletonCard, SkeletonDetail }
