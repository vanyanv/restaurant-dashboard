/**
 * Single source of truth for the `ML_USE_RECONCILED` env flag (W6-8).
 *
 * Default: `true` from W8 onward. Flip to `false` (env-only) for instant
 * rollback to unreconciled reads. Reconciliation continues to write columns;
 * only the read path is affected.
 *
 * Falls back to raw values when `reconciledAt` is null or older than the
 * stale threshold (48h) regardless of the flag.
 */
export const STALE_RECONCILED_HOURS = 48

export type ForecastSourcePreference = "reconciled" | "raw"

export function defaultForecastPreference(): ForecastSourcePreference {
  // process.env reads in Next.js server actions are evaluated at request time,
  // so flipping the env in Vercel is effective on the next invocation - no
  // redeploy needed.
  const flag = process.env.ML_USE_RECONCILED?.toLowerCase()
  if (flag === "false" || flag === "0") return "raw"
  return "reconciled"
}

export function isReconciledStale(reconciledAt: Date | null): boolean {
  if (!reconciledAt) return true
  const ageMs = Date.now() - reconciledAt.getTime()
  return ageMs > STALE_RECONCILED_HOURS * 60 * 60 * 1000
}
