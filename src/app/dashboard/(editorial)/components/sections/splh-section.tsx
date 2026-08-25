import { getSplhSeries } from "@/app/actions/splh-actions"
import { foldSplhSeries } from "@/lib/dashboard/splh-fold"
import { OverviewSplhChart } from "../overview-charts"

/**
 * Both grains are fetched server-side so the day/week toggle is instant and
 * doesn't need a loading state — each is one indexed query over ~70 rows.
 */
export async function SplhSection() {
  const [day, week] = await Promise.all([
    getSplhSeries("day"),
    getSplhSeries("week"),
  ])

  // One series per store; SPLH is a ratio, so it is recombined from summed
  // sales and hours rather than by averaging the per-store rates.
  return (
    <OverviewSplhChart day={foldSplhSeries(day)} week={foldSplhSeries(week)} />
  )
}
