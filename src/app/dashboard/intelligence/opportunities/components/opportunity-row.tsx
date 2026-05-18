import type { GrowthOpportunity } from "@/types/growth"

interface Props { opportunity: GrowthOpportunity }

const TYPE_LABELS: Record<GrowthOpportunity["opportunityType"], string> = {
  reprice: "REPRICE",
  menu_engineering: "MENU ENG",
  channel_mix: "CHANNEL",
  food_cost_risk: "FOOD COST",
  profit_risk: "PROFIT RISK",
}

function fmtUsd(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  })
}

export function OpportunityRow({ opportunity: o }: Props) {
  return (
    <li className="inv-row group grid grid-cols-[88px_1fr_120px_24px] items-baseline gap-4 px-5 py-3 border-t border-[color:var(--hairline)] cursor-pointer">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
        {TYPE_LABELS[o.opportunityType]}
      </span>
      <span className="font-serif italic text-[15px] text-[color:var(--ink)] group-hover:text-[color:var(--accent)] transition-colors">
        {o.title}
      </span>
      <span
        className="text-right text-[15px] text-[color:var(--ink)] group-hover:text-[color:var(--accent)] transition-colors"
        style={{ fontFamily: "var(--font-dm-sans, sans-serif)", fontWeight: 500, fontVariantNumeric: "tabular-nums lining-nums" }}
      >
        {fmtUsd(o.estimatedDollarImpact)}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
        {o.confidence[0].toUpperCase()}
      </span>
    </li>
  )
}
