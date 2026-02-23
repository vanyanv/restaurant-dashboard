import {
  ChartSkeleton,
  PieChartSkeleton,
  HeatmapSkeleton,
  AdditionalMetricsSkeleton,
} from "@/components/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

export default function AnalyticsLoading() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        <Skeleton className="h-6 w-6 rounded" />
        <div className="mx-2 h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-3" />
          <Skeleton className="h-3 w-14" />
        </div>
      </header>

      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-5 w-36" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-48 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 sm:p-6 space-y-8">
        <HeatmapSkeleton />
        <ChartSkeleton height="h-[240px] md:h-[280px] lg:h-[300px]" />
        <div className="grid gap-4 md:grid-cols-3">
          <ChartSkeleton className="md:col-span-2" />
          <PieChartSkeleton />
        </div>
        <ChartSkeleton />
        <ChartSkeleton />
        <AdditionalMetricsSkeleton />
      </div>
    </div>
  )
}
