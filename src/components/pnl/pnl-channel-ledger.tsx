import { cn } from "@/lib/utils"

/**
 * Channel breakdown as a horizontal stacked bar + itemized ledger. Replaces
 * the donut — bars are easier to read precisely, and this format rhymes with
 * the platform-stamp motif used elsewhere.
 */
export interface PnLChannelLedgerProps {
  data: Array<{ channel: string; amount: number }>
  className?: string
}

const CHANNEL_COLOR: Record<string, string> = {
  "Credit Cards": "#1d4ed8",
  Cash: "#047857",
  Uber: "#0b0b0b",
  DoorDash: "#eb1700",
  Grubhub: "#f15c26",
  ChowNow: "#16a085",
  "EZ Cater": "#7c3aed",
  Fooda: "#db2777",
  "Otter Online": "#4338ca",
  "Otter Prepaid": "#5b21b6",
  Beverage: "#0891b2",
}

function formatDollar(v: number): string {
  if (!Number.isFinite(v)) return "—"
  const abs = Math.abs(v)
  const str = abs.toLocaleString("en-US", { maximumFractionDigits: 0 })
  return v < 0 ? `−$${str}` : `$${str}`
}

export function PnLChannelLedger({ data, className }: PnLChannelLedgerProps) {
  const filtered = data.filter((d) => d.amount > 0)
  const total = filtered.reduce((a, b) => a + b.amount, 0)
  const sorted = [...filtered].sort((a, b) => b.amount - a.amount)

  return (
    <section className={cn("pnl-channel-ledger", className)} aria-label="Channel mix">
      <div className="pnl-channel-ledger__header">
        <span className="editorial-section-label">Channel Mix</span>
        <span className="pnl-channel-ledger__total font-mono">
          {formatDollar(total)} <span className="pnl-channel-ledger__totalKey">gross</span>
        </span>
      </div>

      {total === 0 ? (
        <p className="pnl-channel-ledger__empty">No sales in this range.</p>
      ) : (
        <>
          <div className="pnl-channel-ledger__bar" role="img" aria-label="Channel share">
            {sorted.map((d) => {
              const pct = (d.amount / total) * 100
              return (
                <div
                  key={d.channel}
                  className="pnl-channel-ledger__seg"
                  style={{
                    width: `${pct}%`,
                    background: CHANNEL_COLOR[d.channel] ?? "#888",
                  }}
                  title={`${d.channel}: ${pct.toFixed(1)}%`}
                />
              )
            })}
          </div>

          <ul className="pnl-channel-ledger__list">
            {sorted.map((d) => {
              const pct = (d.amount / total) * 100
              return (
                <li key={d.channel} className="pnl-channel-ledger__row">
                  <span
                    className="pnl-channel-ledger__swatch"
                    style={{ background: CHANNEL_COLOR[d.channel] ?? "#888" }}
                    aria-hidden
                  />
                  <span className="pnl-channel-ledger__name">{d.channel}</span>
                  <span className="pnl-channel-ledger__amount font-mono">{formatDollar(d.amount)}</span>
                  <span className="pnl-channel-ledger__pct font-mono">{pct.toFixed(1)}%</span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
