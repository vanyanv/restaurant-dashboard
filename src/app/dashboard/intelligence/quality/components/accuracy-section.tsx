import { getAccuracyTable } from "@/app/actions/intelligence/quality-actions"

const VERDICT_TONE = {
  green: "text-[color:var(--ink-good)]",
  yellow: "text-[color:var(--ink-warn)]",
  red: "text-[color:var(--accent)]",
  unknown: "text-[color:var(--ink-faint)]",
} as const

function fmtPct(n: number | null) {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`
}

export async function AccuracySection() {
  const rows = await getAccuracyTable()
  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">§ 01 Forecast accuracy</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
          {rows.length} (target × store) row{rows.length === 1 ? "" : "s"}
        </span>
      </header>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left">
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">Store</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">Target</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">WAPE</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">vs Naïve</th>
            <th className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] text-right">Coverage 80</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.storeId}-${r.target}`} className="inv-row group border-t border-[color:var(--hairline)]">
              <td className="px-5 py-2 font-serif italic">{r.storeName}</td>
              <td className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-muted)]">{r.target}</td>
              <td className="px-5 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>{fmtPct(r.wape)}</td>
              <td className="px-5 py-2 text-right" style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>{fmtPct(r.baselineWape)}</td>
              <td className={`px-5 py-2 text-right ${VERDICT_TONE[r.coverageVerdict]}`} style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>
                {fmtPct(r.intervalCoverage80)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
