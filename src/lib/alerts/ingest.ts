// F21 — Alert ingestion. Pure functions that translate detector outputs
// (currently F12 AnomalyEvent rows) into Alert rows. Used by:
//   - the alerts-ingest cron POST endpoint (nightly post-step)
//   - one-shot backfill (first-run hydration of existing OPEN AnomalyEvents)
//
// Idempotency: Alert.dedupeKey is a unique constraint, so re-running ingest
// against the same input is safe — duplicates upsert into the existing row
// with `status` and `acknowledgedAt` preserved.

import { prisma } from "@/lib/prisma"
import type { AnomalyEvent, Prisma } from "@/generated/prisma/client"

// Enum types are not re-exported from the generated client; redeclare as
// string-literal unions matching the schema (same convention as anomaly-actions.ts).
export type AlertSource =
  | "ANOMALY_EVENT"
  | "PRICE_DELTA"
  | "HARRI_VARIANCE"
  | "QUANTITY_SPIKE"
  | "NEW_PRODUCT"
  | "STORE_CHECK"
export type AlertTarget =
  | "REVENUE"
  | "MENU_ITEM"
  | "INGREDIENT"
  | "LABOR"
  | "REFUNDS"
  | "PRICE"
  | "PRODUCT"
  | "STORE_CHECK"
export type AlertSeverity = "INFO" | "WATCH" | "CRITICAL"

interface IngestResult {
  scanned: number
  created: number
  updated: number
}

/* ── Severity: business consequence AND statistical strength ─────────────
 *
 * Severity used to be |z| alone. Two CRITICAL alerts in the live inbox were a
 * milkshake selling 10 and 11 units over its usual: a real statistical
 * surprise, and well under $100 of sales. An owner paged for that learns to
 * ignore the colour. So a grade now needs BOTH:
 *
 *   - a dollar size worth a person's time (revenue $ for revenue; units × the
 *     item's own average price for a menu item), and
 *   - evidence that it is unusual (|z|, or how far outside the forecast
 *     interval the day landed).
 *
 * The grade is the LOWER of the two tiers: a $5,000 wobble that is ordinary
 * noise is not critical, and neither is a wild swing worth $40.
 *
 * The interval detector writes no zScore (it has no pooled distribution to
 * standardise against), which used to grade every one of its alerts INFO —
 * the better detector's findings ranked below the cruder one's.
 */

/** Dollars of sales at stake that make a statistically strong miss CRITICAL. */
export const CRITICAL_DOLLARS = 1000
/** Dollars of sales at stake below which an alert is never more than INFO. */
export const WATCH_DOLLARS = 250
/** |z| at which a z-score miss is strong evidence; the old CRITICAL bar. */
export const STRONG_Z = 4
/** |z| at which a z-score miss is meaningful; the old WATCH bar. */
export const MEANINGFUL_Z = 2.5
/**
 * How far outside the forecast interval, in that side's half-widths, counts as
 * strong evidence. 1.0 = the actual missed by as much again as the whole band
 * allowed for. Anything the interval detector emits has already cleared the
 * implied-95% bar (ml/anomaly/interval.py DEFAULT_MIN_SEVERITY ≈ 0.53), so it
 * is at least meaningful.
 */
export const STRONG_INTERVAL_EXCESS = 1.0
/** Days of sales used to price one unit of a menu item. */
export const PRICE_LOOKBACK_DAYS = 42

const INTERVAL_METHOD = "PREDICTION_INTERVAL"

type Tier = 0 | 1 | 2
const SEVERITY_BY_TIER: Record<Tier, AlertSeverity> = { 0: "INFO", 1: "WATCH", 2: "CRITICAL" }

/** Statistical strength of the event. */
export function strengthTier(ev: {
  zScore: number | null
  method: string
  intervalExcess?: number | null
}): Tier {
  if (ev.zScore != null && Number.isFinite(ev.zScore)) {
    const abs = Math.abs(ev.zScore)
    if (abs >= STRONG_Z) return 2
    if (abs >= MEANINGFUL_Z) return 1
    return 0
  }
  if (ev.method === INTERVAL_METHOD) {
    // Emitted at all = outside the implied 95% band. Strong only when we can
    // see how far outside, and it was far.
    if (ev.intervalExcess != null && ev.intervalExcess >= STRONG_INTERVAL_EXCESS) return 2
    return 1
  }
  return 0
}

/** Business consequence. Dollars that cannot be sized cap the grade at WATCH. */
export function dollarTier(dollars: number | null): Tier {
  if (dollars == null || !Number.isFinite(dollars)) return 1
  const abs = Math.abs(dollars)
  if (abs >= CRITICAL_DOLLARS) return 2
  if (abs >= WATCH_DOLLARS) return 1
  return 0
}

