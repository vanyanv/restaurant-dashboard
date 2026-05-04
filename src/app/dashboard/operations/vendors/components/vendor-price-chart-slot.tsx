"use client"

import dynamic from "next/dynamic"
import { ChartSkeleton } from "@/components/skeletons"

/** Defers recharts off the /dashboard/operations/vendors first-load
 * bundle until the chart actually renders. */
export const VendorPriceChart = dynamic(
  () =>
    import("./vendor-price-chart").then((m) => ({
      default: m.VendorPriceChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
