"use client"

import dynamic from "next/dynamic"
import { ChartSkeleton } from "@/components/skeletons"

export const CogsTrendChart = dynamic(
  () => import("./cogs-trend-chart").then((m) => m.CogsTrendChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
