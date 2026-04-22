import { getCogsKpis } from "@/lib/cogs"
import { formatMoneyLarge } from "@/app/dashboard/components/hero-kpi"
import { CogsHeroPct } from "../cogs-hero-pct"
import type { CogsFilters } from "./data"

function formatPp(pp: number | null): { text: string; dir: "up" | "down" | "flat" } {
  if (pp == null) return { text: "—", dir: "flat" }
  const abs = Math.abs(pp).toFixed(1)
  if (pp > 0) return { text: `▲ ${abs}pp`, dir: "up" }
  if (pp < 0) return { text: `▼ ${abs}pp`, dir: "down" }
  return { text: "·", dir: "flat" }
}

export async function CogsKpiStripSection({
  storeId,
  filters,
}: {
  storeId: string
  filters: CogsFilters
}) {
  const k = await getCogsKpis(storeId, filters.startDate, filters.endDate)

  const isOverTarget =
    k.targetCogsPct != null && k.cogsPct > k.targetCogsPct

  const priorPp = formatPp(k.deltaVsPriorPp)
  const targetPp = formatPp(k.deltaVsTargetPp)

  if (k.revenueDollars === 0 && k.cogsDollars === 0) {
    return (
      <div className="font-mono text-xs italic text-(--ink-muted) py-12 text-center">
        No COGS data for this period — sync invoices and Otter sales.
      </div>
    )
  }

  return (
    <section
      className="grid grid-cols-1 gap-6 lg:grid-cols-2"
      aria-label="COGS headline KPIs"
    >
      <div className="flex flex-col justify-end pb-2 dock-in dock-in-1">
        <div className="font-label">§ 01 · Food cost</div>
        <CogsHeroPct value={k.cogsPct} isOver={isOverTarget} />
      </div>
      <dl className="grid grid-cols-1 divide-y divide-(--hairline) text-sm">
        <div className="flex items-baseline justify-between py-2 dock-in dock-in-2">
          <dt className="font-label">COGS $</dt>
          <dd className="font-mono">{formatMoneyLarge(k.cogsDollars)}</dd>
        </div>
        <div className="flex items-baseline justify-between py-2 dock-in dock-in-3">
          <dt className="font-label">Δ vs prior period</dt>
          <dd
            className={`font-mono ${
              priorPp.dir === "up"
                ? "text-(--accent-dark)"
                : "text-(--ink-muted)"
            }`}
          >
            {priorPp.text}
          </dd>
        </div>
        <div className="flex items-baseline justify-between py-2 dock-in dock-in-4">
          <dt className="font-label">vs target</dt>
          <dd className="font-mono">
            {k.targetCogsPct == null ? (
              <span className="italic text-(--ink-muted)">no target</span>
            ) : (
              targetPp.text
            )}
          </dd>
        </div>
      </dl>
    </section>
  )
}
