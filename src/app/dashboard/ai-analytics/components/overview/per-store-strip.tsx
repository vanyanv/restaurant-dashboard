import Link from "next/link"
import type { PerStoreSnapshot } from "@/lib/ai-analytics/routes/overview"

/**
 * The all-stores comparison strip. Hairline-ruled list, no nested cards.
 * Each row links to that store's scoped Overview (`?store=<id>`). Visually
 * this reads like a small ledger table — that's the point.
 */
export function PerStoreStrip({
  perStore,
}: {
  perStore: PerStoreSnapshot[]
}) {
  if (perStore.length === 0) return null

  // Sort: highest COGS% first (the most "concerning" stores rise to the top).
  const sorted = [...perStore].sort((a, b) => b.cogsPct - a.cogsPct)

  return (
    <section className="inv-panel">
      <header className="inv-panel__head">
        <h2 className="font-display text-[17px] italic text-(--ink)">
          By store
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
          last 7d
        </span>
      </header>

      <div className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-6 gap-y-0">
        <div className="contents font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
          <span>Store</span>
          <span className="text-right">Revenue</span>
          <span className="text-right">COGS %</span>
          <span className="text-right">Orders</span>
        </div>

        {sorted.map((s) => (
          <Link
            key={s.storeId}
            href={`/dashboard/ai-analytics?store=${s.storeId}`}
            className="contents text-(--ink) hover:text-(--accent)"
          >
            <span className="border-t border-(--hairline) py-3 font-display text-[17px] italic">
              {s.storeName}
            </span>
            <span className="border-t border-(--hairline) py-3 text-right font-sans text-[14.5px] font-medium tabular-nums tracking-[-0.01em]">
              ${formatDollars(s.revenueDollars)}
            </span>
            <span className="border-t border-(--hairline) py-3 text-right font-sans text-[14.5px] font-medium tabular-nums tracking-[-0.01em]">
              {s.cogsPct.toFixed(1)}%
            </span>
            <span className="border-t border-(--hairline) py-3 text-right font-sans text-[14.5px] font-medium tabular-nums tracking-[-0.01em]">
              {s.totalOrders.toLocaleString("en-US")}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function formatDollars(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}
