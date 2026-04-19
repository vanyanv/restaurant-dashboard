import {
  KpiCardsSkeleton,
  ChartSkeleton,
  DataTableSkeleton,
} from "@/components/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

export default function ProductUsageLoading() {
  return (
    <div className="flex flex-col h-full">
      <header className="editorial-topbar">
        <div className="editorial-topbar-rule" aria-hidden="true" />
        <div className="editorial-topbar-inner">
          <Skeleton className="h-6 w-6 rounded" />
          <div className="mx-1 h-4 w-px bg-border" />
          <span className="editorial-section-label">§ 04</span>
          <span className="font-display text-[18px] italic leading-none tracking-[-0.02em] opacity-60">
            Product Usage
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-8 w-48 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-9 w-32 rounded" />
          </div>
        </div>
      </header>

      <div className="flex-1 p-4 sm:p-6 space-y-8">
        <KpiCardsSkeleton />
        <ChartSkeleton />
        <DataTableSkeleton columns={7} rows={8} />
      </div>
    </div>
  )
}
