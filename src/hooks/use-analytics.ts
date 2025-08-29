import { useQuery } from "@tanstack/react-query"

export interface AnalyticsData {
  todayReports: number
  totalReports: number
  totalRevenue: number
  averageTips: number
  avgPrepCompletion: number
  trends: {
    revenueGrowth: number
    currentWeekRevenue: number
    previousWeekRevenue: number
  }
  storeCount: number
  revenueByDay?: any[]
  salesBreakdown?: {
    cash: number
    card: number
    cashPercentage: number
    cardPercentage: number
  }
  recentReports?: any[]
  isAllStores?: boolean
}

// Default analytics data when no stores exist or API fails
const defaultAnalytics: AnalyticsData = {
  todayReports: 0,
  totalReports: 0,
  totalRevenue: 0,
  averageTips: 0,
  avgPrepCompletion: 0,
  trends: {
    revenueGrowth: 0,
    currentWeekRevenue: 0,
    previousWeekRevenue: 0
  },
  storeCount: 0,
  revenueByDay: [],
  salesBreakdown: {
    cash: 0,
    card: 0,
    cashPercentage: 0,
    cardPercentage: 0
  },
  recentReports: [],
  isAllStores: true
}

// Fetch analytics data
async function fetchAnalytics(storeId: string = 'all', days: number = 30): Promise<AnalyticsData> {
  const response = await fetch(`/api/analytics?storeId=${storeId}&days=${days}`)
  
  if (!response.ok) {
    // If analytics fails, return default data instead of throwing
    console.warn('Analytics API failed, using default data')
    return defaultAnalytics
  }
  
  return response.json()
}

// Hook to fetch analytics - only enabled when stores exist
export function useAnalytics(storeCount: number, storeId: string = 'all', days: number = 30) {
  return useQuery({
    queryKey: ['analytics', storeId, days],
    queryFn: () => fetchAnalytics(storeId, days),
    enabled: storeCount > 0, // Only fetch if stores exist
    staleTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: defaultAnalytics, // Show default data while loading
    retry: (failureCount, error) => {
      // Don't retry if it's a 404 (no stores)
      if (error && 'status' in error && error.status === 404) {
        return false
      }
      return failureCount < 2
    }
  })
}

// Hook for single store analytics
export function useStoreAnalytics(storeId: string, days: number = 30) {
  return useQuery({
    queryKey: ['analytics', storeId, days],
    queryFn: () => fetchAnalytics(storeId, days),
    enabled: !!storeId,
    staleTime: 5 * 60 * 1000,
    placeholderData: defaultAnalytics,
  })
}