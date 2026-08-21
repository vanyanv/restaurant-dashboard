import type { AlertSeverity, AlertSource } from "@/generated/prisma/client"
import type {
  GrowthOpportunity,
  OpportunityType,
} from "@/types/growth"

/**
 * "What needs you" — the overview's attention queue.
 *
 * Two tables feed it and they are not the same kind of thing. `Alert` rows are
 * breaches: something crossed a line and a human has to look. `GrowthOpportunity`
 * rows are ideas: nothing is broken, there is money on the table. Ranking them
 * on one dollar axis would let a $2k repricing idea outrank a CRITICAL price
 * anomaly, which is backwards — so the order is exception-first, then money.
 *
 * This module is session-free and does no I/O, so the ordering is testable
 * without a database. See `needs-you-section.tsx` for the reader.
 */

export type NeedsYouSeverity = "critical" | "watch" | "opportunity" | "info"

export interface NeedsYouItem {
  id: string
  severity: NeedsYouSeverity
  /** Mono caption in the second column: "Price move", "Labor variance". */
  sourceLabel: string
  title: string
  body: string | null
  /**
   * Conservative dollar figure, already formatted. Null for alerts, which carry
   * no money of their own — `Alert.metadata` is not exposed by the inbox reader
   * and inventing a figure would be worse than leaving the column empty.
   */
  amount: string | null
  /** "/ 30 days", "Today", "Blocked" — what the amount covers. */
  horizon: string | null
  detectedAt: Date
  /** Populated for opportunities; drives the expanded panel. */
  opportunity: GrowthOpportunity | null
}

const SOURCE_LABEL: Record<AlertSource, string> = {
  ANOMALY_EVENT: "Anomaly",
  PRICE_DELTA: "Price move",
  HARRI_VARIANCE: "Labor variance",
  QUANTITY_SPIKE: "Quantity spike",
  NEW_PRODUCT: "New product",
}

const OPPORTUNITY_LABEL: Record<OpportunityType, string> = {
  reprice: "Reprice",
  menu_engineering: "Menu mix",
  channel_mix: "Channel mix",
  food_cost_risk: "Food cost risk",
  profit_risk: "Profit risk",
}

/**
 * Rank order. Critical breaches come before every idea no matter how large the
 * idea is; below that, money decides; watch and info close the list.
 */
const SEVERITY_RANK: Record<NeedsYouSeverity, number> = {
  critical: 0,
  opportunity: 1,
  watch: 2,
  info: 3,
}

function severityOf(s: AlertSeverity): NeedsYouSeverity {
  if (s === "CRITICAL") return "critical"
  if (s === "WATCH") return "watch"
  return "info"
}

/**
 * Horizon caption. The generator writes 1, 7 or 30; the Decisions cards used to
 * label every impact "/wk" regardless, overstating the 30-day figures ~4x and
 * understating the daily ones 7x. Say what the number actually covers.
 */
export function horizonLabel(days: number): string {
  if (days <= 1) return "Today"
  if (days <= 7) return "/ 7 days"
  return `/ ${days} days`
}

/**
 * The figure the ledger ranks on. p25 first — a wide speculative estimate must
 * not outrank a tight one — then p10, then the point estimate as a last resort.
 */
export function rankValueOf(o: GrowthOpportunity): number {
  return o.impactP25 ?? o.impactP10 ?? o.estimatedDollarImpact
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`
}

export interface AlertLike {
  id: string
  severity: AlertSeverity
  source: AlertSource
  title: string
  body: string | null
  detectedAt: Date
}

export function buildNeedsYou(input: {
  alerts: AlertLike[]
  opportunities: GrowthOpportunity[]
  /** Rows shown before the list is truncated. Defaults to 5. */
  limit?: number
  /**
   * Opportunities of one type shown before the rest are folded into the hidden
   * count. Defaults to 2.
   *
   * The generator emits one `menu_engineering` row per slow-moving item, so a
   * live day produces dozens of near-identical "Slow mover in <category>: <item>"
   * entries at similar dollar values. Ranked on money alone they take every
   * slot and the queue stops being a queue. Capping per type keeps the top of
   * the list varied; the rest are still counted and reachable.
   */
  maxPerType?: number
}): { items: NeedsYouItem[]; hiddenCount: number } {
  const limit = input.limit ?? 5
  const maxPerType = input.maxPerType ?? 2

  const fromAlerts: NeedsYouItem[] = input.alerts.map((a) => ({
    id: `alert:${a.id}`,
    severity: severityOf(a.severity),
    sourceLabel: SOURCE_LABEL[a.source] ?? "Alert",
    title: a.title,
    body: a.body,
    amount: null,
    horizon: null,
    detectedAt: a.detectedAt,
    opportunity: null,
  }))

  // Cap before ranking, so the cap applies to the strongest of each type
  // rather than whichever happened to arrive first.
  const perTypeCount = new Map<OpportunityType, number>()
  const cappedOpportunities = [...input.opportunities]
    .sort((a, b) => rankValueOf(b) - rankValueOf(a))
    .filter((o) => {
      const seen = perTypeCount.get(o.opportunityType) ?? 0
      if (seen >= maxPerType) return false
      perTypeCount.set(o.opportunityType, seen + 1)
      return true
    })

  const fromOpportunities: NeedsYouItem[] = cappedOpportunities.map((o) => ({
    id: `opp:${o.id}`,
    severity: "opportunity",
    sourceLabel: OPPORTUNITY_LABEL[o.opportunityType] ?? "Opportunity",
    title: o.title,
    body: o.suggestedAction,
    amount: money(rankValueOf(o)),
    horizon: horizonLabel(o.horizonDays),
    detectedAt: o.createdAt,
    opportunity: o,
  }))

  const all = [...fromAlerts, ...fromOpportunities].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (bySeverity !== 0) return bySeverity

    if (a.opportunity && b.opportunity) {
      const byMoney = rankValueOf(b.opportunity) - rankValueOf(a.opportunity)
      if (byMoney !== 0) return byMoney
    }

    // Newest first within a tier, so a fresh breach is never buried under a
    // stale one of equal severity.
    return b.detectedAt.getTime() - a.detectedAt.getTime()
  })

  // Everything dropped by the per-type cap is still outstanding work, so it
  // counts towards what the list says it is not showing.
  const cappedOut = input.opportunities.length - cappedOpportunities.length

  return {
    items: all.slice(0, limit),
    hiddenCount: Math.max(0, all.length - limit) + cappedOut,
  }
}
