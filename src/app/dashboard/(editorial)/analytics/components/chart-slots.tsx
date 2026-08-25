"use client"

import dynamic from "next/dynamic"
import { ChartSkeleton, PieChartSkeleton, HeatmapSkeleton } from "@/components/skeletons"

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

export const StoreComparisonChartSlot = dynamic(
  () => import("@/components/charts/store-comparison-chart").then((m) => m.StoreComparisonChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
