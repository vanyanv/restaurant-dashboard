export const MARGIN_BAND_GOOD = 65
export const MARGIN_BAND_OK = 45

export function marginBandClass(marginPct: number | null | undefined): string {
  if (marginPct == null) return "text-[var(--ink-faint)]"
  if (marginPct >= MARGIN_BAND_GOOD) return "text-emerald-700"
  if (marginPct >= MARGIN_BAND_OK) return "text-amber-700"
  return "text-red-700"
}
