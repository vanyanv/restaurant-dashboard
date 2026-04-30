"use client"

import dynamic from "next/dynamic"
import { PieChartSkeleton } from "@/components/skeletons"

export const CostByCategoryDonut = dynamic(
  () => import("./cost-by-category-donut").then((m) => m.CostByCategoryDonut),
  { ssr: false, loading: () => <PieChartSkeleton /> }
)
