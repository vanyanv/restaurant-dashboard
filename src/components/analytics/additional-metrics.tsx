"use client"

import { formatCurrency } from "@/lib/format"
import type { StoreAnalyticsKpis } from "@/types/analytics"

interface AdditionalMetricsProps {
  kpis: StoreAnalyticsKpis
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-(--ink-muted)">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

function MetricPanel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="inv-panel">
      <header className="inv-panel__head">
        <span className="inv-panel__dept">{title}</span>
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export function AdditionalMetrics({ kpis }: AdditionalMetricsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <MetricPanel title="Service Charges & Loyalty">
        <MetricRow
          label="Service Charges"
          value={formatCurrency(kpis.totalServiceCharges)}
        />
        <div className="border-t border-(--hairline) my-1" />
        <MetricRow
          label="Loyalty Discounts"
          value={formatCurrency(kpis.totalLoyalty)}
        />
      </MetricPanel>

      <MetricPanel title="Refunds & Lost Revenue">
        <MetricRow
          label="3P Refunds/Adj."
          value={formatCurrency(kpis.totalRefundsAdjustments)}
        />
        <div className="border-t border-(--hairline) my-1" />
        <MetricRow
          label="FP Lost Revenue"
          value={formatCurrency(kpis.totalLostRevenue)}
        />
      </MetricPanel>

      <MetricPanel title="Till Reconciliation">
        <MetricRow label="Paid In" value={formatCurrency(kpis.tillPaidIn)} />
        <MetricRow label="Paid Out" value={formatCurrency(kpis.tillPaidOut)} />
        <div className="border-t border-(--hairline) my-1" />
        <MetricRow label="Net" value={formatCurrency(kpis.tillNet)} />
      </MetricPanel>
    </div>
  )
}
