import { AiSpendChart } from "./charts/ai-spend-chart"
import { CacheHitChart } from "./charts/cache-hit-chart"
import { DbGrowthChart } from "./charts/db-growth-chart"
import { SyncRunsChart } from "./charts/sync-runs-chart"
import { monoLabel } from "./styles"

type Props = {
  dbGrowth: { date: Date; totalBytes: number }[]
  capBytes: number
  aiCostByDay: { day: Date; cost: number }[]
  syncRunsByDay: {
    day: Date
    success: number
    failure: number
    partial: number
    running: number
  }[]
  cacheHitByDay: { day: Date; hitPct: number }[]
}

export function DashboardCharts(props: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
      <ChartCard dept="DATABASE" caption="growth · 30d">
        <DbGrowthChart data={props.dbGrowth} capBytes={props.capBytes} />
      </ChartCard>
      <ChartCard dept="AI SPEND" caption="daily · 30d">
        <AiSpendChart data={props.aiCostByDay} />
      </ChartCard>
      <ChartCard dept="SYNC RUNS" caption="by status · 7d">
        <SyncRunsChart data={props.syncRunsByDay} />
      </ChartCard>
      <ChartCard dept="CACHE" caption="hit rate · 7d">
        <CacheHitChart data={props.cacheHitByDay} />
      </ChartCard>
    </div>
  )
}

function ChartCard({
  dept,
  caption,
  children,
}: {
  dept: string
  caption: string
  children: React.ReactNode
}) {
  return (
    <section className="inv-panel" style={{ padding: "14px 16px" }}>
      <div
        className="inv-panel__head"
        style={{ paddingBottom: 10, marginBottom: 10 }}
      >
        <span className="inv-panel__dept">{dept}</span>
        <span style={{ ...monoLabel, color: "var(--ink-faint)" }}>
          {caption}
        </span>
      </div>
      {children}
    </section>
  )
}
