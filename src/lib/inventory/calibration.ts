// Phase 4 — Bayesian calibration math for IngredientModelState.
//
// Each completed StockCount produces one recount observation per ingredient.
// We update two things:
//   1. `calibrationFactor` — multiplier on theoretical recipe-walk depletion.
//      Pulled toward `observed/theoretical` via fixed-α EWMA (Bayesian shrink
//      to prior 1.0). Clamped to a safety band so a single bad observation
//      can't move it more than [0.7, 2.0].
//   2. `recountDeltaMean` / `recountDeltaM2` — Welford running stats of the
//      residual (estimatedQtyAtCount − actualCounted). After enough tight
//      consecutive weeks, the ingredient graduates out of mandatory counting.

export const CALIBRATION_ALPHA = 0.3
export const CALIBRATION_FACTOR_MIN = 0.7
export const CALIBRATION_FACTOR_MAX = 2.0
export const OBSERVATION_MIN = 0.25
export const OBSERVATION_MAX = 4.0
export const TIGHT_RESIDUAL_FRAC = 0.05
export const TIGHT_STD_FRAC = 0.1
export const MIN_SAMPLES_TO_GRADUATE = 8
export const MIN_TIGHT_WEEKS = 4

export type ModelStateCore = {
  calibrationFactor: number
  recountDeltaMean: number
  recountDeltaM2: number
  sampleSize: number
  consecutiveTightWeeks: number
  isGraduated: boolean
  graduatedAt: Date | null
}

export type RecountObservation = {
  /** Recipe-walk × sales × prior calibration. The model's depletion prediction. */
  theoreticalDepletion: number
  /** (prevCount + Σ deliveries − Σ adjustments) − actualCount. The truth. */
  observedDepletion: number
  /** estimatedQtyAtCount − actualCounted. Positive = unexplained loss. */
  residual: number
  /** Per-week sales × recipe units. Used to scale the tight-band thresholds. */
  weeklyThroughput: number | null
  /** When the count was completed (for graduatedAt timestamp). Defaults to now. */
  occurredAt?: Date
}

export function initialModelState(): ModelStateCore {
  return {
    calibrationFactor: 1.0,
    recountDeltaMean: 0,
    recountDeltaM2: 0,
    sampleSize: 0,
    consecutiveTightWeeks: 0,
    isGraduated: false,
    graduatedAt: null,
  }
}

export function recountStdDev(state: { recountDeltaM2: number; sampleSize: number }): number {
  if (state.sampleSize < 2) return 0
  return Math.sqrt(state.recountDeltaM2 / (state.sampleSize - 1))
}

export function isResidualTight(residual: number, throughput: number | null): boolean {
  if (!throughput || throughput <= 0) return false
  return Math.abs(residual) / throughput <= TIGHT_RESIDUAL_FRAC
}

export function applyRecountUpdate(prior: ModelStateCore, obs: RecountObservation): ModelStateCore {
  const nextFactor = updateCalibrationFactor(prior.calibrationFactor, obs)
  const { mean, m2, sampleSize } = updateWelford(prior, obs.residual)
  const tight = isResidualTight(obs.residual, obs.weeklyThroughput)
  const consecutiveTightWeeks = tight ? prior.consecutiveTightWeeks + 1 : 0

  let isGraduated = prior.isGraduated
  let graduatedAt = prior.graduatedAt
  if (!isGraduated) {
    const stdRatio =
      obs.weeklyThroughput && obs.weeklyThroughput > 0
        ? Math.sqrt(m2 / Math.max(1, sampleSize - 1)) / obs.weeklyThroughput
        : Number.POSITIVE_INFINITY
    if (
      sampleSize >= MIN_SAMPLES_TO_GRADUATE &&
      consecutiveTightWeeks >= MIN_TIGHT_WEEKS &&
      stdRatio <= TIGHT_STD_FRAC
    ) {
      isGraduated = true
      graduatedAt = obs.occurredAt ?? new Date()
    }
  }

  return {
    calibrationFactor: nextFactor,
    recountDeltaMean: mean,
    recountDeltaM2: m2,
    sampleSize,
    consecutiveTightWeeks,
    isGraduated,
    graduatedAt,
  }
}

function updateCalibrationFactor(prior: number, obs: RecountObservation): number {
  if (!Number.isFinite(obs.theoreticalDepletion) || obs.theoreticalDepletion <= 0) {
    return clamp(prior, CALIBRATION_FACTOR_MIN, CALIBRATION_FACTOR_MAX)
  }
  const rawObs = obs.observedDepletion / obs.theoreticalDepletion
  const observation = clamp(rawObs, OBSERVATION_MIN, OBSERVATION_MAX)
  const next = prior * (1 - CALIBRATION_ALPHA) + observation * CALIBRATION_ALPHA
  return clamp(next, CALIBRATION_FACTOR_MIN, CALIBRATION_FACTOR_MAX)
}

function updateWelford(
  prior: { recountDeltaMean: number; recountDeltaM2: number; sampleSize: number },
  x: number,
): { mean: number; m2: number; sampleSize: number } {
  const sampleSize = prior.sampleSize + 1
  const delta = x - prior.recountDeltaMean
  const mean = prior.recountDeltaMean + delta / sampleSize
  const delta2 = x - mean
  const m2 = prior.recountDeltaM2 + delta * delta2
  return { mean, m2, sampleSize }
}

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH" | "VERIFIED"

export function deriveConfidenceLevel(state: {
  sampleSize: number
  isGraduated: boolean
}): ConfidenceLevel {
  if (state.isGraduated) {
    return state.sampleSize >= 16 ? "VERIFIED" : "HIGH"
  }
  return state.sampleSize >= 4 ? "MEDIUM" : "LOW"
}

function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo
  if (x > hi) return hi
  return x
}
