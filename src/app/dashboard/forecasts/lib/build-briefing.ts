import type { RevenueForecastData } from "@/app/actions/forecasts/revenue-forecast-actions"
import type { CashPositionData } from "@/app/actions/forecasts/cash-position-actions"
import type { FoodCostForecastData } from "@/app/actions/forecasts/food-cost-forecast-actions"
import type { OpenAnomaliesData } from "@/app/actions/forecasts/anomaly-actions"
import type { LostSalesData } from "@/app/actions/forecasts/lost-sales-actions"
import type { MenuEngineeringData } from "@/app/actions/forecasts/menu-engineering-actions"

export type BriefingKind =
  | "revenue"
  | "cash"
  | "cogs"
  | "anomaly"
  | "stockout"
  | "menu"

export interface BriefingChunk {
  kind: "text" | "num"
  value: string
}

export interface BriefingLine {
  kind: BriefingKind
  /** Severity for ordering / accent treatment. 0 = neutral, 1 = watch, 2 = urgent. */
  severity: 0 | 1 | 2
  chunks: BriefingChunk[]
}

interface BuildBriefingInput {
  revenue: RevenueForecastData | null
  cash: CashPositionData | null
  foodCost: FoodCostForecastData | null
  /** Target COGS as a decimal (e.g. 0.285 for 28.5%). */
  targetCogsPct: number | null
  anomalies: OpenAnomaliesData | null
  lostSales: LostSalesData | null
  menuEngineering: MenuEngineeringData | null
  /** True when rendering the All-stores portfolio view. Triggers store-name
   * qualifiers on lines that have a clear single owner (anomaly, stockout). */
  isAggregate?: boolean
}

