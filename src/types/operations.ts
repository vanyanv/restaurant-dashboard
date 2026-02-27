export interface WeeklyBucket {
  weekLabel: string     // e.g. "W09"
  weekStart: string     // "2026-02-24"
  weekEnd: string       // "2026-03-01"
  totalSpending: number
  totalRevenue: number
  totalOrders: number
  costPerOrder: number
  grossMarginPct: number | null
  cogsRatioPct: number | null
}

export interface CategorySpending {
  category: string
  totalSpend: number
  percentOfTotal: number
}

export interface OperationsKpis {
  costPerOrder: number
  grossMarginPct: number | null
  totalSpending: number
  totalRevenue: number
  totalOrders: number
}

export interface OperationsPeriodComparison {
  current: OperationsKpis
  previous: OperationsKpis
  costPerOrderChange: number | null
  grossMarginChange: number | null
  spendingChange: number
  revenueChange: number
  ordersChange: number
}

export interface OperationsData {
  weeklyBuckets: WeeklyBucket[]
  categoryBreakdown: CategorySpending[]
  comparison: OperationsPeriodComparison
  dateRange: { startDate: string; endDate: string }
  weekCount: number
}
