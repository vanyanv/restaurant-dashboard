import type { RevenueForecastDay } from "@/app/actions/forecasts/revenue-forecast-actions"

export type VolumeBucket = "busy" | "normal" | "slow"

/**
 * Bucket a day's predicted revenue against the trailing-7 baseline drawn
 * from days[7..13] of the same forecast window (typically the same store's
 * forecast for the *following* week). Caller passes the next-7 day to
 * classify plus the trailing-7 baseline mean.
 */
export function bucketByMean(
  predicted: number,
  trailing7Mean: number,
): VolumeBucket {
  if (trailing7Mean <= 0) return "normal"
  if (predicted >= trailing7Mean * 1.15) return "busy"
  if (predicted <= trailing7Mean * 0.85) return "slow"
  return "normal"
}

export function trailingMean(days: RevenueForecastDay[]): number {
  const trailing7 = days.slice(7, 14)
  if (trailing7.length === 0) return 0
  return trailing7.reduce((s, d) => s + d.predictedRevenue, 0) / trailing7.length
}

/** Percentage change vs the same-weekday in the trailing window. */
export function pctVsTrailing(
  predicted: number,
  trailing7Mean: number,
): number | null {
  if (trailing7Mean <= 0) return null
  return (predicted - trailing7Mean) / trailing7Mean
}