const fmtPct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`
const fmtSignedPct = (n: number, digits = 1) =>
  `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`
const fmtUsd = (n: number, max = 0) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: max,
  })

const t = (value: string): BriefingChunk => ({ kind: "text", value })
const n = (value: string): BriefingChunk => ({ kind: "num", value })

function revenueLine(
  rev: RevenueForecastData | null,
  isAggregate?: boolean,
): BriefingLine | null {
  if (!rev || rev.days.length < 7) return null
  // Take next 7 forecast days vs the trailing 7 within the available window.
  // Forecast windows are typically 14 days, so trailing 7 = days[7..13].
  const next7 = rev.days.slice(0, 7)
  const trailing7 = rev.days.slice(7, 14)
  if (next7.length < 7 || trailing7.length < 7) return null
  const sumNext = next7.reduce((s, d) => s + d.predictedRevenue, 0)
  const sumPrev = trailing7.reduce((s, d) => s + d.predictedRevenue, 0)
  if (sumPrev <= 0) return null
  const delta = (sumNext - sumPrev) / sumPrev
  const subject = isAggregate ? "Portfolio revenue" : "Revenue"
  if (Math.abs(delta) < 0.005) {
    return {
      kind: "revenue",
      severity: 0,
      chunks: [t(`${subject} tracks flat over the next 7 days.`)],
    }
  }
  const severity: 0 | 1 | 2 = delta < -0.05 ? 2 : delta < 0 ? 1 : 0
  return {
    kind: "revenue",
    severity,
    chunks: [
      t(`${subject} trends `),
      n(fmtSignedPct(delta)),
      t(" next 7 days vs trailing 7 ("),
      n(fmtUsd(sumNext)),
      t(" projected)."),
    ],
  }
}

function cashLine(cash: CashPositionData | null): BriefingLine | null {
  if (!cash || cash.days.length === 0) return null
  let lowDay = cash.days[0]
  for (const d of cash.days) {
    if (d.cumulativeNet < lowDay.cumulativeNet) lowDay = d
  }
  // Surface only when the floor is actually negative — that's the operator
  // signal ("you'll be in the red by Wed"). Positive floors don't earn a line.
  if (lowDay.cumulativeNet >= 0) return null
  const dateLabel = new Date(lowDay.date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
  return {
    kind: "cash",
    severity: 2,
    chunks: [
      t("Cash dips to "),
      n(fmtUsd(lowDay.cumulativeNet)),
      t(" by "),
      n(dateLabel),
      t("."),
    ],
  }
}

function cogsLine(
  fc: FoodCostForecastData | null,
  targetPct: number | null
): BriefingLine | null {
  if (!fc || fc.blendedFoodCostPct == null) return null
  const blended = fc.blendedFoodCostPct
  if (targetPct == null) {
    return {
      kind: "cogs",
      severity: 0,
      chunks: [t("Food cost forecast at "), n(fmtPct(blended)), t(".")],
    }
  }
  const overBy = blended - targetPct
  // Within 0.3 pp of target — say it but don't alarm.
  if (Math.abs(overBy) < 0.003) return null
  if (overBy <= 0) {
    return {
      kind: "cogs",
      severity: 0,
      chunks: [
        t("Food cost at "),
        n(fmtPct(blended)),
        t(", "),
        n(fmtPct(Math.abs(overBy), 1)),
        t(" under target."),
      ],
    }
  }
  const severity: 0 | 1 | 2 = overBy >= 0.02 ? 2 : 1
  return {
    kind: "cogs",
    severity,
    chunks: [
      t("Food cost at "),
      n(fmtPct(blended)),
      t(" — "),
      n(fmtPct(overBy, 1)),
      t(" over target."),
    ],
  }
}

function anomalyLine(an: OpenAnomaliesData | null): BriefingLine | null {
  if (!an || an.events.length === 0) return null
  const top = [...an.events].sort(
    (a, b) => Math.abs(b.zScore ?? 0) - Math.abs(a.zScore ?? 0)
  )[0]
  if (!top) return null
  const targetLabel: Record<typeof top.target, string> = {
    REVENUE: "revenue",
    MENU_ITEM: "menu sales",
    INGREDIENT: "ingredient use",
    LABOR: "labor",
    REFUNDS: "refunds",
  }
  const direction = top.residual >= 0 ? "spiked" : "dropped"
  const dateLabel = new Date(top.occurredOn).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
  const remaining = an.events.length - 1
  const storePrefix = top.storeName ? `${top.storeName}: ` : ""
  return {
    kind: "anomaly",
    severity: an.events.length >= 3 ? 2 : 1,
    chunks: [
      t(`${an.events.length} open anomal${an.events.length === 1 ? "y" : "ies"} — `),
      t(`${storePrefix}${targetLabel[top.target]} ${direction} `),
      n(dateLabel),
      ...(remaining > 0
        ? [t(", plus "), n(String(remaining)), t(" more.")]
        : [t(".")]),
    ],
  }
}

function stockoutLine(ls: LostSalesData | null): BriefingLine | null {
  if (!ls || ls.events.length === 0) return null
  const total = ls.totalEstimatedLost
  const top = [...ls.events].sort(
    (a, b) => b.estimatedLostRevenue - a.estimatedLostRevenue
  )[0]
  if (!top) return null
  const storePrefix = top.storeName ? `${top.storeName}: ` : ""
  return {
    kind: "stockout",
    severity: total >= 500 ? 2 : 1,
    chunks: [
      t(storePrefix),
      n(top.itemName),
      t(" ran out for "),
      n(`${top.gapDays}d`),
      t(" — est. "),
      n(fmtUsd(total)),
      t(" lost."),
    ],
  }
}

function menuLine(me: MenuEngineeringData | null): BriefingLine | null {
  if (!me || me.rows.length === 0) return null
  const star = me.rows
    .filter((r) => r.quadrant === "STAR")
    .sort((a, b) => b.totalContribution - a.totalContribution)[0]
  const dog = me.rows
    .filter((r) => r.quadrant === "DOG")
    .sort((a, b) => a.totalContribution - b.totalContribution)[0]
  if (!star && !dog) return null
  // Lead with the dog (actionable: drop or rework). Star is a nicety.
  if (dog) {
    return {
      kind: "menu",
      severity: 1,
      chunks: [
        n(dog.itemName),
        t(" classified as "),
        n("DOG"),
        t(" — low margin, low volume."),
      ],
    }
  }
  return {
    kind: "menu",
    severity: 0,
    chunks: [
      n(star.itemName),
      t(" leads as a "),
      n("STAR"),
      t(" ("),
      n(fmtUsd(star.totalContribution)),
      t(" contribution)."),
    ],
  }
}

/**
 * Build up to 5 briefing lines from forecast results, ordered by operator
 * priority. Returns an empty array when nothing flagged — the caller renders
 * the "nothing flagged" Fraunces line in that case.
 */
export function buildBriefing(input: BuildBriefingInput): BriefingLine[] {
  const candidates = [
    cashLine(input.cash), // negative cash floor — most urgent
    cogsLine(input.foodCost, input.targetCogsPct),
    revenueLine(input.revenue, input.isAggregate),
    anomalyLine(input.anomalies),
    stockoutLine(input.lostSales),
    menuLine(input.menuEngineering),
  ].filter((line): line is BriefingLine => line !== null)
  // Stable priority by detection order, then trim to 5.
  return candidates.slice(0, 5)
}
