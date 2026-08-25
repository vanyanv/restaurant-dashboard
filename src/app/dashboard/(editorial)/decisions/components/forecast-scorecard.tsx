import type { Scorecard } from "../lib/scorecard"

interface Props {
  scorecard: Scorecard
}

const TABULAR = {
  fontVariantNumeric: "tabular-nums lining-nums" as const,
}

const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`

/**
 * The forecast's track record, shown plainly — including the coverage miss.
 *
 * A page that admits "74% of days land inside the 80% band" earns the right to
 * be believed the day it says $9,240. Hiding that behind three grey dots was
 * what made the confidence indicator meaningless.
 */
export function ForecastScorecard({ scorecard }: Props) {
  const { wape, beatsBaselineBy, intervalCoverage80, coverageTarget, coverageMeetsTarget } =
    scorecard

  return (
    <section aria-label="How accurate this forecast has been">
      <header className="decisions-section-head">
        <h2 className="decisions-section-head__title">
          <em>How well we&apos;ve been calling it</em>
        </h2>
        <span className="decisions-section-head__meta">
          {scorecard.sampleSize} reconciled day
          {scorecard.sampleSize === 1 ? "" : "s"}
        </span>
      </header>

      <div className="decisions-scorecard">
        <ScoreCell
          label="Average miss"
          value={wape == null ? "—" : pct(wape)}
          sub="how far off a typical day lands"
        />
        <ScoreCell
          label="Vs. a simple guess"
          value={
            beatsBaselineBy == null
              ? "—"
              : `${beatsBaselineBy >= 0 ? "" : "−"}${pct(Math.abs(beatsBaselineBy), 0)}`
          }
          sub={
            beatsBaselineBy == null
              ? "no baseline recorded"
              : beatsBaselineBy >= 0
                ? "better than last week's same day"
                : "worse than last week's same day"
          }
          tone={beatsBaselineBy != null && beatsBaselineBy < 0 ? "warn" : "neutral"}
        />
        <ScoreCell
          label="Range holds"
          value={intervalCoverage80 == null ? "—" : pct(intervalCoverage80, 0)}
          sub={
            intervalCoverage80 == null
              ? "not yet measured"
              : `of days land in the range shown · target ${pct(coverageTarget, 0)}`
          }
          tone={coverageMeetsTarget === false ? "warn" : "neutral"}
          meter={
            intervalCoverage80 == null
              ? undefined
              : { value: intervalCoverage80, target: coverageTarget }
          }
        />
      </div>
    </section>
  )
}

function ScoreCell({
  label,
  value,
  sub,
  tone = "neutral",
  meter,
}: {
  label: string
  value: string
  sub: string
  tone?: "neutral" | "warn"
  meter?: { value: number; target: number }
}) {
  return (
    <div className="decisions-score">
      <span className="decisions-score__label">{label}</span>
      <span className={`decisions-score__value is-${tone}`} style={TABULAR}>
        {value}
      </span>
      <span className="decisions-score__sub">{sub}</span>
      {meter ? (
        <span className="decisions-score__meter" aria-hidden="true">
          <span
            className={`decisions-score__meter-fill is-${tone}`}
            style={{ width: `${Math.min(100, Math.max(0, meter.value * 100))}%` }}
          />
          <span
            className="decisions-score__meter-target"
            style={{ left: `${meter.target * 100}%` }}
          />
        </span>
      ) : null}
    </div>
  )
}
