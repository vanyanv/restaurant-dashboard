import { prisma } from "@/lib/prisma"

/**
 * Forecast accuracy tracking — the second v1 learning mechanism. Each demand
 * forecast the AI generates is recorded with its target window. After the
 * window closes the daily reconciliation job writes the actual value and
 * residual error back to the row, and the next forecast prompt for the same
 * (storeId, target) reads "your last forecast was off by +12%" and self-
 * calibrates.
 */

export interface ForecastWriteArgs {
  storeId: string
  target: string
  predictedValue: number
  unit: string
  confidence?: string | null
  targetWindowStart: Date
  targetWindowEnd: Date
}

export async function recordForecast(args: ForecastWriteArgs) {
  return prisma.aiForecastRun.create({
    data: {
      storeId: args.storeId,
      target: args.target,
      predictedValue: args.predictedValue,
      unit: args.unit,
      confidence: args.confidence ?? null,
      targetWindowStart: args.targetWindowStart,
      targetWindowEnd: args.targetWindowEnd,
    },
  })
}

export interface ForecastResidual {
  target: string
  predictedValue: number
  actualValue: number
  errorPct: number
  generatedAt: Date
  unit: string
}

/** Read the most recent reconciled residual per target for a store. The next
 * forecast generator includes these so the model can self-calibrate. */
export async function loadRecentResiduals(
  storeId: string,
  limit = 25,
): Promise<ForecastResidual[]> {
  const rows = await prisma.aiForecastRun.findMany({
    where: {
      storeId,
      reconciledAt: { not: null },
      actualValue: { not: null },
      errorPct: { not: null },
    },
    orderBy: { generatedAt: "desc" },
    take: limit,
    select: {
      target: true,
      predictedValue: true,
      actualValue: true,
      errorPct: true,
      generatedAt: true,
      unit: true,
    },
  })

  // Prisma return shape allows nulls per the where clause but we already
  // filtered them — assert the non-null fields for the consumer.
  return rows.map((r) => ({
    target: r.target,
    predictedValue: r.predictedValue,
    actualValue: r.actualValue!,
    errorPct: r.errorPct!,
    generatedAt: r.generatedAt,
    unit: r.unit,
  }))
}

export function formatResidualsForPrompt(residuals: ForecastResidual[]): string {
  if (residuals.length === 0) {
    return "(no reconciled forecasts yet — this store has not accumulated enough history)"
  }
  const lines = residuals.map((r) => {
    const sign = r.errorPct >= 0 ? "+" : ""
    return `- ${r.target}: predicted ${r.predictedValue.toFixed(1)} ${r.unit}, actual ${r.actualValue.toFixed(1)} ${r.unit} (${sign}${r.errorPct.toFixed(1)}%)`
  })
  return [
    "Calibration: your previous forecasts vs actuals (recent first). If you systematically over- or under-predict a given target, correct for that bias in this run.",
    "",
    ...lines,
  ].join("\n")
}

/** Reconcile every forecast whose window has closed but hasn't been compared
 * to actuals yet. The `computeActual` callback is responsible for looking up
 * the actual quantity for a (storeId, target, window) — the caller wires in
 * the right data source (invoices, sales, etc.) per target type. */
export async function reconcilePendingForecasts(
  computeActual: (args: {
    storeId: string
    target: string
    unit: string
    windowStart: Date
    windowEnd: Date
  }) => Promise<number | null>,
): Promise<{ reconciled: number; skipped: number }> {
  const now = new Date()
  const pending = await prisma.aiForecastRun.findMany({
    where: {
      reconciledAt: null,
      targetWindowEnd: { lt: now },
    },
  })

  let reconciled = 0
  let skipped = 0

  for (const row of pending) {
    const actual = await computeActual({
      storeId: row.storeId,
      target: row.target,
      unit: row.unit,
      windowStart: row.targetWindowStart,
      windowEnd: row.targetWindowEnd,
    })

    if (actual == null) {
      skipped += 1
      continue
    }

    const errorPct =
      row.predictedValue === 0
        ? 0
        : ((row.predictedValue - actual) / Math.max(Math.abs(actual), 0.001)) * 100

    await prisma.aiForecastRun.update({
      where: { id: row.id },
      data: {
        actualValue: actual,
        errorPct,
        reconciledAt: now,
      },
    })
    reconciled += 1
  }

  return { reconciled, skipped }
}
