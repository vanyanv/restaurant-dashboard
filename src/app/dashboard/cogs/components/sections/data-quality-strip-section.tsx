import Link from "next/link"
import { getDataQualityCounts } from "@/lib/cogs"
import type { CogsFilters } from "./data"

export async function DataQualityStripSection({
  storeId,
  filters,
}: {
  storeId: string
  filters: CogsFilters
}) {
  const dq = await getDataQualityCounts(
    storeId,
    filters.startDate,
    filters.endDate
  )

  if (dq.unmapped === 0 && dq.missingCost === 0) return null

  const parts: string[] = []
  if (dq.unmapped > 0)
    parts.push(`${dq.unmapped} item${dq.unmapped === 1 ? "" : "s"} unmapped`)
  if (dq.missingCost > 0)
    parts.push(
      `${dq.missingCost} item${dq.missingCost === 1 ? "" : "s"} missing cost`
    )

  return (
    <aside className="cogs-corrigenda" role="status">
      <span>
        <em>Corrigenda.</em> {parts.join(" · ")} — figures below understate true
        food cost until resolved.
      </span>
      <Link href="/dashboard/recipes" className="font-mono text-[11px]">
        Resolve →
      </Link>
    </aside>
  )
}
