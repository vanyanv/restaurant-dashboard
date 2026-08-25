import { loadMenuEngineering } from "./data"

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

/**
 * Four-figure brief: revenue, food cost, blended margin, and how much of the
 * revenue those figures actually cover. Numbers in DM Sans tabular-nums per
 * the two-tier rule; captions in JetBrains Mono.
 */
export async function KpiStripSection({
  storeId,
  days,
}: {
  storeId?: string
  days: number
}) {
  const result = await loadMenuEngineering(storeId, days)
  if (!result?.ok) {
    return (
      <section className="inv-panel dock-in dock-in-1">
        <div className="inv-panel__head">
          <div>
            <span className="inv-panel__dept">§ 14 Menu</span>
            <h2 className="inv-panel__title">Menu KPIs</h2>
          </div>
        </div>
        <p className="pt-2 text-[13px] text-[var(--ink-muted)]">
          We couldn&apos;t load this section right now. Try refreshing in a
          moment.
        </p>
      </section>
    )
  }
  const { rows, coverage } = result.data

  const revenue = rows.reduce((s, r) => s + r.revenue, 0)
  const cogs = rows.reduce((s, r) => s + r.cogs, 0)
  const marginPct = revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0

  const kpis = [
    { label: `Revenue · ${days}d`, value: money(revenue) },
    { label: "Food cost", value: money(cogs) },
    { label: "Blended margin", value: `${marginPct.toFixed(1)}%` },
    { label: "Costed coverage", value: `${coverage.coveragePct.toFixed(1)}%` },
  ]

  return (
    <section className="inv-panel dock-in dock-in-1">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="flex flex-col gap-1">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--ink-muted)]">
              {kpi.label}
            </span>
            <span
              className="text-[26px] font-semibold leading-none tracking-[-0.015em] text-[var(--ink)]"
              style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
            >
              {kpi.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
