export interface StoreAnalyticsKpis {
  grossRevenue: number
  netRevenue: number
  totalOrders: number
  averageOrderValue: number
  totalFees: number
  totalTips: number
  totalDiscounts: number
  totalTaxCollected: number
  totalTaxRemitted: number
  totalServiceCharges: number
  totalLoyalty: number
  totalRefundsAdjustments: number
  totalLostRevenue: number
  tillPaidIn: number
  tillPaidOut: number
  tillNet: number
}

export interface PeriodComparison {
  currentGross: number
  previousGross: number
  currentNet: number
  previousNet: number
  grossGrowth: number
  netGrowth: number
}

export interface DailyTrend {
  date: string
  grossRevenue: number
  netRevenue: number
  /** Tickets that day across both first- and third-party channels. */
  orderCount: number
  fpGross: number
  tpGross: number
  cashSales: number
  cardSales: number
}

export interface PlatformBreakdown {
  platform: string
  paymentMethod: string | null
  grossSales: number
  netSales: number
  fees: number
  discounts: number
  taxCollected: number
  taxRemitted: number
  tips: number
  serviceCharges: number
  loyalty: number
  refundsAdjustments: number
  orderCount: number
  paidIn: number
  paidOut: number
  theoreticalDeposit: number
  cashDrawerRecon: number | null
  expectedDeposit: number
}

export interface PaymentSplit {
  cashSales: number
  cardSales: number
}

export interface PlatformTrendPoint {
  date: string
  platform: string
  grossSales: number
}

export interface StoreAnalyticsData {
  kpis: StoreAnalyticsKpis
  comparison: PeriodComparison
  dailyTrends: DailyTrend[]
  platformBreakdown: PlatformBreakdown[]
  paymentSplit: PaymentSplit
  platformTrends: PlatformTrendPoint[]
  dateRange: { startDate: string; endDate: string }
  dayCount: number
  lastSyncAt: Date | string | null
}

// Dashboard financial summary (per-store row with 16 metrics)
export interface StoreSummaryRow {
  storeId: string
  storeName: string
  grossSales: number
  fulfilledOrders: number
  discounts: number
  loyalty: number
  refundsAdjustments: number
  netSales: number
  serviceCharges: number
  commissionFees: number
  taxCollected: number
  taxRemitted: number
  tips: number
  paidIn: number
  paidOut: number
  theoreticalDeposit: number
  cashDrawerRecon: number | null
  expectedDeposit: number
}

export interface DashboardData {
  rows: StoreSummaryRow[]
  totals: StoreSummaryRow
  channelRows: StoreSummaryRow[]
  /**
   * Channel rows scoped to a store, keyed
   * `<storeId>|||<platform>|||<paymentMethod>`. `channelRows` above is the
   * account-wide roll-up; these are what the overview ledger nests beneath each
   * store, where attributing an account-wide channel to one location would be
   * wrong the moment a second store trades.
   */
  storeChannelRows: StoreSummaryRow[]
  dateRange: { startDate: string; endDate: string }
  dayCount: number
  lastSyncAt: Date | string | null
}

// Menu category analytics
export interface MenuCategoryRow {
  category: string
  fpQuantitySold: number
  fpTotalInclModifiers: number
  fpTotalSales: number
  tpQuantitySold: number
  tpTotalInclModifiers: number
  tpTotalSales: number
  totalQuantitySold: number
  totalSales: number
}

export interface MenuItemRow extends Omit<MenuCategoryRow, 'category'> {
  itemName: string
  category: string
}

export interface MenuCategoryWithItems extends MenuCategoryRow {
  items: MenuItemRow[]
}

export interface MenuCategoryData {
  categories: MenuCategoryWithItems[]
  totals: {
    fpQuantitySold: number
    fpTotalSales: number
    tpQuantitySold: number
    tpTotalSales: number
    totalQuantitySold: number
    totalSales: number
  }
  dateRange: { startDate: string; endDate: string }
}

// Item explorer detail (fetched on demand)
export interface ItemDailyDetail {
  date: string
  fpQuantitySold: number
  tpQuantitySold: number
  fpSales: number
  tpSales: number
  totalQuantitySold: number
  totalSales: number
}

export interface ItemExplorerData {
  itemName: string
  category: string
  rank: number
  totalQuantitySold: number
  totalRevenue: number
  avgPricePerUnit: number
  fpQuantitySold: number
  tpQuantitySold: number
  fpSales: number
  tpSales: number
  growthPercent: number | null
  dailyTrend: ItemDailyDetail[]
}

// ========== Product Mix Report types ==========

export interface TreemapItemNode {
  name: string
  value: number
  category: string
  quantity: number
  avgPrice: number
}