export function gradeSeverity(input: {
  zScore: number | null
  method: string
  intervalExcess?: number | null
  dollarsAtRisk: number | null
}): AlertSeverity {
  const tier = Math.min(strengthTier(input), dollarTier(input.dollarsAtRisk)) as Tier
  return SEVERITY_BY_TIER[tier]
}

function buildDedupeKey(
  source: AlertSource,
  storeId: string,
  target: AlertTarget,
  targetId: string | null,
  occurredOn: Date,
): string {
  const dateKey = occurredOn.toISOString().slice(0, 10)
  return `${source}:${storeId}:${target}:${targetId ?? "-"}:${dateKey}`
}

// Map AnomalyTarget → AlertTarget. AlertTarget is a strict superset.
function mapAnomalyTarget(t: AnomalyEvent["target"]): AlertTarget {
  return t as AlertTarget
}

function fmtSigned(n: number): string {
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

function fmtMoney(n: number): string {
  return `$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
}

function fmtSignedMoney(n: number): string {
  return `${n < 0 ? "-" : "+"}${fmtMoney(n)}`
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

type EventFacts = Pick<
  AnomalyEvent,
  "residual" | "target" | "targetId" | "method" | "explanation" | "occurredOn" | "zScore"
>

/**
 * What the event is measured against. The interval detector compares to that
 * day's own forecast; the z-score detector compares to a trailing 28-day
 * average, which is NOT a forecast and must not be called one.
 */
function comparedTo(ev: Pick<AnomalyEvent, "method">): "forecast" | "usual" {
  return ev.method === INTERVAL_METHOD ? "forecast" : "usual"
}

// Human-readable title. Kept short — long context lives in the body.
//
// Item-scoped targets name their subject: an inbox of nine rows all reading
// "Menu-item demand -44 below forecast" tells the operator nothing they can
// act on. `targetId` carries the menu-item sku / ingredient id for exactly
// this purpose, so use it whenever it is present.
export function titleFor(ev: Pick<AnomalyEvent, "residual" | "target" | "targetId" | "method">): string {
  const dir =
    comparedTo(ev) === "forecast"
      ? ev.residual >= 0
        ? "above forecast"
        : "below forecast"
      : "vs usual"
  const subject = ev.targetId?.trim() || null
  switch (ev.target) {
    case "REVENUE":
      return `Revenue ${fmtSignedMoney(ev.residual)} ${dir}`
    case "LABOR":
      return `Labor ${fmtSigned(ev.residual)} ${dir}`
    case "REFUNDS":
      return `Refunds ${fmtSigned(ev.residual)} ${dir}`
    case "MENU_ITEM":
      return subject
        ? `${subject} — ${fmtSigned(ev.residual)} units ${dir}`
        : `Menu-item demand ${fmtSigned(ev.residual)} units ${dir}`
    case "INGREDIENT":
      return subject
        ? `${subject} usage ${fmtSigned(ev.residual)} ${dir}`
        : `Ingredient usage ${fmtSigned(ev.residual)} ${dir}`
    default:
      return `Anomaly ${fmtSigned(ev.residual)} ${dir}`
  }
}

/** Facts looked up for an event before it is written. Each may be missing. */
export interface AlertContext {
  storeName: string | null
  /** Average price of one unit of the menu item, before discounts. */
  unitPrice: number | null
  /** How far outside the interval, in half-widths (interval events only). */
  intervalExcess: number | null
}

const NO_CONTEXT: AlertContext = { storeName: null, unitPrice: null, intervalExcess: null }

/** Dollars of sales the event represents, or null when it cannot be sized. */
export function dollarsAtRisk(
  ev: Pick<AnomalyEvent, "residual" | "target">,
  ctx: Pick<AlertContext, "unitPrice">,
): number | null {
  switch (ev.target) {
    case "REVENUE":
      return Math.abs(ev.residual)
    case "MENU_ITEM":
      return ctx.unitPrice != null && ctx.unitPrice > 0 ? Math.abs(ev.residual) * ctx.unitPrice : null
    default:
      // Labor, refunds and ingredient residuals are not sales dollars here;
      // sizing them would be a guess.
      return null
  }
}

function nextStep(ev: Pick<AnomalyEvent, "residual" | "target" | "targetId">): string {
  const subject = ev.targetId?.trim() || null
  const up = ev.residual >= 0
  switch (ev.target) {
    case "MENU_ITEM":
      if (!subject) return "Check stock of your top sellers before tonight."
      return up
        ? `Check stock of ${subject} before tonight.`
        : `Check ${subject} is in stock and switched on in every app.`
    case "REVENUE":
      return up
        ? "Check stock of your top sellers before the next shift."
        : "Check that every order for the day synced and no app was switched off."
    case "INGREDIENT":
      return subject
        ? `Count ${subject} before the next order goes in.`
        : "Count the ingredient before the next order goes in."
    default:
      return "Open the day and check what changed."
  }
}

function derivedComparison(ev: EventFacts): string {
  const against =
    comparedTo(ev) === "forecast" ? "forecast" : "usual (average of the last 28 days)"
  if (ev.target === "MENU_ITEM") {
    const units = Math.abs(ev.residual).toLocaleString("en-US", { maximumFractionDigits: 0 })
    return `${units} units ${ev.residual >= 0 ? "more" : "fewer"} than ${against}`
  }
  if (ev.target === "REVENUE") {
    return `${fmtMoney(ev.residual)} ${ev.residual >= 0 ? "over" : "under"} ${against}`
  }
  return `${fmtSigned(ev.residual)} against ${against}`
}

/**
 * The body every alert carries: which store, what is at risk, why now (the
 * day it happened and what it was compared against), and a plain next step.
 * Every number comes from the event or the lookups in `AlertContext`; a
 * figure that is missing is said to be missing, never shown as $0.
 *
 * The detector's own `explanation` (the interval detector's "$X came in under
 * a forecast of $Y (expected $A-$B)") is kept as the comparison — it used to
 * be dropped, leaving the body null.
 */
export function bodyFor(ev: EventFacts, ctx: AlertContext): string {
  const day = fmtDay(ev.occurredOn)
  const where = ctx.storeName ? `${ctx.storeName}, ${day}` : day
  const explanation = ev.explanation?.trim()
  const comparison = explanation ? explanation.replace(/[.;]\s*$/, "") : derivedComparison(ev)

  const dollars = dollarsAtRisk(ev, ctx)
  let atRisk: string
  if (ev.target === "MENU_ITEM") {
    atRisk =
      dollars != null && ctx.unitPrice != null
        ? `About ${fmtMoney(dollars)} of sales at $${ctx.unitPrice.toFixed(2)} each (average price over the last ${PRICE_LOOKBACK_DAYS} days, before discounts).`
        : "No recent price on file for this item, so the dollar size is not known."
  } else if (ev.target === "REVENUE" && dollars != null) {
    const side = ev.residual >= 0 ? "above" : "short of"
    atRisk = `${fmtMoney(dollars)} of sales ${side} ${comparedTo(ev) === "forecast" ? "forecast" : "usual"}.`
  } else {
    atRisk = "The dollar size is not measured for this kind of alert."
  }

  return `${where}: ${comparison}. ${atRisk} ${nextStep(ev)}`
}

// Translate a single AnomalyEvent → upsert payload for Alert.
export interface AlertUpsert {
  dedupeKey: string
  storeId: string
  source: AlertSource
  anomalyEventId: string
  target: AlertTarget
  targetId: string | null
  severity: AlertSeverity
  title: string
  body: string | null
  metadata: Prisma.InputJsonValue
  occurredOn: Date
}

export function anomalyEventToAlert(ev: AnomalyEvent, ctx: AlertContext = NO_CONTEXT): AlertUpsert {
  const target = mapAnomalyTarget(ev.target)
  const dollars = dollarsAtRisk(ev, ctx)
  return {
    dedupeKey: buildDedupeKey("ANOMALY_EVENT", ev.storeId, target, ev.targetId, ev.occurredOn),
    storeId: ev.storeId,
    source: "ANOMALY_EVENT",
    anomalyEventId: ev.id,
    target,
    targetId: ev.targetId,
    severity: gradeSeverity({
      zScore: ev.zScore,
      method: ev.method,
      intervalExcess: ctx.intervalExcess,
      dollarsAtRisk: dollars,
    }),
    title: titleFor(ev),
    body: bodyFor(ev, ctx),
    metadata: {
      residual: ev.residual,
      zScore: ev.zScore,
      method: ev.method,
      comparedTo: comparedTo(ev),
      dollarsAtRisk: dollars,
      unitPrice: ctx.unitPrice,
      intervalExcess: ctx.intervalExcess,
    },
    occurredOn: ev.occurredOn,
  }
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Store names, menu-item unit prices and interval excess for a batch of
 * events — three queries for the whole batch, not three per event. Each event
 * is keyed by its own storeId, so nothing crosses a store boundary.
 */
async function loadContexts(events: AnomalyEvent[]): Promise<(e: AnomalyEvent) => AlertContext> {
  const storeIds = [...new Set(events.map((e) => e.storeId))]
  const itemNames = [
    ...new Set(
      events.flatMap((e) => (e.target === "MENU_ITEM" && e.targetId ? [e.targetId] : [])),
    ),
  ]
  const intervalEvents = events.filter((e) => e.method === INTERVAL_METHOD && e.target === "REVENUE")
  const priceCutoff = new Date()
  priceCutoff.setUTCDate(priceCutoff.getUTCDate() - PRICE_LOOKBACK_DAYS)

  const [stores, prices, forecasts] = await Promise.all([
    storeIds.length === 0
      ? Promise.resolve([])
      : prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } }),
    itemNames.length === 0
      ? Promise.resolve([])
      : prisma.otterMenuItem.groupBy({
          by: ["storeId", "itemName"],
          where: {
            storeId: { in: storeIds },
            itemName: { in: itemNames },
            isModifier: false,
            date: { gte: priceCutoff },
          },
          _sum: { fpTotalSales: true, tpTotalSales: true, fpQuantitySold: true, tpQuantitySold: true },
        }),
    intervalEvents.length === 0
      ? Promise.resolve([])
      : prisma.forecastDailyRevenue.findMany({
          where: {
            storeId: { in: [...new Set(intervalEvents.map((e) => e.storeId))] },
            forecastDate: {
              in: [...new Set(intervalEvents.map((e) => e.occurredOn.getTime()))].map((t) => new Date(t)),
            },
            hourBucket: 0,
            actualRevenue: { not: null },
            p10: { not: null },
            p90: { not: null },
          },
          // Newest first, so the first row per date is the one the detector
          // scored (ml/anomaly/interval.py load_reconciled_observations).
          orderBy: { generatedAt: "desc" },
          select: {
            storeId: true,
            forecastDate: true,
            predictedRevenue: true,
            p10: true,
            p90: true,
            actualRevenue: true,
          },
        }),
  ])

  const nameOf = new Map(stores.map((s) => [s.id, s.name]))
  const priceOf = new Map<string, number>()
  for (const p of prices) {
    const qty = (p._sum.fpQuantitySold ?? 0) + (p._sum.tpQuantitySold ?? 0)
    const sales = (p._sum.fpTotalSales ?? 0) + (p._sum.tpTotalSales ?? 0)
    if (qty > 0 && sales > 0) priceOf.set(`${p.storeId}|${p.itemName}`, sales / qty)
  }
  const excessOf = new Map<string, number>()
  for (const f of forecasts) {
    const key = `${f.storeId}|${dayKey(f.forecastDate)}`
    if (excessOf.has(key) || f.actualRevenue == null || f.p10 == null || f.p90 == null) continue
    const above = f.actualRevenue > f.p90
    const half = above ? f.p90 - f.predictedRevenue : f.predictedRevenue - f.p10
    const excess = above ? f.actualRevenue - f.p90 : f.p10 - f.actualRevenue
    if (half > 0 && excess > 0) excessOf.set(key, excess / half)
  }

  return (e) => ({
    storeName: nameOf.get(e.storeId) ?? null,
    unitPrice:
      e.target === "MENU_ITEM" && e.targetId ? (priceOf.get(`${e.storeId}|${e.targetId}`) ?? null) : null,
    intervalExcess:
      e.method === INTERVAL_METHOD ? (excessOf.get(`${e.storeId}|${dayKey(e.occurredOn)}`) ?? null) : null,
  })
}

// Scan recent OPEN AnomalyEvents and upsert Alert rows. `sinceDays` bounds
// the scan so the nightly post-step doesn't rescan the entire history.
export async function ingestFromAnomalyEvents(
  options: { sinceDays?: number; storeIds?: string[] } = {},
): Promise<IngestResult> {
  const sinceDays = options.sinceDays ?? 14
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - sinceDays)

  const events = await prisma.anomalyEvent.findMany({
    where: {
      detectedAt: { gte: cutoff },
      ...(options.storeIds ? { storeId: { in: options.storeIds } } : {}),
    },
    orderBy: { detectedAt: "asc" },
  })

  let created = 0
  let updated = 0

  const contextFor = await loadContexts(events)
  for (const ev of events) {
    const payload = anomalyEventToAlert(ev, contextFor(ev))
    const { storeId, ...rest } = payload
    const result = await prisma.alert.upsert({
      where: { dedupeKey: payload.dedupeKey },
      // We don't overwrite status/explanation/acknowledgedAt — those are
      // user-driven and the detector shouldn't undo a triage action. The
      // detection-side fields (severity, title, body, metadata) can refresh.
      update: {
        severity: payload.severity,
        title: payload.title,
        body: payload.body,
        metadata: payload.metadata,
        anomalyEventId: payload.anomalyEventId,
      },
      create: {
        ...rest,
        store: { connect: { id: storeId } },
      },
      select: { id: true, detectedAt: true },
    })
    // Approximate created vs updated: detectedAt within last 2s of now.
    if (Date.now() - result.detectedAt.getTime() < 2000) {
      created++
    } else {
      updated++
    }
  }

  return { scanned: events.length, created, updated }
}
