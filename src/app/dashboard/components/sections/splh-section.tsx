import { getSplhSeries } from "@/app/actions/splh-actions"
import { SplhChart } from "@/components/charts/splh-chart"

/**
 * Both grains are fetched server-side so the day/week toggle is instant and
 * doesn't need a loading state — each is one indexed query over ~70 rows.
 */
export async function SplhSection() {
  const [day, week] = await Promise.all([
    getSplhSeries("day"),
    getSplhSeries("week"),
  ])

  return <SplhChart day={day} week={week} />
}
