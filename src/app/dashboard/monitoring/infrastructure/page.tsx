import { DatabasePanel } from "@/components/monitoring/database-panel"
import { R2BucketPanel } from "@/components/monitoring/infrastructure/r2-bucket-panel"
import { getDbSize, getTableSizes, getConnections } from "@/lib/monitoring/db-stats"
import { getLatestR2Snapshot } from "@/lib/monitoring/r2-stats"

export const dynamic = "force-dynamic"

export default async function InfrastructurePage() {
  const [db, tables, conn, r2Snap] = await Promise.all([
    getDbSize(),
    getTableSizes(12),
    getConnections(),
    getLatestR2Snapshot(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <R2BucketPanel snapshot={r2Snap} />
      <div id="db">
        <DatabasePanel db={db} tables={tables} conn={conn} />
      </div>
    </div>
  )
}