export interface TreemapCategoryNode {
  name: string
  children: TreemapItemNode[]
  value?: number
}

export interface TreemapData {
  name: string
  children: TreemapCategoryNode[]
}

export interface QuickInsight {
  id: string
  text: string
  type: "info" | "positive" | "negative" | "warning"
}

export interface ParetoItem {
  itemName: string
  category: string
  revenue: number
  cumulativeRevenue: number
  cumulativePercent: number
  abcClass: "A" | "B" | "C"
}

export interface MatrixItem {
  itemName: string
  category: string
  quantitySold: number
  avgPrice: number
  revenue: number
  quadrant: "star" | "workhorse" | "puzzle" | "dog"
}

export interface MatrixThresholds {
  medianQuantity: number
  medianAvgPrice: number
}

export interface ProductMixTableItem {
  itemName: string
  category: string
  quantitySold: number
  revenue: number
  modifierRevenue: number
  avgPrice: number
  percentOfCategoryRevenue: number
  percentOfTotalRevenue: number
  fpQuantitySold: number
  tpQuantitySold: number
  fpSales: number
  tpSales: number
  periodChange: number | null
}

export interface ProductMixTableCategory {
  category: string
  items: ProductMixTableItem[]
  quantitySold: number
  revenue: number
  modifierRevenue: number
  percentOfTotalRevenue: number
  fpQuantitySold: number
  tpQuantitySold: number
  fpSales: number
  tpSales: number
  periodChange: number | null
}

export interface MoverItem {
  itemName: string
  category: string
  currentQuantity: number
  previousQuantity: number
  currentRevenue: number
  previousRevenue: number
  quantityChange: number
  quantityChangePercent: number
  revenueChange: number
  revenueChangePercent: number
}

export interface ProductMixData {
  treemap: TreemapData
  insights: QuickInsight[]
  paretoItems: ParetoItem[]
  matrixItems: MatrixItem[]
  matrixThresholds: MatrixThresholds
  tableCategories: ProductMixTableCategory[]
  tableTotals: {
    quantitySold: number
    revenue: number
    modifierRevenue: number
  }
  risers: MoverItem[]
  decliners: MoverItem[]
  dateRange: { startDate: string; endDate: string }
  dayCount: number
}

// ========== Order Patterns types ==========

export interface HourlyOrderPoint {
  hour: number
  label: string
  orderCount: number
  totalSales: number
  avgOrderCount: number
  avgTotalSales: number
  /**
   * What THIS hour did in each baseline week that has data for it — the
   * spread `avgOrderCount` is the mean of, published rather than discarded.
   *
   * Per-day, on the same divisor as `orderCount` and `avgOrderCount`: a
   * group's rows for the hour summed and divided by the group's day count, so
   * a week-long range's band sits beside week-long bars instead of seven
   * times above them.
   *
   * A week with NO data at this hour is dropped rather than counted as zero —
   * the same decision `OrderPatternsHourlyComparison.groupTotals` makes, for
   * the same reason: a missing week must not drag a band's floor to zero.
   * An EMPTY array therefore means "nothing is known about this hour", and a
   * consumer must draw no band there rather than a band of zero.
   */
  groupOrderCounts: number[]
}

export type HourlyComparisonPeriod =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  /** Any dashboard-selected range, resolved by `deriveRangeSpec`. */
  | "range"

export interface OrderPatternsHourlyComparison {
  period: HourlyComparisonPeriod
  currentTotal: number
  baselineTotal: number
  pacePct: number | null
  baselineWeeks: number
  weekdayLabel: string
  /** Net-sales twins of the order-count pace, same cutoff rules. */
  salesCurrentTotal: number
  salesBaselineTotal: number
  salesPacePct: number | null
  /** Latest hour (0–23) with data on the last current day, for "thru H PM" folios. */
  lastDataHour: number | null
  /** True when the range's last day is today, i.e. an hour cutoff was applied. */
  inProgress: boolean
  /**
   * Per-baseline-week totals behind `baselineTotal` / `salesBaselineTotal`,
   * weeks with no data removed. The overview's bullet tracks plot today's mark
   * against the spread of these, so an average alone is not enough.
   */
  groupTotals: number[]
  groupSalesTotals: number[]
}

export interface DayOfWeekOrderPoint {
  day: number
  label: string
  orderCount: number
  totalSales: number
  avgOrders: number
}

export interface MonthlyOrderPoint {
  month: string
  label: string
  orderCount: number
  totalSales: number
}

export interface OrderPatternsData {
  hourly: HourlyOrderPoint[]
  hourlyComparison: OrderPatternsHourlyComparison | null
  byDayOfWeek: DayOfWeekOrderPoint[]
  byMonth: MonthlyOrderPoint[]
}
