"use client"

import dynamic from "next/dynamic"
import { ChartSkeleton } from "@/components/skeletons"

export const OperationsCharts = dynamic(
  () =>
    import("./operations-charts").then((m) => ({
      default: m.OperationsCharts,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
