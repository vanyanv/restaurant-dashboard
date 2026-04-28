import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isCronRequest } from "@/lib/rate-limit"
import { reconcilePendingForecasts } from "@/lib/ai-analytics/forecast-accuracy"

export const maxDuration = 60

/**
 * Daily reconciliation cron. For every AiForecastRun whose target window has
 * closed and that hasn't been compared to actuals yet, look up the actual
 * value from the source data and write back the residual error. The next
 * forecast run for the same (storeId, target) reads these residuals as
 * calibration context.
 *
 * For v1, "actual" is computed from canonical-ingredient consumption inferred
 * from `DailyCogsItem` rows in the target window — i.e. the same place the
 * demand forecast looks for its baseline. If a target's actuals can't be
 * determined the row is left pending and tried again the next day.
 */
export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await reconcilePendingForecasts(async (args) => {
    const totals = await prisma.dailyCogsItem.aggregate({
      where: {
        storeId: args.storeId,
        date: { gte: args.windowStart, lt: args.windowEnd },
      },
      _sum: { qtySold: true },
    })

    // v1 limitation: we only know item-level qty, not ingredient-level. Until
    // a richer actual-usage signal exists this returns null for ingredient-
    // level forecast targets, leaving them pending for a future enhancement.
    if (!args.target.startsWith("item:")) return null
    const qty = totals._sum.qtySold ?? 0
    return qty
  })

  return NextResponse.json(result)
}
