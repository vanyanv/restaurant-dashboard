"use client"

import dynamic from "next/dynamic"
import {
  ChartSkeleton,
  PieChartSkeleton,
  HeatmapSkeleton,
} from "@/components/skeletons"

export const RevenueHeatmapSlot = dynamic(
  () =>
    import("@/components/charts/revenue-heatmap").then((m) => ({
      default: m.RevenueHeatmap,
    })),
  { loading: () => <HeatmapSkeleton />, ssr: false }
)

export const PlatformTrendChartSlot = dynamic(
  () =>
    import("@/components/charts/platform-trend-chart").then((m) => ({
      default: m.PlatformTrendChart,
    })),
  {
    loading: () => (
      <ChartSkeleton height="h-[240px] md:h-[280px] lg:h-[300px]" />
    ),
    ssr: false,
  }
)

export const PlatformBreakdownChartSlot = dynamic(
  () =>
    import("@/components/charts/platform-breakdown-chart").then((m) => ({
      default: m.PlatformBreakdownChart,
    })),
  { loading: () => <ChartSkeleton />, ssr: false }
)

export const PaymentSplitChartSlot = dynamic(
  () =>
    import("@/components/charts/payment-split-chart").then((m) => ({
      default: m.PaymentSplitChart,
    })),
  { loading: () => <PieChartSkeleton />, ssr: false }
)

export const TopItemsChartSlot = dynamic(
  () =>
    import("@/components/charts/top-items-chart").then((m) => ({
      default: m.TopItemsChart,
    })),
  { loading: () => <ChartSkeleton />, ssr: false }
)

export const StoreComparisonChartSlot = dynamic(
  () =>
    import("@/components/charts/store-comparison-chart").then((m) => ({
      default: m.StoreComparisonChart,
    })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
