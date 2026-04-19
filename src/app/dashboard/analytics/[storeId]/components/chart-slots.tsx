"use client"

import dynamic from "next/dynamic"
import {
  ChartSkeleton,
  PieChartSkeleton,
  HeatmapSkeleton,
  MenuCategoryTableSkeleton,
} from "@/components/skeletons"

export const RevenueTrendChartSlot = dynamic(
  () =>
    import("@/components/charts/revenue-trend-chart").then((m) => ({
      default: m.RevenueTrendChart,
    })),
  {
    loading: () => (
      <ChartSkeleton
        height="h-[280px] md:h-[340px] lg:h-[380px]"
        showToggle
      />
    ),
    ssr: false,
  }
)

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

export const MenuCategoryTableSlot = dynamic(
  () =>
    import("@/components/analytics/menu-category-table").then((m) => ({
      default: m.MenuCategoryTable,
    })),
  { loading: () => <MenuCategoryTableSkeleton />, ssr: false }
)

export const HourlyOrdersChartSlot = dynamic(
  () =>
    import("@/components/charts/hourly-orders-chart").then((m) => ({
      default: m.HourlyOrdersChart,
    })),
  { loading: () => <ChartSkeleton />, ssr: false }
)

export const DayOfWeekChartSlot = dynamic(
  () =>
    import("@/components/charts/day-of-week-chart").then((m) => ({
      default: m.DayOfWeekChart,
    })),
  { loading: () => <ChartSkeleton />, ssr: false }
)

export const MonthlyOrdersChartSlot = dynamic(
  () =>
    import("@/components/charts/monthly-orders-chart").then((m) => ({
      default: m.MonthlyOrdersChart,
    })),
  { loading: () => <ChartSkeleton />, ssr: false }
)
