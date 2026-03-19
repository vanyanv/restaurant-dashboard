"use client"

import { useTransition, useState, useCallback, useEffect, useMemo } from "react"
import dynamic from "next/dynamic"
import {
  Star,
  TrendingUp,
  TrendingDown,
  MessageSquareText,
  Hash,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  UtensilsCrossed,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { getRatingsAnalytics, type RatingsAnalyticsData } from "@/app/actions/ratings-actions"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import { OtterSyncButton } from "@/components/otter-sync-button"
import { ChartSkeleton } from "@/components/skeletons"
import { localDateStr } from "@/lib/dashboard-utils"

const RatingDistributionChart = dynamic(
  () => import("@/components/charts/rating-distribution-chart").then((m) => ({ default: m.RatingDistributionChart })),
  { loading: () => <ChartSkeleton height="h-[260px]" />, ssr: false }
)
const RatingTrendChart = dynamic(
  () => import("@/components/charts/rating-trend-chart").then((m) => ({ default: m.RatingTrendChart })),
  { loading: () => <ChartSkeleton height="h-[260px]" />, ssr: false }
)
const RatingStoreChart = dynamic(
  () => import("@/components/charts/rating-store-chart").then((m) => ({ default: m.RatingStoreChart })),
  { loading: () => <ChartSkeleton height="h-[260px]" />, ssr: false }
)
const RatingPlatformChart = dynamic(
  () => import("@/components/charts/rating-platform-chart").then((m) => ({ default: m.RatingPlatformChart })),
  { loading: () => <ChartSkeleton height="h-[260px]" />, ssr: false }
)

interface RatingsContentProps {
  initialData: RatingsAnalyticsData | null
  userRole: string
}

function StarDisplay({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  const cls = size === "md" ? "h-4.5 w-4.5" : "h-3.5 w-3.5"
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`${cls} ${
            i <= Math.round(rating)
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/25"
          }`}
        />
      ))}
    </div>
  )
}

const PLATFORM_LABELS: Record<string, string> = {
  doordash: "DoorDash",
  ubereats: "UberEats",
  grubhub: "Grubhub",
  "css-pos": "POS",
  "bnm-web": "Web",
}

const PLATFORM_COLORS: Record<string, string> = {
  doordash: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800",
  ubereats: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  grubhub: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800",
  "css-pos": "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
  "bnm-web": "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800",
}

const KPI_STYLES = [
  { borderColor: "border-l-amber-400", bgTint: "hover:bg-amber-50/40 dark:hover:bg-amber-950/20" },
  { borderColor: "border-l-blue-400", bgTint: "hover:bg-blue-50/40 dark:hover:bg-blue-950/20" },
  { borderColor: "border-l-emerald-400", bgTint: "hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20" },
  { borderColor: "border-l-rose-400", bgTint: "hover:bg-rose-50/40 dark:hover:bg-rose-950/20" },
]

function relativeDate(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function parseOrderItems(raw: string): string[] {
  // Handle JSON array format: ["item1", "item2"]
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter((s) => s && s !== "null")
      }
    } catch {
      // Fall through to comma-split
    }
  }
  return raw.split(",").map((s) => s.trim()).filter((s) => s && s !== "null")
}

function OrderItemChips({ items }: { items: string | null }) {
  if (!items) return null
  const allItems = parseOrderItems(items)
  if (allItems.length === 0) return null

  const MAX_VISIBLE = 4
  const visible = allItems.slice(0, MAX_VISIBLE)
  const remaining = allItems.length - MAX_VISIBLE

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-2">
      <UtensilsCrossed className="h-3 w-3 text-muted-foreground/50 shrink-0" />
      {visible.map((item, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-full bg-muted/80 px-2 py-0.5 text-[11px] text-muted-foreground leading-tight"
        >
          {item}
        </span>
      ))}
      {remaining > 0 && (
        <span className="text-[11px] text-muted-foreground/60">
          +{remaining} more
        </span>
      )}
    </div>
  )
}

