import { prisma } from "@/lib/prisma"

interface StoreLifecycleRow {
  id: string
  name: string
  lifecycleStage: "pre_open" | "warming_up" | "ready"
  openedAt: Date | null
  initialTransferScalar: number | null
  /** Sample size from the latest REVENUE evaluation (drives the warming-up bar). */
  sampleSize: number | null
}

async function loadRows(): Promise<StoreLifecycleRow[]> {
  const stores = await prisma.store.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, lifecycleStage: true,
      openedAt: true, initialTransferScalar: true,
    },
    orderBy: { name: "asc" },
  })
  const sampleSizes = new Map<string, number>()
  if (stores.length > 0) {
    const latest = await prisma.$queryRaw<
      { storeId: string; sampleSize: number }[]
    >`
      SELECT DISTINCT ON (e."storeId") e."storeId", e."sampleSize"
      FROM "MlForecastEvaluation" e
      WHERE e.target = 'REVENUE'
      ORDER BY e."storeId", e."computedAt" DESC
    `
    for (const r of latest) sampleSizes.set(r.storeId, r.sampleSize)
  }
  return stores.map((s) => ({
    ...s,
    sampleSize: sampleSizes.get(s.id) ?? null,
  }))
}

function daysSinceOpen(openedAt: Date | null): number | null {
  if (!openedAt) return null
  return Math.floor((Date.now() - openedAt.getTime()) / 86400000) + 1
}

const STAGE_LABEL: Record<StoreLifecycleRow["lifecycleStage"], string> = {
  pre_open: "PRE-OPEN",
  warming_up: "WARMING UP",
  ready: "READY",
}

export async function LifecycleSection() {
  const rows = await loadRows()
  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">§ 03 Store lifecycle</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
          warming target n=60
        </span>
      </header>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left">
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">Store</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">Stage</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">Days open</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">Sample size</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const days = daysSinceOpen(r.openedAt)
            const progressPct =
              r.lifecycleStage === "warming_up" && r.sampleSize != null
                ? Math.min(100, Math.round((r.sampleSize / 60) * 100))
                : null
            return (
              <tr key={r.id} className="inv-row group border-t border-[color:var(--hairline)]">
                <td className="px-5 py-2 font-serif italic">{r.name}</td>
                <td className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">
                  {STAGE_LABEL[r.lifecycleStage]}
                </td>
                <td className="px-5 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>
                  {days == null ? "—" : days}
                </td>
                <td className="px-5 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>
                  {r.sampleSize == null ? "—" : (
                    progressPct != null
                      ? `${r.sampleSize} / 60 (${progressPct}%)`
                      : r.sampleSize
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
