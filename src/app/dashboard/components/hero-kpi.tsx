export interface HeroKpiDelta {
  value: number
  display: string
}

export function HeroKpi({
  label,
  value,
  unit,
  delta,
}: {
  label: string
  value: string
  unit: string
  delta: HeroKpiDelta | null
}) {
  return (
    <div className="editorial-kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value.split("·").map((part, i) =>
          i === 0 ? part : <span key={i} className="kpi-cents">·{part}</span>
        )}
      </div>
      <div className="kpi-unit">{unit}</div>
      {delta && (
        <div
          className={`kpi-delta ${
            delta.value > 0 ? "up" : delta.value < 0 ? "down" : ""
          }`}
        >
          {delta.display}
        </div>
      )}
    </div>
  )
}

export function formatMoneyLarge(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`
  return `$${Math.round(n).toLocaleString()}`
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`
}

export function formatDelta(growth: number): string {
  if (!Number.isFinite(growth) || growth === 0) return "·"
  const pct = (growth * 100).toFixed(1)
  const sign = growth > 0 ? "▲" : "▼"
  return `${sign} ${Math.abs(Number(pct))}% vs prior`
}
