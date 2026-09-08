import { prisma } from "@/lib/prisma"
import {
  loadStoreInventoryContext,
  runningOnHandFromContext,
  dailyDepletionRateFromContext,
} from "@/lib/inventory/store-inventory-context"
import {
  computeReorderRecommendation,
  type ReorderStatus,
} from "@/lib/inventory/reorder-recommendation"
import {
  computeForecastShapedDepletion,
  coverDaysFromSeries,
} from "@/lib/inventory/forecast-depletion"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { weekDayLabel } from "@/lib/counter/week-window"
import type { Tone } from "@/components/counter"

/**
 * "What you will run out of" — the week ahead, read against the shelf.
 *
 * The verdict at the top of this page can already say a stockout HAPPENED:
 * "1 Slider and Fries ran out, −$2,034". This section is the same event four
 * days earlier, and it is built out of two readings of the same shelf:
 *
 *   - **The flat read.** `dailyDepletionRateFromContext` — a fourteen-day
 *     trailing mean. It is what `/dashboard/operations/inventory` shows today
 *     and what `computeReorderRecommendation` has always divided by.
 *   - **The forecast-shaped read.** `computeForecastShapedDepletion` — the
 *     week's own predicted menu-item demand exploded through the recipe graph,
 *     consumed day by day. See that module's note for why every input for it
 *     was already on file.
 *
 * BOTH are drawn, stacked, because the divergence is the finding. A row where
 * the two agree is a row where the flat average happened to be right; a row
 * where the forecast-shaped bar is visibly shorter is an order the current
 * product would have let the owner miss.
 *
 * ## The thresholds still belong to `computeReorderRecommendation`
 *
 * The status is not recomputed here. The forecast-shaped cover is converted
 * back into the effective rate that produces it (`onHand / coverDays`) and put
 * through the same pure function the inventory dashboard uses, so "reorder
 * now" means one thing in this product rather than two. Only the RATE changed;
 * the judgement about it did not move.
 *
 * ## Tenancy
 *
 * `accountId` filters the ingredient read, the lead-time read and the recipe
 * graph. `storeIds` must already be resolved — this module never resolves its
 * own store context and never reads the session.
 */

const DEFAULT_FALLBACK_LEAD_DAYS = 3
/** How far the forecast can shape demand. Past this the tail is extrapolated. */
export const RUN_OUT_HORIZON_DAYS = 14
/** How many rows the desk draws. The rest are ranked behind them. */
export const RUN_OUT_SHOWN = 4
/** The bar's full span, in days. A row with more cover than this fills it. */
export const RUN_OUT_SCALE_DAYS = 7

export interface RunOutRow {
  key: string
  /** The ingredient. */
  name: string
  /** "EA · IFS · LEAD 2D" — unit, most recent vendor, measured lead time. */
  meta: string
  /** Which store's shelf, when more than one is in view. Null otherwise. */
  store: string | null
  /** Days of cover at the flat fourteen-day trailing rate. Null when that rate is zero. */
  flatCoverDays: number | null
  /** Days of cover consumed at the week's own forecast demand. */
  forecastCoverDays: number | null
  /** True when on-hand outlasted the forecast horizon and the tail is a flat extrapolation. */
  extrapolated: boolean
  /** Measured median vendor lead time, in days. */
  leadDays: number
  /** `max(1, 0.5 × leadDays)` — `computeReorderRecommendation`'s own. */
  safetyDays: number
  /** leadDays + safetyDays. Where the marker sits on both bars. */
  reorderLineDays: number
  status: ReorderStatus
  /** "Fri close" — the day it goes and how far into that day's trade. */
  outLabel: string
  /** "Order now" / "Order Fri" / "Fine". */
  tag: string
  tagTone: Tone
  /** How much to bring in, in recipe units. Empty when nothing is owed. */
  qty: string
  href: string
}

export interface RunOut {
  rows: RunOutRow[]
  /** How many are past the reorder line — the number in the section head. */
  hot: number
  /** True when any row's explosion was incomplete. */
  partial: boolean
  horizonDays: number
  scaleDays: number
}

