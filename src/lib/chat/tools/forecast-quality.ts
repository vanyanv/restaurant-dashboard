import { z } from "zod"
import {
  combineEvaluations,
  latestPerStore,
  type Scorecard,
} from "@/lib/decisions/scorecard"
import { resolveStoreIds, storeIdsSchema, ymd } from "./_shared"
import type { ChatTool } from "./types"

/**
 * How good the forecasts actually are.
 *
 * The assistant could quote a revenue forecast and could not say whether that
 * forecast had ever been right. `MlForecastEvaluation` holds the backtest —
 * WAPE, MAPE, bias, interval coverage, and the seasonal-naive baseline the
 * model has to beat to be worth running — and nothing in the chat read it. An
 * owner asking "should I trust this?" got the model's confidence interval,
 * which is the model's opinion of itself, not its record.
 *
 * `baselineWape` is the number that matters most and the one an owner would
 * never think to ask for: if the model's WAPE is not below the WAPE of
 * "same day last week", the forecast is costing compute to be worse than
 * arithmetic.
 */
const params = z
  .object({
    storeIds: storeIdsSchema,
    target: z
      .enum(["REVENUE", "MENU_ITEM", "INVENTORY", "BUSY_HOURS"])
      .optional()
      .describe(
        "Which forecast to report on. REVENUE and MENU_ITEM are daily, BUSY_HOURS is hourly. Omit for all of them.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(12)
      .describe("Maximum evaluation rows, most recently computed first."),
  })
  .strict()

export type ForecastQualityRow = {
  storeName: string
  target: string
  /** 0 for a whole-day evaluation; the hour bucket for BUSY_HOURS. */
  horizonDay: number
  modelVersion: string
  windowStart: string
  windowEnd: string
  /** Weighted absolute percentage error. Lower is better; this is the headline. */
  wape: number | null
  mape: number | null
  mae: number | null
  /** Positive = the model runs high, negative = it runs low. */
  bias: number | null
  /** Share of actuals that fell inside the stated 80% / 95% interval. */
  intervalCoverage80: number | null
  intervalCoverage95: number | null
  /** WAPE of the "same day last week" baseline on the same rows. */
  baselineWape: number | null
  /**
   * True when the model beat that baseline. Null when the baseline was not
   * computed for the window, which is not the same as a tie.
   */
  beatsBaseline: boolean | null
  /** Reconciled rows behind the metrics. Zero means the row is informational. */
  sampleSize: number
  /** Forecast rows in the window whose actuals never arrived. */
  staleRowCount: number
  computedAt: string
}

export type TrainingRunRow = {
  target: string
  modelType: string
  status: string
  startedAt: string
  completedAt: string | null
  mape: number | null
  sampleSize: number | null
  modelVersion: string | null
  errorMessage: string | null
}

export type ForecastQualityResult = {
  /**
   * THE HEADLINE, and the same number /dashboard/decisions prints.
   *
   * `combineEvaluations` owns this figure: one row per store, newest model
   * version, weighted by sample size so a store with three reconciled days
   * cannot drag the portfolio reading around. Quoting a raw row instead gives
   * a different percentage from the page on the same day, which is the
   * failure CLAUDE.md's "one function owns the figure" rule exists to stop.
   *
   * REVENUE only, because that is what the page reports and what
   * `combineEvaluations` was written for. Null when no store has a reconciled
   * evaluation yet.
   */
  scorecard: Scorecard | null
  /** Per store and per target, behind the headline. */
  evaluations: ForecastQualityRow[]
  /**
   * The most recent training run per target, scoped to this account's stores.
   * A run whose `scope` is "global" is deliberately absent: it is not this
   * account's row, and its error metrics are computed across data this
   * account cannot see.
   */
  recentTrainingRuns: TrainingRunRow[]
}

export const getForecastQuality: ChatTool<typeof params, ForecastQualityResult> = {
  name: "getForecastQuality",
  description:
    "Returns the measured accuracy of the forecasts. `scorecard` is the headline and is the SAME figure the Decisions page prints: one evaluation per store, newest model version, weighted by sample size. `evaluations` is the per-store, per-target detail behind it: WAPE, MAPE, bias, 80/95% interval coverage, sample size, and the WAPE of the seasonal-naive (same-day-last-week) baseline the model has to beat. Rows with no reconciled days are excluded, because a WAPE with nothing behind it is not a record. Also returns the recent training runs for this account's stores with their status. Use for 'how accurate are the forecasts?', 'can I trust the revenue prediction?', 'is the model any good?', 'did the model train?'. An empty evaluations array means no backtest has been computed yet, which is an honest 'we don't know', not 'the model is fine'.",
  parameters: params,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const limit = args.limit ?? 12

    const rows = await ctx.prisma.mlForecastEvaluation.findMany({
      where: {
        storeId: { in: storeIds },
        ...(args.target ? { target: args.target } : {}),
        /*
         * `sampleSize` 0 means "informational only" (schema.prisma), so a
         * WAPE on such a row is a number with nothing behind it. The
         * Decisions page has always filtered these out; returning them here
         * would let the model quote one as the model's record.
         */
        sampleSize: { gt: 0 },
        /*
         * `horizonDay` is 0 for a whole-day evaluation and 0-23 for the
         * hourly BUSY_HOURS target. Without this, one store on one model
         * version returns 24 hourly rows that read as 24 separate backtests.
         * The hourly rows are still reachable by asking for BUSY_HOURS,
         * where the field is carried on the row so they cannot be confused.
         */
        ...(args.target === "BUSY_HOURS" ? {} : { horizonDay: 0 }),
      },
      select: {
        storeId: true,
        target: true,
        horizonDay: true,
        modelVersion: true,
        windowStart: true,
        windowEnd: true,
        wape: true,
        mape: true,
        mae: true,
        bias: true,
        intervalCoverage80: true,
        intervalCoverage95: true,
        baselineWape: true,
        sampleSize: true,
        staleRowCount: true,
        computedAt: true,
        store: { select: { name: true } },
      },
      orderBy: { computedAt: "desc" },
      take: limit,
    })

    /*
     * `MlTrainingRun` has no store relation — it carries a free-text `scope`
     * that is a store id or the string "global". There is no join to filter
     * on, so the account boundary is applied here by matching `scope` against
     * the ids `resolveStoreIds` already validated. A run with a null or
     * "global" scope is not returned, because the metrics on it were fitted
     * across every account's data.
     */
    const runs = await ctx.prisma.mlTrainingRun.findMany({
      where: {
        scope: { in: storeIds },
        ...(args.target ? { target: args.target } : {}),
      },
      select: {
        target: true,
        modelType: true,
        status: true,
        startedAt: true,
        completedAt: true,
        mape: true,
        sampleSize: true,
        modelVersion: true,
        errorMessage: true,
      },
      orderBy: { startedAt: "desc" },
      take: limit,
    })

    /*
     * The portfolio reading, from the rows already in hand when the question
     * covers REVENUE. `rows` is ordered newest-first, which is what
     * `latestPerStore` requires.
     */
    const revenueRows = rows.filter((r) => r.target === "REVENUE")
    const scorecard =
      revenueRows.length > 0 ? combineEvaluations(latestPerStore(revenueRows)) : null

    return {
      scorecard,
      evaluations: rows.map((r) => ({
        storeName: r.store.name,
        target: r.target,
        horizonDay: r.horizonDay,
        modelVersion: r.modelVersion,
        windowStart: ymd(r.windowStart),
        windowEnd: ymd(r.windowEnd),
        wape: r.wape,
        mape: r.mape,
        mae: r.mae,
        bias: r.bias,
        intervalCoverage80: r.intervalCoverage80,
        intervalCoverage95: r.intervalCoverage95,
        baselineWape: r.baselineWape,
        beatsBaseline:
          r.wape != null && r.baselineWape != null ? r.wape < r.baselineWape : null,
        sampleSize: r.sampleSize,
        staleRowCount: r.staleRowCount,
        computedAt: r.computedAt.toISOString(),
      })),
      recentTrainingRuns: runs.map((r) => ({
        target: r.target,
        modelType: r.modelType,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        mape: r.mape,
        sampleSize: r.sampleSize,
        modelVersion: r.modelVersion,
        errorMessage: r.errorMessage,
      })),
    }
  },
}
