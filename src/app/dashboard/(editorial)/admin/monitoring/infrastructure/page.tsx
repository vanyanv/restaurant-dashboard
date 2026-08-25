import { Suspense } from "react"
import { DatabasePanel } from "@/components/monitoring/database-panel"
import { R2BucketPanel } from "@/components/monitoring/infrastructure/r2-bucket-panel"
import { TokensPanel } from "@/components/monitoring/tokens-panel"
import { getDbSize, getTableSizes, getConnections } from "@/lib/monitoring/db-stats"
import { getLatestR2Snapshot } from "@/lib/monitoring/r2-stats"
import { getAllTokenHealth } from "@/lib/monitoring/jwt-health"
import { monoLabel } from "@/components/monitoring/styles"

export const dynamic = "force-dynamic"

export default function InfrastructurePage() {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<PanelLoading dept="R2" />}>
        <R2Block />
      </Suspense>
      <Suspense fallback={<PanelLoading dept="§ Tokens" />}>
        <TokensBlock />
      </Suspense>
      <div id="db">
        <Suspense fallback={<PanelLoading dept="DATABASE" tall />}>
          <DbBlock />
        </Suspense>
      </div>
    </div>
  )
}

async function R2Block() {
  const snap = await getLatestR2Snapshot()
  return <R2BucketPanel snapshot={snap} />
}

async function TokensBlock() {
  const rows = await getAllTokenHealth()
  return <TokensPanel rows={rows} />
}

async function DbBlock() {
  const [db, tables, conn] = await Promise.all([
    getDbSize(),
    getTableSizes(12),
    getConnections(),
  ])
  return <DatabasePanel db={db} tables={tables} conn={conn} />
}

function PanelLoading({ dept, tall = false }: { dept: string; tall?: boolean }) {
  return (
    <section className="inv-panel" aria-busy="true" aria-live="polite">
      <div
        className="inv-panel__head"
        style={{ display: "flex", alignItems: "baseline", gap: 12 }}
      >
        <span className="inv-panel__dept">{dept}</span>
        <span style={{ ...monoLabel, color: "var(--ink-faint)", letterSpacing: "0.18em" }}>
          loading…
        </span>
      </div>
      <div
        style={{
          height: tall ? 220 : 72,
          borderTop: "1px solid var(--hairline)",
        }}
      />
    </section>
  )
}
