"use client"

import dynamic from "next/dynamic"
import { ChartSkeleton } from "@/components/skeletons"

/** Defers recharts off the /dashboard/invoices first-load bundle
 * until the spend-trend chart actually renders. */
export const SpendTrendClient = dynamic(
  () =>
    import("./spend-trend-client").then((m) => ({
      default: m.SpendTrendClient,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
