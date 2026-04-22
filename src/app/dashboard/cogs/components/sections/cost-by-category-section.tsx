import { getCostByCategory } from "@/lib/cogs"
import { CostByCategoryDonut } from "../cost-by-category-donut"
import type { CogsFilters } from "./data"

export async function CostByCategorySection({
  storeId,
  filters,
}: {
  storeId: string
  filters: CogsFilters
}) {
  const cats = await getCostByCategory(
    storeId,
    filters.startDate,
    filters.endDate
  )
  const total = cats.reduce((acc, c) => acc + c.cogsDollars, 0)

  return (
    <section>
      <div className="font-label mb-2">§ 03 · Cost by category</div>
      {cats.length === 0 || total === 0 ? (
        <div className="font-mono text-xs italic text-(--ink-muted) py-10 text-center border-t border-(--hairline)">
          No COGS data for this period — sync invoices and Otter sales.
        </div>
      ) : (
        <CostByCategoryDonut data={cats} total={total} />
      )}
    </section>
  )
}
