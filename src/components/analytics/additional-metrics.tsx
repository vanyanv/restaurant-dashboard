"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/format"
import type { StoreAnalyticsKpis } from "@/types/analytics"
import { Separator } from "@/components/ui/separator"

interface AdditionalMetricsProps {
  kpis: StoreAnalyticsKpis
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

export function AdditionalMetrics({ kpis }: AdditionalMetricsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {/* Service Charges & Loyalty */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Service Charges & Loyalty
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <MetricRow
            label="Service Charges"
            value={formatCurrency(kpis.totalServiceCharges)}
          />
          <Separator />
          <MetricRow
            label="Loyalty Discounts"
            value={formatCurrency(kpis.totalLoyalty)}
          />
        </CardContent>
      </Card>

      {/* Refunds & Lost Revenue */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Refunds & Lost Revenue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <MetricRow
            label="3P Refunds/Adj."
            value={formatCurrency(kpis.totalRefundsAdjustments)}
          />
          <Separator />
          <MetricRow
            label="FP Lost Revenue"
            value={formatCurrency(kpis.totalLostRevenue)}
          />
        </CardContent>
      </Card>

      {/* Till Reconciliation */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Till Reconciliation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <MetricRow
            label="Paid In"
            value={formatCurrency(kpis.tillPaidIn)}
          />
          <MetricRow
            label="Paid Out"
            value={formatCurrency(kpis.tillPaidOut)}
          />
          <Separator />
          <MetricRow
            label="Net"
            value={formatCurrency(kpis.tillNet)}
          />
        </CardContent>
      </Card>
    </div>
  )
}
