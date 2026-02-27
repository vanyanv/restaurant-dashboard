import {
  KpiCardsSkeleton,
  ChartSkeleton,
  DataTableSkeleton,
} from "@/components/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

export default function ProductUsageLoading() {
  return (
    <div className="flex flex-col h-full">
      {/* Header skeleton */}
      <header className="flex h-16 shrink-0 items-center gap-2 px-4">
        <Skeleton className="h-6 w-6 rounded" />
        <div className="mx-2 h-4 w-px bg-border" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-3" />
        <Skeleton className="h-3 w-28" />
      </header>

      {/* Sticky header skeleton */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-5 w-36" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-48 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-9 w-32 bg-muted rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 sm:p-6 space-y-8">
        <KpiCardsSkeleton />
        <ChartSkeleton />
        <DataTableSkeleton columns={7} rows={8} />
      </div>
    </div>
  )
}
