import {
  endOfISOWeek,
  format,
  getISOWeek,
  getISOWeekYear,
  startOfISOWeek,
} from "date-fns"
import type { CategorySpending, WeeklyBucket } from "@/types/operations"

export type DailyOtterRow = {
  date: Date
  revenue: number | bigint
  orders: number | bigint
}

export type DailyInvoiceRow = {
  date: Date
  spending: number | bigint
}

export type CategoryAggregateRow = {
  category: string | null
  totalSpend: number | bigint
}

function weekKey(d: Date): string {
  return `${getISOWeekYear(d)}-W${String(getISOWeek(d)).padStart(2, "0")}`
}

export function bucketDailyToWeekly(
  otterRows: DailyOtterRow[],
  invoiceRows: DailyInvoiceRow[]
): WeeklyBucket[] {
  type Acc = {
    weekLabel: string
    weekStart: string
    weekEnd: string
    spending: number
    revenue: number
    orders: number
  }
  const buckets = new Map<string, Acc>()

  function ensure(d: Date): Acc {
    const key = weekKey(d)
    let b = buckets.get(key)
    if (!b) {
      b = {
        weekLabel: `W${String(getISOWeek(d)).padStart(2, "0")}`,
        weekStart: format(startOfISOWeek(d), "yyyy-MM-dd"),
        weekEnd: format(endOfISOWeek(d), "yyyy-MM-dd"),
        spending: 0,
        revenue: 0,
        orders: 0,
      }
      buckets.set(key, b)
    }
    return b
  }

  for (const r of otterRows) {
    const b = ensure(r.date)
    b.revenue += Number(r.revenue)
    b.orders += Number(r.orders)
  }
  for (const r of invoiceRows) {
    ensure(r.date).spending += Number(r.spending)
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, b]) => ({
      weekLabel: b.weekLabel,
      weekStart: b.weekStart,
      weekEnd: b.weekEnd,
      totalSpending: b.spending,
      totalRevenue: b.revenue,
      totalOrders: b.orders,
      costPerOrder: b.orders > 0 ? b.spending / b.orders : 0,
      grossMarginPct:
        b.revenue > 0 ? ((b.revenue - b.spending) / b.revenue) * 100 : null,
      cogsRatioPct: b.revenue > 0 ? (b.spending / b.revenue) * 100 : null,
    }))
}

export function shapeCategoryBreakdown(
  rows: CategoryAggregateRow[]
): CategorySpending[] {
  const merged = new Map<string, number>()
  for (const r of rows) {
    const key = r.category ?? "Other"
    merged.set(key, (merged.get(key) ?? 0) + Number(r.totalSpend))
  }
  const total = Array.from(merged.values()).reduce((s, v) => s + v, 0)
  return Array.from(merged.entries())
    .map(([category, totalSpend]) => ({
      category,
      totalSpend,
      percentOfTotal: total > 0 ? (totalSpend / total) * 100 : 0,
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend)
}
