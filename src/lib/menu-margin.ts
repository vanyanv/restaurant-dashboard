export const MARGIN_BAND_GOOD = 65
export const MARGIN_BAND_OK = 45

export function marginBandClass(marginPct: number | null | undefined): string {
  if (marginPct == null) return "text-[var(--ink-faint)]"
  if (marginPct >= MARGIN_BAND_GOOD) return "text-[var(--ink)]"
  if (marginPct >= MARGIN_BAND_OK) return "text-[var(--subtract)]"
  return "text-[var(--accent)]"
}
