import { getReconciliationTable } from "@/app/actions/intelligence/quality-actions"

function fmtPct(n: number | null) {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`
}

function Sparkline({ values }: { values: (number | null)[] }) {
  const w = 60, h = 14
  const numeric = values.filter((v): v is number => v != null)
  if (numeric.length < 2) return <span className="font-mono text-[10px] text-[color:var(--ink-faint)]">—</span>
  const min = Math.min(...numeric), max = Math.max(...numeric)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = v == null ? h / 2 : h - ((v - min) / range) * h
    return `${x},${y}`
  })
  return <svg width={w} height={h}><polyline points={pts.join(" ")} stroke="var(--ink-muted)" strokeWidth="1" fill="none" /></svg>
}

export async function ReconciliationSection() {
  const rows = await getReconciliationTable()
  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">§ 02 Hierarchical reconciliation</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
          target ≤ 15% post-median
        </span>
      </header>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left">
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">Store</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">Pre median</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">Post median</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">14-day trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.storeId} className="inv-row group border-t border-[color:var(--hairline)]">
              <td className="px-5 py-2 font-serif italic">{r.storeName}</td>
              <td className="px-5 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>{fmtPct(r.preMedian)}</td>
              <td className={`px-5 py-2 text-right ${r.exceedsThreshold ? "text-[color:var(--accent)]" : ""}`} style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>
                {fmtPct(r.postMedian)}
              </td>
              <td className="px-5 py-2 text-right"><Sparkline values={r.spark.map((s) => s.value)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
