import type { OverviewKpis } from "@/lib/ai-analytics/routes/overview"

/**
 * The four-column KPI strip at the top of the Overview. Hairline-divided cells
 * inside one `.inv-panel`. Numbers are tabular DM Sans 600; deltas are mono;
 * labels are mono caps. Negative deltas pick up the proofmark red — earning
 * the red here feels right because a negative-vs-prior is a state change the
 * operator should notice.
 */
export function KpiStrip({ kpis }: { kpis: OverviewKpis }) {
  return (
    <section className="inv-panel">
      <div className="grid grid-cols-2 divide-x divide-(--hairline) sm:grid-cols-4">
        <KpiCell
          label="Revenue"
          value={`$${formatDollars(kpis.revenueDollars)}`}
          delta={
            kpis.revenueDeltaPct == null
              ? null
              : { pct: kpis.revenueDeltaPct, betterWhenHigher: true }
          }
          subnote={`prior $${formatDollars(kpis.priorRevenueDollars)}`}
        />
        <KpiCell
          label="COGS %"
          value={`${kpis.cogsPct.toFixed(1)}%`}
          delta={
            kpis.cogsDeltaPp == null
              ? null
              : { pp: kpis.cogsDeltaPp, betterWhenHigher: false }
          }
          subnote={
            kpis.targetCogsPct != null
              ? `target ${kpis.targetCogsPct.toFixed(1)}%`
              : `prior ${kpis.priorCogsPct?.toFixed(1) ?? "—"}%`
          }
        />
        <KpiCell
          label="Orders"
          value={kpis.totalOrders.toLocaleString("en-US")}
          delta={
            kpis.ordersDeltaPct == null
              ? null
              : { pct: kpis.ordersDeltaPct, betterWhenHigher: true }
          }
          subnote={`prior ${kpis.priorTotalOrders.toLocaleString("en-US")}`}
        />
        <KpiCell
          label="COGS $"
          value={`$${formatDollars(kpis.cogsDollars)}`}
          subnote={kpis.windowLabel}
        />
      </div>
    </section>
  )
}

function KpiCell({
  label,
  value,
  delta,
  subnote,
}: {
  label: string
  value: string
  delta?: { pct?: number; pp?: number; betterWhenHigher: boolean } | null
  subnote?: string
}) {
  let deltaText: string | null = null
  let deltaIsBad = false
  if (delta) {
    if (delta.pct != null) {
      const sign = delta.pct >= 0 ? "+" : ""
      deltaText = `${sign}${delta.pct.toFixed(1)}%`
      deltaIsBad = delta.betterWhenHigher ? delta.pct < 0 : delta.pct > 0
    } else if (delta.pp != null) {
      const sign = delta.pp >= 0 ? "+" : ""
      deltaText = `${sign}${delta.pp.toFixed(1)}pp`
      deltaIsBad = delta.betterWhenHigher ? delta.pp < 0 : delta.pp > 0
    }
  }

  return (
    <div className="flex flex-col gap-1.5 px-5 py-2 first:pl-0 last:pr-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
        {label}
      </span>
      <div className="flex items-baseline gap-3">
        <span className="font-sans text-[26px] font-semibold tabular-nums leading-none tracking-[-0.018em] text-(--ink)">
          {value}
        </span>
        {deltaText ? (
          <span
            className={`font-mono text-[11px] tabular-nums tracking-[0.05em] ${deltaIsBad ? "text-(--accent)" : "text-(--ink-muted)"}`}
          >
            {deltaText}
          </span>
        ) : null}
      </div>
      {subnote ? (
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-(--ink-faint)">
          {subnote}
        </span>
      ) : null}
    </div>
  )
}

function formatDollars(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}
