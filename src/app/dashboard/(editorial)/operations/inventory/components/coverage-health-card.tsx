import type { InventoryCoverageHealthData } from "@/app/actions/inventory/coverage-health-actions"

interface Props {
  data: InventoryCoverageHealthData
}

function fmtMoney(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })
}

function fmtPct(n: number | null) {
  if (n == null) return "—"
  return `${(n * 100).toFixed(0)}%`
}

function fmtDateShort(d: Date) {
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function CoverageHealthCard({ data }: Props) {
  const lowCoverage = data.coveragePct != null && data.coveragePct < 0.9
  const hasGaps = data.conversionGapCount > 0

  return (
    <section className="inv-panel inv-panel--flush">
      <header className="inv-panel__head px-5 pt-4 pb-2 flex items-baseline justify-between">
        <span className="inv-panel__dept">Coverage health</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
          {fmtDateShort(data.windowStart)} → {fmtDateShort(data.windowEnd)}
        </span>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-3 border-t border-[var(--hairline)]">
        <div className="px-5 py-4 border-r border-[var(--hairline)]">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Sales coverage
          </div>
          <div
            className={`text-[28px] tabular-nums mt-1 ${lowCoverage ? "text-[var(--accent)]" : "text-[var(--ink)]"}`}
            style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {fmtPct(data.coveragePct)}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)] mt-1">
            {fmtMoney(data.mappedRevenue)} mapped / {fmtMoney(data.totalSalesRevenue)} total
          </div>
        </div>
        <div className="px-5 py-4 border-r border-[var(--hairline)]">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Unmapped sales
          </div>
          <div
            className="text-[28px] tabular-nums mt-1 text-[var(--ink)]"
            style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {fmtMoney(data.unmappedRevenue)}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)] mt-1">
            sales without a recipe link
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
            Conversion gaps
          </div>
          <div
            className={`text-[28px] tabular-nums mt-1 ${hasGaps ? "text-[var(--accent)]" : "text-[var(--ink)]"}`}
            style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {data.conversionGapCount}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)] mt-1">
            sku matches stuck at factor 1
          </div>
        </div>
      </div>
    </section>
  )
}
