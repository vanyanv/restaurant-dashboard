"use client"

import dynamic from "next/dynamic"
import { ChartSkeleton, PieChartSkeleton, HeatmapSkeleton } from "@/components/skeletons"

export const RevenueTrendChartSlot = dynamic(
  () => import("@/components/charts/revenue-trend-chart").then((m) => m.RevenueTrendChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)

export const RevenueHeatmapSlot = dynamic(
  () => import("@/components/charts/revenue-heatmap").then((m) => m.RevenueHeatmap),
  { ssr: false, loading: () => <HeatmapSkeleton /> }
)

export const PlatformTrendChartSlot = dynamic(
  () => import("@/components/charts/platform-trend-chart").then((m) => m.PlatformTrendChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)

export const PlatformBreakdownChartSlot = dynamic(
  () => import("@/components/charts/platform-breakdown-chart").then((m) => m.PlatformBreakdownChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)

export const PaymentSplitChartSlot = dynamic(
  () => import("@/components/charts/payment-split-chart").then((m) => m.PaymentSplitChart),
  { ssr: false, loading: () => <PieChartSkeleton /> }
)

export const TopItemsChartSlot = dynamic(
  () => import("@/components/charts/top-items-chart").then((m) => m.TopItemsChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)

export const MenuCategoryTableSlot = dynamic(
  () => import("@/components/analytics/menu-category-table").then((m) => m.MenuCategoryTable),
  { ssr: false, loading: () => <ChartSkeleton /> }
)

export const HourlyOrdersChartSlot = dynamic(
  () => import("@/components/charts/hourly-orders-chart").then((m) => m.HourlyOrdersChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)

export const DayOfWeekChartSlot = dynamic(
  () => import("@/components/charts/day-of-week-chart").then((m) => m.DayOfWeekChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)

export const MonthlyOrdersChartSlot = dynamic(
  () => import("@/components/charts/monthly-orders-chart").then((m) => m.MonthlyOrdersChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
