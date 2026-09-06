/** `cost / revenue` as a MARGIN percent, or `null` with no revenue — never `0`. */
export function blendedMargin(cost: number, revenue: number): number | null {
  if (!(revenue > 0)) return null
  return 100 - (cost / revenue) * 100
}
