// F29 — Waste root-cause clustering. Pure classifier; no I/O. Given a
// per-ingredient residual history (estimated − actual at each completed
// count) plus the adjustment events logged in the same window, label
// the dominant pattern so the operator gets a "next action" instead of
// raw numbers.

export type WasteClusterLabel =
  | "insufficient_data"
  | "stable_within_noise"
  | "systematic_overuse"
  | "systematic_underuse"
  | "expiry_driven"
  | "theft_or_unrecorded"
  | "improving"

export interface WasteClassifierInput {
  residuals: number[] // estimated − actual, one per completed count, oldest → newest
  adjustments: { reason: string; qty: number }[]
  /**
   * Typical weekly throughput in the same recipe unit as residuals. Used
   * to normalize residual magnitudes — a 2-unit residual on an ingredient
   * that flows 100/week is noise; on one that flows 10/week it isn't.
   */
  weeklyThroughput: number
}

export interface WasteClassification {
  label: WasteClusterLabel
  meanResidual: number
  stdResidual: number
  meanResidualPctOfThroughput: number | null
  expiryAdjustments: number
  theftAdjustments: number
  /** Operator-readable rationale; included on every label. */
  rationale: string
}

const MIN_SAMPLES = 3
const NOISE_BAND_PCT = 0.05 // ±5% of throughput is noise
const STRONG_BIAS_PCT = 0.1 // ≥10% mean residual is "systematic"
const HIGH_VARIANCE_RATIO = 1.5 // |std| > 1.5 × |mean| → high variance
const IMPROVEMENT_RATIO = 0.4 // recent half's mean is < 40% of older half's

export function classifyWastePattern(
  input: WasteClassifierInput,
): WasteClassification {
  const { residuals, adjustments, weeklyThroughput } = input

  const mean = residuals.length > 0 ? avg(residuals) : 0
  const std = residuals.length > 1 ? sampleStd(residuals) : 0
  const pct = weeklyThroughput > 0 ? mean / weeklyThroughput : null

  const expiryCount = adjustments.filter((a) =>
    a.reason.toUpperCase().includes("EXPIRY"),
  ).length
  const theftCount = adjustments.filter((a) =>
    a.reason.toUpperCase().includes("THEFT"),
  ).length

  if (residuals.length < MIN_SAMPLES) {
    return {
      label: "insufficient_data",
      meanResidual: mean,
      stdResidual: std,
      meanResidualPctOfThroughput: pct,
      expiryAdjustments: expiryCount,
      theftAdjustments: theftCount,
      rationale: `Need ≥ ${MIN_SAMPLES} counts; have ${residuals.length}.`,
    }
  }

  // Improving: residual magnitude shrinking sharply between the older half
  // of the window and the newer half. Detected before the static-bias
  // checks so a recipe-fix story doesn't get re-tagged as systematic.
  const half = Math.floor(residuals.length / 2)
  if (half >= 2) {
    const older = residuals.slice(0, half)
    const newer = residuals.slice(-half)
    const olderMag = Math.abs(avg(older))
    const newerMag = Math.abs(avg(newer))
    if (olderMag > 0 && newerMag / olderMag < IMPROVEMENT_RATIO) {
      return {
        label: "improving",
        meanResidual: mean,
        stdResidual: std,
        meanResidualPctOfThroughput: pct,
        expiryAdjustments: expiryCount,
        theftAdjustments: theftCount,
        rationale: `Residual magnitude fell from ${olderMag.toFixed(2)} to ${newerMag.toFixed(2)} across the window.`,
      }
    }
  }

  // Stable within noise band
  if (pct != null && Math.abs(pct) <= NOISE_BAND_PCT) {
    return {
      label: "stable_within_noise",
      meanResidual: mean,
      stdResidual: std,
      meanResidualPctOfThroughput: pct,
      expiryAdjustments: expiryCount,
      theftAdjustments: theftCount,
      rationale: `Mean residual within ±${(NOISE_BAND_PCT * 100).toFixed(0)}% of weekly throughput.`,
    }
  }

  // Expiry-driven: high variance + at least one logged expiry event.
  // Variance dominates because expiry tends to be lumpy (one bad batch).
  const absMean = Math.abs(mean) > 0 ? Math.abs(mean) : 1e-9
  if (std / absMean > HIGH_VARIANCE_RATIO && expiryCount >= 1) {
    return {
      label: "expiry_driven",
      meanResidual: mean,
      stdResidual: std,
      meanResidualPctOfThroughput: pct,
      expiryAdjustments: expiryCount,
      theftAdjustments: theftCount,
      rationale: `High variance (${(std / absMean).toFixed(2)}× mean) and ${expiryCount} expiry adjustment${expiryCount === 1 ? "" : "s"} in window.`,
    }
  }

  // Systematic bias above the strong threshold
  if (pct != null && pct >= STRONG_BIAS_PCT) {
    if (theftCount === 0 && expiryCount === 0) {
      return {
        label: "theft_or_unrecorded",
        meanResidual: mean,
        stdResidual: std,
        meanResidualPctOfThroughput: pct,
        expiryAdjustments: expiryCount,
        theftAdjustments: theftCount,
        rationale: `Mean overuse ${(pct * 100).toFixed(1)}% of throughput; no logged expiry or theft to explain it.`,
      }
    }
    return {
      label: "systematic_overuse",
      meanResidual: mean,
      stdResidual: std,
      meanResidualPctOfThroughput: pct,
      expiryAdjustments: expiryCount,
      theftAdjustments: theftCount,
      rationale: `Consistent overuse — recipe portion size likely understated.`,
    }
  }

  if (pct != null && pct <= -STRONG_BIAS_PCT) {
    return {
      label: "systematic_underuse",
      meanResidual: mean,
      stdResidual: std,
      meanResidualPctOfThroughput: pct,
      expiryAdjustments: expiryCount,
      theftAdjustments: theftCount,
      rationale: `Recipe walk overstates depletion by ~${(Math.abs(pct) * 100).toFixed(1)}%.`,
    }
  }

  // Default: between noise and strong-bias bands → call it stable.
  return {
    label: "stable_within_noise",
    meanResidual: mean,
    stdResidual: std,
    meanResidualPctOfThroughput: pct,
    expiryAdjustments: expiryCount,
    theftAdjustments: theftCount,
    rationale: `Mean residual within tolerance for the throughput; no clear pattern.`,
  }
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = avg(xs)
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}
