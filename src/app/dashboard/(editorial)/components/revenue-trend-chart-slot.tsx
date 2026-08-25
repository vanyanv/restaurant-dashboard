"use client"

import dynamic from "next/dynamic"
import { ChartSkeleton } from "@/components/skeletons"

export const RevenueTrendChartSlot = dynamic(
  () => import("@/components/charts/revenue-trend-chart").then((m) => m.RevenueTrendChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
