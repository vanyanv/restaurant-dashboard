import { classify, median, type SplhPoint } from "@/lib/splh"

/**
 * Combine per-store SPLH series into one account-wide series.
 *
 * `getSplhSeries` returns one series per store. Sales per labor hour is a
 * RATIO, so the combined figure is total net sales over total labor hours for
 * the date — averaging the per-store ratios would weight a store that traded
 * two hours the same as one that traded fourteen. Targets and variance dollars
 * are additive-ish and are summed or medianed accordingly.
 *
 * `earnedHours` is the demand side of the variance, and it is null for a store
 * with no target for that weekday yet — a store under eight weeks old, or one
 * whose sales history has a gap. Summing it with `?? 0` subtracted a demand
 * figure missing one store from an actual-hours figure that included it, so
 * the combined day read as overstaffed for a data-gap reason. A variance
 * cannot be computed from a partial denominator, so when any contributor's
 * earned hours are unknown the combined variance is withheld instead.
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
      /** A store on this date whose earned hours — and so variance — are unknown. */
      earnedIncomplete: boolean
      varianceDollars: number
      varianceIncomplete: boolean
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
          earnedIncomplete: false,
          varianceDollars: 0,
          varianceIncomplete: false,
          targets: [] as number[],
        }
      acc.netSales += p.netSales
      acc.laborHours += p.laborHours
      if (p.earnedHours == null) acc.earnedIncomplete = true
      else acc.earnedHours += p.earnedHours
      if (p.varianceDollars == null) acc.varianceIncomplete = true
      else acc.varianceDollars += p.varianceDollars
      if (p.targetSplh != null && p.targetSplh > 0) acc.targets.push(p.targetSplh)
      byDate.set(p.date, acc)
    }
  }

  return [...byDate.values()]
    .map((a) => {
      const splh = a.laborHours > 0 ? a.netSales / a.laborHours : null
      // `median` from @/lib/splh — the one the targets were built with. The
      // copy that used to live here took `sorted[floor(n / 2)]`, which is the
      // upper of the two middle values on an even count, not their mean. With
      // two stores, every count is even.
      const targetSplh = median(a.targets)
      const earnedHours = a.earnedIncomplete || a.earnedHours <= 0 ? null : a.earnedHours
      return {
        ...a.point,
        netSales: a.netSales,
        laborHours: a.laborHours,
        splh,
        targetSplh,
        earnedHours,
        varianceHours: earnedHours === null ? null : a.laborHours - earnedHours,
        varianceDollars: a.varianceIncomplete || earnedHours === null ? null : a.varianceDollars,
        // The combined day gets its own verdict. Spreading `a.point` carried
        // the FIRST store's status onto a ratio neither store had.
        status: classify(splh, targetSplh),
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}
