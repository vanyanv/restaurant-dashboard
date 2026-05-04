"use client"

import dynamic from "next/dynamic"
import { ChartSkeleton } from "@/components/skeletons"

/** This used to be a static re-export named "slot" but it didn't actually
 * lazy-load — recharts shipped with the /dashboard/invoices first-load
 * bundle. Switch to a real dynamic({ ssr: false }) wrapper so the
 * recharts chunk only fetches when the chart renders. */
export const InvoicesChartsSlot = dynamic(
  () =>
    import("./invoices-charts-client").then((m) => ({
      default: m.InvoicesCharts,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