function ExpandableReviewText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 140

  return (
    <div className="mt-1.5">
      <p className={`text-sm text-foreground/80 leading-relaxed ${!expanded && isLong ? "line-clamp-2" : ""}`}>
        {text}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary/70 hover:text-primary mt-0.5 font-medium"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}

function ReviewCard({
  review,
  index,
}: {
  review: RatingsAnalyticsData["recentReviews"][number]
  index: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.025, ease: "easeOut" }}
      className="group relative flex gap-4 py-4 px-4 -mx-4 rounded-lg transition-colors hover:bg-muted/30"
    >
      {/* Rating column */}
      <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
        <span className="text-lg font-bold font-mono-numbers tabular-nums leading-none">
          {review.rating}
        </span>
        <div className="flex gap-px">
          {[1, 2, 3, 4, 5].map((i) => (
            <Star
              key={i}
              className={`h-3 w-3 ${
                i <= review.rating
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/20"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{review.storeName}</span>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 h-5 font-semibold ${PLATFORM_COLORS[review.platform] ?? ""}`}
          >
            {PLATFORM_LABELS[review.platform] ?? review.platform}
          </Badge>
          <span className="text-xs text-muted-foreground ml-auto shrink-0">
            {relativeDate(review.reviewedAt)}
          </span>
        </div>

        {review.reviewText && <ExpandableReviewText text={review.reviewText} />}

        <OrderItemChips items={review.orderItemNames} />
      </div>
    </motion.div>
  )
}

export function RatingsContent({
  initialData,
  userRole,
}: RatingsContentProps) {
  const [data, setData] = useState(initialData)
  const [isPending, startTransition] = useTransition()
  const [searchQuery, setSearchQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)

  useEffect(() => { setData(initialData) }, [initialData])

  const [days, setDays] = useState(21)
  const [customRange, setCustomRange] = useState<{
    startDate: string
    endDate: string
  } | null>(null)

  const handleRangeChange = useCallback(
    (startDate: string, endDate: string) => {
      const diffDays = Math.round(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      let presetDays: number
      if (diffDays === 0) {
        const today = localDateStr(new Date())
        if (startDate === today) {
          presetDays = 1
        } else {
          const yday = new Date()
          yday.setDate(yday.getDate() - 1)
          presetDays = startDate === localDateStr(yday) ? -1 : diffDays
        }
      } else {
        presetDays = diffDays
      }

      const presets = [1, -1, 3, 7, 14, 21, 30, 90]
      const matchedPreset = presets.find((p) => p === presetDays)

      if (matchedPreset) {
        setDays(matchedPreset)
        setCustomRange(null)
      } else {
        setCustomRange({ startDate, endDate })
      }

      setPage(1)

      startTransition(async () => {
        const result = await getRatingsAnalytics(undefined, { startDate, endDate })
        setData(result)
      })
    },
    []
  )

  const hasData = data && data.totalReviews > 0

  const filteredReviews = useMemo(() => {
    if (!data) return []
    if (!searchQuery) return data.recentReviews
    const q = searchQuery.toLowerCase()
    return data.recentReviews.filter((r) =>
      r.storeName.toLowerCase().includes(q) ||
      r.platform.toLowerCase().includes(q) ||
      (PLATFORM_LABELS[r.platform] ?? "").toLowerCase().includes(q) ||
      r.reviewText?.toLowerCase().includes(q) ||
      r.orderItemNames?.toLowerCase().includes(q)
    )
  }, [data, searchQuery])

  // Reset page when search changes
  useEffect(() => { setPage(1) }, [searchQuery])

  const totalPages = Math.max(1, Math.ceil(filteredReviews.length / pageSize))
  const paginatedReviews = filteredReviews.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div className="flex flex-col h-full">
      {/* Navigation Header */}
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">Dashboard</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>Ratings</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="ml-auto flex items-center gap-2 px-4">
          <DateRangePicker
            days={days}
            customRange={customRange}
            onRangeChange={handleRangeChange}
            isPending={isPending}
          />
          {userRole === "OWNER" && (
            <OtterSyncButton
              size="sm"
              variant="outline"
            />
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              title: "Avg Rating",
              icon: <Star className="h-4 w-4 text-amber-500" />,
              value: hasData ? data.avgRating.toFixed(2) : "—",
              sub: hasData ? <StarDisplay rating={data.avgRating} size="sm" /> : null,
            },
            {
              title: "Total Reviews",
              icon: <Hash className="h-4 w-4 text-blue-500" />,
              value: hasData ? data.totalReviews.toLocaleString() : "—",
              sub: <p className="text-xs text-muted-foreground">in selected period</p>,
            },
            {
              title: "With Text",
              icon: <MessageSquareText className="h-4 w-4 text-emerald-500" />,
              value: hasData ? `${data.textReviewPct}%` : "—",
              sub: <p className="text-xs text-muted-foreground">reviews with comments</p>,
            },
            {
              title: "Rating Trend",
              icon: data && data.ratingTrend >= 0
                ? <TrendingUp className="h-4 w-4 text-emerald-500" />
                : <TrendingDown className="h-4 w-4 text-rose-500" />,
              value: hasData
                ? `${data.ratingTrend > 0 ? "+" : ""}${data.ratingTrend.toFixed(2)}`
                : "—",
              valueColor: data && data.ratingTrend > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : data && data.ratingTrend < 0
                  ? "text-rose-600 dark:text-rose-400"
                  : "",
              sub: <p className="text-xs text-muted-foreground">vs previous period</p>,
            },
          ].map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.06, ease: "easeOut" }}
            >
              <Card className={`border-l-[3px] ${KPI_STYLES[i].borderColor} ${KPI_STYLES[i].bgTint} transition-colors`}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                  {card.icon}
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${"valueColor" in card && card.valueColor ? card.valueColor : ""}`}>
                    {card.value}
                  </div>
                  {card.sub}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {hasData ? (
          <>
            {/* Charts Row 1 */}
            <div className="grid gap-4 md:grid-cols-2">
              <RatingDistributionChart data={data.distribution} />
              <RatingTrendChart data={data.dailyAvg} />
            </div>

            {/* Charts Row 2 */}
            <div className="grid gap-4 md:grid-cols-2">
              <RatingStoreChart data={data.byStore} />
              <RatingPlatformChart data={data.byPlatform} />
            </div>

            {/* Reviews Feed */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <CardTitle>Recent Reviews</CardTitle>
                    <span className="text-xs text-muted-foreground tabular-nums font-mono-numbers hidden sm:inline">
                      {filteredReviews.length === data.recentReviews.length
                        ? `${filteredReviews.length} reviews`
                        : `${filteredReviews.length} of ${data.recentReviews.length}`}
                    </span>
                  </div>
                  <div className="relative max-w-xs w-full sm:w-auto">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                    <Input
                      placeholder="Search reviews..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 h-8 text-sm"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Review Cards */}
                <div className="divide-y">
                  <AnimatePresence mode="wait">
                    {paginatedReviews.length === 0 ? (
                      <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex flex-col items-center justify-center py-12 text-center"
                      >
                        <Search className="h-8 w-8 text-muted-foreground/30 mb-3" />
                        <p className="text-sm text-muted-foreground">
                          {searchQuery ? "No reviews match your search" : "No reviews to display"}
                        </p>
                      </motion.div>
                    ) : (
                      <motion.div
                        key={`page-${page}-${searchQuery}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.15 }}
                      >
                        {paginatedReviews.map((review, i) => (
                          <ReviewCard key={review.id} review={review} index={i} />
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Pagination */}
                {filteredReviews.length > 0 && (
                  <div className="flex items-center justify-between pt-4 mt-4 border-t">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground hidden sm:inline">Rows per page</span>
                      <Select
                        value={String(pageSize)}
                        onValueChange={(v) => {
                          setPageSize(Number(v))
                          setPage(1)
                        }}
                      >
                        <SelectTrigger className="h-7 w-15 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[10, 15, 25].map((size) => (
                            <SelectItem key={size} value={String(size)}>
                              {size}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground tabular-nums font-mono-numbers mr-2">
                        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredReviews.length)} of {filteredReviews.length}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setPage(1)}
                        disabled={page === 1}
                      >
                        <ChevronsLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setPage(totalPages)}
                        disabled={page === totalPages}
                      >
                        <ChevronsRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Star className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-semibold mb-1">No ratings data yet</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                Click the sync button to fetch customer ratings from your delivery platforms.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
