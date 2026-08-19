/**
 * Did the decision work?
 *
 * That is a causal question, and answering one normally needs a control group
 * nobody has. But `ForecastDailyRevenue` stamps `generatedAt`, so the forecast
 * made *before* a decision is, by construction, an estimate of what would have
 * happened without it. Freezing it at commit time turns it into the
 * counterfactual — no experiment design, no holdout stores, no new collection.
 *
 * The significance test counts days landing outside the frozen 80% band rather
 * than comparing summed totals, for two reasons:
 *
 *  - Summing daily p10/p90 assumes the days are perfectly correlated, which
 *    inflates the band until nothing is ever significant.
 *  - Counting exceedances is self-calibrating against the interval itself:
 *    under the null, 10% of days should sit above p90. If the band is honest
 *    the test is honest — and the band's calibration is measured separately by
 *    `ml/evaluation/horizon_calibration.py`, which is what makes leaning on it
 *    defensible rather than circular.
 *
 * Caveat worth stating wherever this is shown: this is an interrupted time
 * series, not a randomised trial. It cannot separate the decision from anything
 * else that changed the same week. It answers "did the week beat what we
 * expected", which is the honest question.
 */

/** Days that must close before a verdict is offered rather than "measuring". */
export const MIN_DAYS_TO_JUDGE = 5

/** An 80% interval leaves 10% of days above p90 under the null. */
const TAIL_PROBABILITY = 0.1

/** Significance level for the exceedance count. */
const ALPHA = 0.05

export interface FrozenDay {
  date: string
  predicted: number
  p10: number | null
  p90: number | null
}

export type DecisionVerdict =
  /** Too few days closed to say anything. */
  | "measuring"
  /** Actuals ran above the frozen band more often than chance allows. */
  | "working"
  /** Actuals ran below it more often than chance allows. */
  | "backfiring"
  /** Days landed inside the band; the decision did not move the week. */
  | "no-clear-effect"

export interface DecisionOutcome {
  /**
   * Days in the frozen counterfactual. Zero means no forecast was captured at
   * commit time, which is a different situation from a freeze whose days simply
   * have not closed yet — and the two must not read the same on screen.
   */
  frozenDays: number
  daysObserved: number
  daysAbove: number
  daysBelow: number
  forecastUsd: number
  actualUsd: number
  deltaUsd: number
  verdict: DecisionVerdict
  /** P(this many or more days outside the band | no effect). */
  pValue: number | null
}

function logFactorial(n: number): number {
  let out = 0
  for (let i = 2; i <= n; i++) out += Math.log(i)
  return out
}

/**
 * P(X >= k) for X ~ Binomial(n, p).
 *
 * Summed in log space: with n small this is unnecessary, but a factorial-based
 * binomial coefficient overflows silently at larger n and would return NaN
 * rather than complaining.
 */
export function binomialTailAtLeast(n: number, k: number, p: number): number {
  if (k <= 0) return 1
  if (k > n) return 0
  let total = 0
  for (let i = k; i <= n; i++) {
    const logCoef = logFactorial(n) - logFactorial(i) - logFactorial(n - i)
    total += Math.exp(logCoef + i * Math.log(p) + (n - i) * Math.log(1 - p))
  }
  return Math.min(1, total)
}

export function computeDecisionOutcome(
  frozen: FrozenDay[],
  actualByDate: Map<string, number>,
): DecisionOutcome {
  let daysObserved = 0
  let daysAbove = 0
  let daysBelow = 0
  let forecastUsd = 0
  let actualUsd = 0

  for (const f of frozen) {
    const actual = actualByDate.get(f.date)
    if (actual == null) continue
    daysObserved += 1
    forecastUsd += f.predicted
    actualUsd += actual
    // A day with no band cannot be an exceedance either way. It still counts
    // toward the totals, because the money was real.
    if (f.p90 != null && actual > f.p90) daysAbove += 1
    else if (f.p10 != null && actual < f.p10) daysBelow += 1
  }

  const deltaUsd = actualUsd - forecastUsd

  if (daysObserved < MIN_DAYS_TO_JUDGE) {
    return {
      frozenDays: frozen.length,
      daysObserved, daysAbove, daysBelow, forecastUsd, actualUsd, deltaUsd,
      verdict: "measuring", pValue: null,
    }
  }

  const pAbove = binomialTailAtLeast(daysObserved, daysAbove, TAIL_PROBABILITY)
  const pBelow = binomialTailAtLeast(daysObserved, daysBelow, TAIL_PROBABILITY)

  let verdict: DecisionVerdict = "no-clear-effect"
  let pValue: number | null = Math.min(pAbove, pBelow)
  if (pAbove < ALPHA && pAbove <= pBelow) {
    verdict = "working"
    pValue = pAbove
  } else if (pBelow < ALPHA) {
    verdict = "backfiring"
    pValue = pBelow
  }

  return {
    frozenDays: frozen.length,
    daysObserved, daysAbove, daysBelow, forecastUsd, actualUsd, deltaUsd, verdict, pValue,
  }
}
