"use client"

import dynamic from "next/dynamic"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export const InvoicesChartsSlot = dynamic(
  () =>
    import("./invoices-charts-client").then((m) => ({
      default: m.InvoicesCharts,
    })),
  {
    loading: () => (
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-[220px] w-full rounded-md" />
            </CardContent>
          </Card>
        ))}
      </div>
    ),
    ssr: false,
  }
)
