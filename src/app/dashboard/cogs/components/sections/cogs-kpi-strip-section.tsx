import type { CogsFilters } from "./data"

export function CogsKpiStripSection(_props: {
  storeId: string
  filters: CogsFilters
}) {
  return <div className="text-xs text-(--ink-muted) italic">Section pending…</div>
}
