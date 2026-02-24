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

// Menu Performance page types
export interface MenuPerformanceKpis {
  totalItemsSold: number
  totalMenuRevenue: number
  uniqueItemsCount: number
  avgRevenuePerItem: number
  topSellingItem: {
    name: string
    quantity: number
    category: string
  } | null
}

export interface MenuPerformanceComparison {
  currentItemsSold: number
  previousItemsSold: number
  itemsSoldGrowth: number
  currentRevenue: number
  previousRevenue: number
  revenueGrowth: number
}

export interface MenuDailyTrend {
  date: string
  totalQuantitySold: number
  totalSales: number
  fpQuantitySold: number
  tpQuantitySold: number
  fpSales: number
  tpSales: number
}

export interface MenuCategorySalesBreakdown {
  category: string
  totalSales: number
  totalQuantitySold: number
  fpSales: number
  tpSales: number
  percentOfTotal: number
}

export interface MenuItemRanked {
  itemName: string
  category: string
  totalQuantitySold: number
  totalSales: number
  fpQuantitySold: number
  tpQuantitySold: number
  fpSales: number
  tpSales: number
  avgPricePerUnit: number
  fpShare: number
  tpShare: number
}

export interface MenuChannelComparison {
  category: string
  fpQuantitySold: number
  fpSales: number
  tpQuantitySold: number
  tpSales: number
}

export interface MenuPerformanceData {
  kpis: MenuPerformanceKpis
  comparison: MenuPerformanceComparison
  dailyTrends: MenuDailyTrend[]
  categoryBreakdown: MenuCategorySalesBreakdown[]
  topItems: MenuItemRanked[]
  allItems: MenuItemRanked[]
  channelComparison: MenuChannelComparison[]
  dateRange: { startDate: string; endDate: string }
  dayCount: number
}