export interface RunOutInput {
  accountId: string
  /** Already resolved. See the file note. */
  storeIds: string[]
  asOf: Date
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export async function loadRunOut(input: RunOutInput): Promise<RunOut> {
  const empty: RunOut = {
    rows: [],
    hot: 0,
    partial: false,
    horizonDays: RUN_OUT_HORIZON_DAYS,
    scaleDays: RUN_OUT_SCALE_DAYS,
  }
  if (input.storeIds.length === 0) return empty

  const [ingredients, leadTimeRows, storeRows] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      where: { accountId: input.accountId },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        recipeUnit: true,
        // Without the pack fields every case-priced delivery is dropped and
        // on-hand reads far too low. See `convertDelivered` in usage-math.ts.
        caseUnit: true,
        recipeUnitsPerCase: true,
        innerPackUnit: true,
        innerPacksPerCase: true,
      },
    }),
    prisma.vendorLeadTime.findMany({
      where: { accountId: input.accountId },
      select: { vendorNameNormalized: true, medianLeadDays: true, sampleSize: true },
    }),
    // Only needed to label a row when the reader is looking at more than one
    // kitchen — stock is per shelf, so an aggregate view has to say whose.
    input.storeIds.length > 1
      ? prisma.store.findMany({
          where: { accountId: input.accountId, id: { in: input.storeIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ])
  if (ingredients.length === 0) return empty

  const storeNames = new Map(storeRows.map((r) => [r.id, r.name]))
  const leadByVendor = new Map(
    leadTimeRows.map((r) => [r.vendorNameNormalized, r.medianLeadDays]),
  )
  const ingredientIds = ingredients.map((i) => i.id)

  const forecastByStore = await Promise.all(
    input.storeIds.map((storeId) =>
      computeForecastShapedDepletion({
        accountId: input.accountId,
        storeIds: [storeId],
        ingredientIds,
        from: input.asOf,
        days: RUN_OUT_HORIZON_DAYS,
      }).then((m) => [storeId, m] as const),
    ),
  )
  const forecastLookup = new Map(forecastByStore)

  const rows: RunOutRow[] = []
  let partial = false

  for (const storeId of input.storeIds) {
    const [ctx, vendorLines] = await Promise.all([
      loadStoreInventoryContext({ storeId, accountId: input.accountId, asOf: input.asOf }),
      prisma.invoiceLineItem.findMany({
        where: { invoice: { storeId }, canonicalIngredientId: { not: null } },
        orderBy: { invoice: { invoiceDate: "desc" } },
        select: {
          canonicalIngredientId: true,
          invoice: { select: { vendorName: true } },
        },
      }),
    ])

    const vendorByIngredient = new Map<string, string>()
    for (const line of vendorLines) {
      if (!line.canonicalIngredientId) continue
      if (vendorByIngredient.has(line.canonicalIngredientId)) continue
      vendorByIngredient.set(line.canonicalIngredientId, line.invoice.vendorName)
    }

    const forecast = forecastLookup.get(storeId)

    for (const ing of ingredients) {
      const onHandResult = runningOnHandFromContext(ctx, ing)
      // An ingredient nobody has ever counted has no anchored on-hand, and a
      // cover figure taken from a zero base is a stockout this page would
      // announce every week for something sitting on the shelf.
      if (onHandResult.baseAt === null) continue
      const onHand = onHandResult.onHand
      if (onHand <= 0) continue

      const flat = dailyDepletionRateFromContext(ctx, ing)
      const shaped = forecast?.get(ing.id)
      if (!shaped || shaped.totalQty <= 0) continue
      if (shaped.partial) partial = true

      const vendorRaw = vendorByIngredient.get(ing.id) ?? null
      const leadDays =
        (vendorRaw ? leadByVendor.get(normalizeVendorName(vendorRaw)) : undefined)
        ?? DEFAULT_FALLBACK_LEAD_DAYS

      const cover = coverDaysFromSeries(
        onHand,
        shaped.days.map((d) => d.qty),
        shaped.meanPerDay,
      )
      if (cover.coverDays === null) continue

      // The SAME thresholds the inventory dashboard applies, fed the rate the
      // forecast-shaped cover implies rather than the trailing mean.
      const effectiveRate = cover.coverDays > 0 ? onHand / cover.coverDays : shaped.meanPerDay
      const reco = computeReorderRecommendation({
        onHand,
        ratePerDay: effectiveRate,
        leadDays,
        asOf: input.asOf,
      })

      const flatCover =
        flat.ratePerDay > 0 ? onHand / flat.ratePerDay : null

      rows.push({
        key: `${storeId}:${ing.id}`,
        name: ing.name,
        // Unit, vendor and lead time FIRST. The caption is one line and
        // ellipsises; with more than one store in view the store name led it
        // and ate the whole row, leaving four captions that all read
        // "CHRIS N EDDYS - HOLL…". The store is the least load-bearing of the
        // four and so it is the one that gets trimmed.
        meta: [
          (ing.recipeUnit ?? "unit").toUpperCase(),
          vendorRaw ? vendorRaw.toUpperCase() : "NO VENDOR",
          `LEAD ${round1(leadDays)}D`,
        ].join(" · "),
        store: input.storeIds.length > 1 ? (storeNames.get(storeId) ?? null) : null,
        flatCoverDays: flatCover,
        forecastCoverDays: cover.coverDays,
        extrapolated: cover.beyondHorizon,
        leadDays,
        safetyDays: reco.safetyDays,
        reorderLineDays: leadDays + reco.safetyDays,
        status: reco.status,
        outLabel: outLabel(input.asOf, cover.coverDays),
        tag: tagFor(reco.status, input.asOf, reco.reorderBy),
        tagTone: toneFor(reco.status),
        qty: owedQty(shaped.days.map((d) => d.qty), onHand, leadDays, reco.safetyDays, ing.recipeUnit ?? ""),
        href: `/dashboard/operations/inventory?ingredient=${encodeURIComponent(ing.id)}`,
      })
    }
  }

  // Most urgent first: least slack against the reorder line.
  rows.sort((a, b) => {
    const as = (a.forecastCoverDays ?? Infinity) - a.reorderLineDays
    const bs = (b.forecastCoverDays ?? Infinity) - b.reorderLineDays
    return as - bs
  })

  const hot = rows.filter((r) => r.status === "reorder_now" || r.status === "urgent").length
  return {
    rows: rows.slice(0, RUN_OUT_SHOWN),
    hot,
    partial,
    horizonDays: RUN_OUT_HORIZON_DAYS,
    scaleDays: RUN_OUT_SCALE_DAYS,
  }
}

function round1(v: number): string {
  return (Math.round(v * 10) / 10).toString()
}

/**
 * When it goes, in the owner's words.
 *
 * The fraction is of that day's TRADE, not of its clock — the crossing was
 * interpolated inside the day by `coverDaysFromSeries`, which consumed the
 * day's predicted demand, not its hours. Restaurant demand is weighted to the
 * evening, so a third of a day's trade is roughly lunch and two thirds of it
 * is roughly dinner service. Three words rather than a time, because a time
 * would be a precision the arithmetic does not have.
 */
function outLabel(asOf: Date, coverDays: number): string {
  const whole = Math.floor(coverDays)
  const fraction = coverDays - whole
  const day = new Date(asOf.getTime() + whole * MS_PER_DAY)
  const label = weekDayLabel(day.toISOString().slice(0, 10))
  const when = fraction < 0.34 ? "open" : fraction < 0.7 ? "lunch" : "close"
  return `${label} ${when}`
}

function tagFor(status: ReorderStatus, asOf: Date, reorderBy: Date | null): string {
  if (status === "urgent" || status === "reorder_now") return "Order now"
  if (status === "no_signal") return "No read"
  if (status === "reorder_soon" && reorderBy) {
    const days = Math.max(0, Math.round((reorderBy.getTime() - asOf.getTime()) / MS_PER_DAY))
    if (days <= 0) return "Order now"
    return `Order ${weekDayLabel(
      new Date(asOf.getTime() + days * MS_PER_DAY).toISOString().slice(0, 10),
    ).split(" ")[0]}`
  }
  return "Fine"
}

function toneFor(status: ReorderStatus): Tone {
  if (status === "urgent" || status === "reorder_now") return "bad"
  if (status === "reorder_soon") return "warn"
  return "good"
}

/**
 * What to bring in: the demand between now and the far side of the reorder
 * line, less what is already on the shelf. Rounded up to something a person
 * can order. Empty when the shelf already covers it — this column is an
 * instruction, and an instruction to order nothing is noise.
 */
function owedQty(
  series: number[],
  onHand: number,
  leadDays: number,
  safetyDays: number,
  unit: string,
): string {
  const through = Math.ceil(leadDays + safetyDays)
  let need = 0
  for (let i = 0; i < Math.min(through, series.length); i++) need += series[i]
  const owed = need - onHand
  if (owed <= 0) return ""
  const rounded = owed >= 20 ? Math.ceil(owed / 5) * 5 : Math.ceil(owed)
  return `${rounded.toLocaleString("en-US")}${unit ? ` ${unit}` : ""}`
}
