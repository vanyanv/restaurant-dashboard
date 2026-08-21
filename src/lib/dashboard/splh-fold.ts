import type { SplhPoint } from "@/lib/splh"

/**
 * Combine per-store SPLH series into one account-wide series.
 *
 * `getSplhSeries` returns one series per store. Sales per labor hour is a
 * RATIO, so the combined figure is total net sales over total labor hours for
 * the date — averaging the per-store ratios would weight a store that traded
 * two hours the same as one that traded fourteen. Targets and variance dollars
 * are additive-ish and are summed or medianed accordingly.
 *
 * With a single trading store this is the identity, which is what makes it safe
 * to run unconditionally.
 */
export function foldSplhSeries(series: { points: SplhPoint[] }[]): SplhPoint[] {
  if (series.length === 0) return []
  if (series.length === 1) return series[0].points

  const byDate = new Map<
    string,
    {
      point: SplhPoint
      netSales: number
      laborHours: number
      earnedHours: number
      varianceDollars: number
      targets: number[]
    }
  >()

  for (const s of series) {
    for (const p of s.points) {
      const acc =
        byDate.get(p.date) ??
        {
          point: p,
          netSales: 0,
          laborHours: 0,
          earnedHours: 0,
          varianceDollars: 0,
          targets: [] as number[],
        }
      acc.netSales += p.netSales
      acc.laborHours += p.laborHours
      acc.earnedHours += p.earnedHours ?? 0
      acc.varianceDollars += p.varianceDollars ?? 0
      if (p.targetSplh != null && p.targetSplh > 0) acc.targets.push(p.targetSplh)
      byDate.set(p.date, acc)
    }
  }

  return [...byDate.values()]
    .map((a) => {
      const splh = a.laborHours > 0 ? a.netSales / a.laborHours : null
      const sorted = [...a.targets].sort((x, y) => x - y)
      const targetSplh =
        sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null
      return {
        ...a.point,
        netSales: a.netSales,
        laborHours: a.laborHours,
        splh,
        targetSplh,
        earnedHours: a.earnedHours > 0 ? a.earnedHours : null,
        varianceHours:
          a.earnedHours > 0 ? a.laborHours - a.earnedHours : null,
        varianceDollars: a.varianceDollars !== 0 ? a.varianceDollars : null,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}
