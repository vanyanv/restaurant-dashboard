import { DayHighlights } from "@/components/analytics/day-highlights"
import { SectionHead } from "../section-head"
import type { OtterPromise } from "./data"

export async function DayHighlightsSection({
  otterPromise,
}: {
  otterPromise: OtterPromise
}) {
  const otter = await otterPromise
  if (!otter || otter.dailyTrends.length <= 1) return null

  return (
    <div className="dock-in dock-in-3">
      <SectionHead label="Notable days" />
      <DayHighlights dailyTrends={otter.dailyTrends} />
    </div>
  )
}
