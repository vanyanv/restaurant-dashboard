import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/*  KPI Cards                                                          */
/* ------------------------------------------------------------------ */

export function KpiCardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card
          key={i}
          className="relative overflow-hidden border-t-[3px] border-t-muted"
        >
          <CardContent className="p-4 sm:p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2.5 h-7 w-28 sm:h-8" />
            {i < 2 && <Skeleton className="mt-3 h-5 w-24 rounded-full" />}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Chart (generic line/bar)                                           */
/* ------------------------------------------------------------------ */

interface ChartSkeletonProps {
  height?: string
  className?: string
  showToggle?: boolean
}

export function ChartSkeleton({
  height = "h-[280px] md:h-[340px] lg:h-[380px]",
  className,
  showToggle,
}: ChartSkeletonProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-52" />
          </div>
          {showToggle && (
            <div className="flex gap-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-10 rounded-md" />
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className={cn("w-full rounded-lg", height)} />
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Pie/Donut Chart                                                    */
/* ------------------------------------------------------------------ */

export function PieChartSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-44" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 pt-2">
        <Skeleton className="h-[200px] w-[200px] rounded-full" />
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-3 w-14" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Revenue Heatmap                                                    */
/* ------------------------------------------------------------------ */

export function HeatmapSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-[2px]">
          {Array.from({ length: 10 }).map((_, col) => (
            <div key={col} className="flex flex-col gap-[2px]">
              {Array.from({ length: 7 }).map((_, row) => (
                <Skeleton
                  key={row}
                  className="h-3 w-3 rounded-[2px]"
                />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Data Table (generic — financial, daily)                            */
/* ------------------------------------------------------------------ */

interface DataTableSkeletonProps {
  columns?: number
  rows?: number
  className?: string
}

export function DataTableSkeleton({
  columns = 7,
  rows = 5,
  className,
}: DataTableSkeletonProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-48" />
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left pl-6">
                  <Skeleton className="h-3 w-16" />
                </th>
                {Array.from({ length: columns - 1 }).map((_, i) => (
                  <th key={i} className="px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-3 w-14" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, rowIdx) => (
                <tr key={rowIdx} className="border-b border-border/40">
                  <td className="px-4 py-3 pl-6">
                    <Skeleton className="h-4 w-24" />
                  </td>
                  {Array.from({ length: columns - 1 }).map((_, cellIdx) => (
                    <td key={cellIdx} className="px-4 py-3 text-right">
                      <Skeleton className="ml-auto h-4 w-16" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Menu Category Table                                                */
/* ------------------------------------------------------------------ */

export function MenuCategoryTableSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-56" />
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 pl-6 text-left">
                  <Skeleton className="h-3 w-28" />
                </th>
                {Array.from({ length: 6 }).map((_, i) => (
                  <th key={i} className="px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-3 w-14" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, rowIdx) => (
                <tr key={rowIdx} className="border-b border-border/40">
                  <td className="px-4 py-3 pl-6">
                    <div className="flex items-center gap-1.5">
                      <Skeleton className="h-4 w-4 shrink-0" />
                      <Skeleton className="h-4 w-28" />
                    </div>
                  </td>
                  {Array.from({ length: 6 }).map((_, cellIdx) => (
                    <td key={cellIdx} className="px-4 py-3 text-right">
                      <Skeleton className="ml-auto h-4 w-14" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/*  Additional Metrics                                                 */
/* ------------------------------------------------------------------ */

export function AdditionalMetricsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-16" />
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Full-Page: Dashboard                                               */
/* ------------------------------------------------------------------ */

export function DashboardPageSkeleton() {
  return (
    <div className="flex flex-col h-full">
      {/* Sticky header skeleton */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <Skeleton className="h-3 w-36" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-48 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 p-4 sm:p-6 space-y-6">
        <KpiCardsSkeleton />
        <ChartSkeleton
          height="h-[280px] md:h-[340px] lg:h-[380px]"
          showToggle
        />
        {/* Financial summary table skeleton (inline) */}
        <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            </div>
            <Skeleton className="h-8 w-[200px] rounded-md" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 text-left">
                    <Skeleton className="h-3 w-16" />
                  </th>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <th key={i} className="px-4 py-3 text-right">
                      <Skeleton className="ml-auto h-3 w-16" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 3 }).map((_, rowIdx) => (
                  <tr key={rowIdx} className="border-b border-border/40">
                    <td className="px-4 py-3">
                      <Skeleton className="h-4 w-28" />
                    </td>
                    {Array.from({ length: 8 }).map((_, cellIdx) => (
                      <td key={cellIdx} className="px-4 py-3 text-right">
                        <Skeleton className="ml-auto h-4 w-16" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Full-Page: Store Analytics                                         */
/* ------------------------------------------------------------------ */

export function StoreAnalyticsPageSkeleton() {
  return (
    <div>
      {/* Header with breadcrumb */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Skeleton className="h-6 w-6 rounded" />
        <div className="mx-2 h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-3" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-3" />
          <Skeleton className="h-3 w-24" />
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-8 w-[180px] rounded-md" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-48 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </div>

      {/* Dashboard body */}
      <div className="flex flex-col gap-4 p-4">
        <KpiCardsSkeleton />

        {/* Revenue trend + heatmap grid */}
        <div className="grid gap-4 md:grid-cols-5">
          <ChartSkeleton
            height="h-[280px] md:h-[340px] lg:h-[380px]"
            showToggle
            className="md:col-span-3"
          />
          <HeatmapSkeleton className="md:col-span-2" />
        </div>

        {/* Platform trend */}
        <ChartSkeleton height="h-[240px] md:h-[280px] lg:h-[300px]" />

        {/* Platform breakdown + payment split */}
        <div className="grid gap-4 md:grid-cols-2">
          <ChartSkeleton />
          <PieChartSkeleton />
        </div>

        {/* Financial table */}
        <DataTableSkeleton columns={11} rows={5} />

        {/* Additional metrics */}
        <AdditionalMetricsSkeleton />

        {/* Menu grid */}
        <div className="grid gap-4 md:grid-cols-2">
          <ChartSkeleton />
          <MenuCategoryTableSkeleton />
        </div>

        {/* Daily table */}
        <DataTableSkeleton columns={7} rows={7} />
      </div>
    </div>
  )
}
