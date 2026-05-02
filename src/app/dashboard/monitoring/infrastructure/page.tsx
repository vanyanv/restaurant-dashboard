import { DatabasePanel } from "@/components/monitoring/database-panel"
import { VercelQuotasGrid } from "@/components/monitoring/infrastructure/vercel-quotas-grid"
import { R2BucketPanel } from "@/components/monitoring/infrastructure/r2-bucket-panel"
import { getDbSize, getTableSizes, getConnections } from "@/lib/monitoring/db-stats"
import { getLatestVercelSnapshot, type VercelUsageMetrics } from "@/lib/monitoring/vercel-usage"
import { getLatestR2Snapshot } from "@/lib/monitoring/r2-stats"

export const dynamic = "force-dynamic"

export default async function InfrastructurePage() {
  const [db, tables, conn, vercelSnap, r2Snap] = await Promise.all([
    getDbSize(),
    getTableSizes(12),
    getConnections(),
    getLatestVercelSnapshot(),
    getLatestR2Snapshot(),
  ])

  const metrics =
    (vercelSnap?.metrics as unknown as VercelUsageMetrics) ?? null

  return (
    <div className="flex flex-col gap-6">
      <VercelQuotasGrid metrics={metrics} capturedAt={vercelSnap?.capturedAt ?? null} />
      <R2BucketPanel snapshot={r2Snap} />
      <div id="db">
        <DatabasePanel db={db} tables={tables} conn={conn} />
      </div>
    </div>
  )
}
