"use client"

import dynamic from "next/dynamic"
import { ChartSkeleton } from "@/components/skeletons"

export const RevenueTrendChartSlot = dynamic(
  () =>
    import("@/components/charts/revenue-trend-chart").then((m) => ({
      default: m.RevenueTrendChart,
    })),
  {
    loading: () => (
      <ChartSkeleton
        height="h-[200px] md:h-[220px] lg:h-[240px]"
        showToggle
      />
    ),
    ssr: false,
  }
)
