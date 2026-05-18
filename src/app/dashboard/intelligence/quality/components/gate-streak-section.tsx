import { getOperatorGateStreak } from "@/app/actions/intelligence/gate-streak-actions"

export async function GateStreakSection() {
  const { consecutivePass, trailingWindow } = await getOperatorGateStreak()
  return (
    <section className="inv-panel">
      <header className="inv-panel__head px-5 pt-4 pb-3 flex items-baseline justify-between">
        <span className="inv-panel__dept">§ 04 Operator-gate streak</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
          per-day verifier · trailing 14 days
        </span>
      </header>
      <div className="px-5 py-6 flex items-baseline gap-8">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">Consecutive PASS days</p>
          <p
            className="text-[44px] leading-none text-[color:var(--ink)]"
            style={{ fontFamily: "var(--font-dm-sans, sans-serif)", fontWeight: 600, fontVariantNumeric: "tabular-nums lining-nums" }}
          >
            {consecutivePass}
          </p>
        </div>
        <div className="flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] mb-2">
            14-day window
          </p>
          <ol className="flex gap-1.5">
            {trailingWindow.slice().reverse().map((day) => {
              const failed = !day.allPassed
              return (
                <li
                  key={day.date}
                  title={`${day.date} — ${day.gateBreakdown
                    .map((g) => `${g.gate}: ${g.passed ? "pass" : "FAIL"}`)
                    .join(" / ")}`}
                  className="h-5 w-5 rounded-full border border-[color:var(--hairline-bold)]"
                  style={{
                    background: failed ? "var(--accent)" : "var(--ink-good)",
                  }}
                />
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}
