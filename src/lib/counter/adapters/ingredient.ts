import { prisma } from "@/lib/prisma"
import { businessQueryDate } from "@/lib/counter/business-date"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import {
  MS_PER_DAY,
  convertDelivered,
  sumDeliveries,
  type IngredientPack,
} from "@/lib/inventory/usage-math"
import {
  count,
  money,
  pct,
  plural,
  pluralWord,
  titleCase,
  unitCost,
} from "@/lib/counter/format"
import { rangeLabel, toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, Row } from "@/components/counter"

/**
 * One ingredient — `P.ingredient` (`docs/counter/counter-prototype.html:7020`).
 *
 * "Price history, the SKUs that match it, and everything it touches."
 *
 * Measured before it was written:
 * `docs/counter/measurements/2026-08-28-ingredient.md`. **The route has never
 * existed** — the Ingredients catalogue and the Inventory adapter have both
 * been emitting `/dashboard/ingredients/{id}` on every row into a 404.
 *
 * Two of the prototype's five strip cells and one of its table columns have no
 * data behind them here, and its whole narrative runs the wrong way. Each is
 * argued at the function it changed.
 *
 * Two sections are ours rather than the prototype's — `deliveriesOf` (when it
 * last arrived and how much of it did) and `costOf` (the one number on this
 * page the owner can be right about and we can be wrong). Both are argued at
 * the function, and both add landmarks `e2e/fidelity/manifest.ts` has to
 * account for; only `costOf`'s are written there so far.
 */

/** Weeks of price history the chart draws. */
const WEEKS = 8
/** Series before the rest is dropped — one per vendor, biggest first. */
const SERIES = 3
/** Rows on the phone's list. */
const PHONE_ROWS = 3
/** A move smaller than this reads "flat". */
const FLAT_PCT = 2
/**
 * Deliveries on the list, newest first.
 *
 * The total under the table is Σ over exactly these rows and says so, so the
 * limit is a display choice rather than a window the figure is a claim about —
 * there is no range here that a reader could mistake for the date control's.
 */
const DELIVERIES = 8
/**
 * A SKU nobody has bought in more than this many days is marked on the
 * matched-SKU table, and the note under it says "six months".
 *
 * 183 and not 180, so the copy is true of every row it marks: six calendar
 * months is 181 to 184 days depending on which six, and a threshold of 180
 * would mark a row at 181 days that has not yet been six months anywhere on
 * the calendar. The mark is a claim about the row, so it takes the longer
 * reading of the phrase rather than the shorter one.
 */
const SKU_STALE_DAYS = 183

export interface IngredientHead {
  title: string
  sub: string
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface IngredientPrices {
  chart: ChartSpec
  phoneChart: ChartSpec
  meta: string
  note: string
}

export interface IngredientSkus {
  rows: Row[]
  meta: string
  note: string
}

export interface IngredientUsedIn {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

/**
 * When this ingredient last arrived, and how much of it did.
 *
 * `unit` is the recipe unit the converted column is expressed in, and it is
 * null when the ingredient has none — the case where NOTHING converts and the
 * section must claim no total at all. The desk client builds its column header
 * from it for that reason.
 */
export interface IngredientDeliveries {
  rows: Row[]
  phoneRows: MListRow[]
  unit: string | null
  meta: string
  note: string
}

/**
 * What the page can CHANGE about this ingredient, as opposed to what it
 * reports. See `costOf` for why an owner needs it.
 */
export interface IngredientCost {
  ingredientId: string
  /** `costPerRecipeUnit` — the number every recipe on the account multiplies. */
  costNow: number | null
  /** "invoice" / "manual" / null. Named in the note so the owner knows whose figure they are overwriting. */
  costSource: string | null
  /** The unit `costNow` is per. Editable: half of all bad costs are a good number against the wrong unit. */
  recipeUnit: string | null
  /** When true, invoice sync stops overwriting this cost. */
  costLocked: boolean
  meta: string
  note: string
}

export interface IngredientSections {
  head: SectionData<IngredientHead>
  prices: SectionData<IngredientPrices>
  deliveries: SectionData<IngredientDeliveries>
  skus: SectionData<IngredientSkus>
  usedIn: SectionData<IngredientUsedIn>
  cost: SectionData<IngredientCost>
}

export interface IngredientInput {
  ingredientId: string
  storeId: string | null
  accountId: string
  range: DateRange
  today: Date
}

/* -- loading ---------------------------------------------------------- */

interface SkuRow {
  vendor: string
  sku: string | null
  product: string
  lines: number
  packSize: number | null
  unitSize: number | null
  unitSizeUom: string | null
  lastPrice: number | null
  lineUnit: string | null
  confirmed: boolean
  conversion: number | null
  fromUnit: string | null
  toUnit: string | null
  /** The newest `Invoice.invoiceDate` any line under this (vendor, SKU) carries. */
  lastSeen: Date | null
}

/** One invoice line, as an arrival rather than as a price. */
interface DeliveryLineRow {
  id: string
  date: Date
  vendor: string
  quantity: number
  unit: string | null
  value: number
}

interface UseRow {
  recipeId: string
  recipe: string
  quantity: number
  unit: string
  lineCost: number | null
  sold: number
}

interface Loaded {
  id: string
  name: string
  recipeUnit: string | null
  category: string | null
  costNow: number | null
  costSource: string | null
  costLocked: boolean
  vendors: number
  spendRange: number
  spendShare: number | null
  weekly: Array<{ week: string; vendor: string; price: number }>
  move: number | null
  skus: SkuRow[]
  uses: UseRow[]
  deliveries: DeliveryLineRow[]
  /** The pack definition `convertDelivered` needs to turn a case into a recipe unit. */
  pack: IngredientPack
  /** Today's business date, for "how long since" arithmetic against `@db.Date` values. */
  asOf: Date
  onHandLines: number
  accountCountLines: number
  rangeLabel: string
}

async function loadIngredient(input: IngredientInput): Promise<Loaded | null> {
  const { ingredientId, accountId, storeId, range, today } = input
  const { startDate, endDate } = toQueryBounds(range)

  const ing = await prisma.canonicalIngredient.findFirst({
    where: { id: ingredientId, accountId },
    select: {
      id: true,
      name: true,
      recipeUnit: true,
      category: true,
      costPerRecipeUnit: true,
      costSource: true,
      costLocked: true,
      // The pack is the CS -> recipe-unit factor `convertDelivered` needs.
      // Without it every case-billed delivery is dropped from the total under
      // the deliveries table — see that function's docblock in
      // `@/lib/inventory/usage-math`, which measures what omitting it cost the
      // inventory walk.
      caseUnit: true,
      recipeUnitsPerCase: true,
      innerPackUnit: true,
      innerPacksPerCase: true,
    },
  })
  if (!ing) return null

  const stores = await getScopedStores(accountId, storeId ?? null)
  const storeIds = stores.map((s) => s.id)

  const [lines, weekly, skuMatches, recipeUses, costs, onHand, allCounts, spend, deliveries] =
    await Promise.all([
      prisma.$queryRaw<
        Array<{
          vendor: string
          sku: string | null
          product: string
          n: number
          pack: number | null
          unit_size: number | null
          uom: string | null
          last_px: number | null
          line_unit: string | null
          last_seen: Date | null
        }>
      >`
        SELECT i."vendorName" AS vendor, li.sku AS sku,
               (ARRAY_AGG(li."productName" ORDER BY i."invoiceDate" DESC))[1] AS product,
               COUNT(*)::int AS n,
               MAX(li."packSize")::int AS pack, MAX(li."unitSize")::float AS unit_size,
               MAX(li."unitSizeUom") AS uom,
               (ARRAY_AGG(li."unitPrice" ORDER BY i."invoiceDate" DESC))[1]::float AS last_px,
               MAX(li.unit) AS line_unit,
               -- Which of these codes is still a code you buy under. NULL when
               -- every line under it is undated, which is not the same finding
               -- as "long ago" and is not rendered as one.
               MAX(i."invoiceDate") AS last_seen
        FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
        WHERE li."canonicalIngredientId" = ${ingredientId} AND i."accountId" = ${accountId}
        GROUP BY 1, 2 ORDER BY 4 DESC`,
      prisma.$queryRaw<Array<{ wk: Date; vendor: string; px: number }>>`
        SELECT DATE_TRUNC('week', i."invoiceDate")::date AS wk, i."vendorName" AS vendor,
               (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY li."unitPrice"))::float AS px
        FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
        WHERE li."canonicalIngredientId" = ${ingredientId} AND i."accountId" = ${accountId}
          AND li."unitPrice" > 0
          AND i."invoiceDate" >= DATE_TRUNC('week', ${businessQueryDate(today)}::date) - MAKE_INTERVAL(weeks => ${WEEKS - 1})
        GROUP BY 1, 2 ORDER BY 1`,
      prisma.ingredientSkuMatch.findMany({
        where: { canonicalIngredientId: ingredientId },
        select: {
          vendorName: true,
          sku: true,
          conversionFactor: true,
          fromUnit: true,
          toUnit: true,
          confirmedAt: true,
        },
      }),
      prisma.recipeIngredient.findMany({
        where: { canonicalIngredientId: ingredientId },
        select: { quantity: true, unit: true, recipe: { select: { id: true, itemName: true } } },
      }),
      batchRecipeCosts(accountId),
      prisma.stockCountLine.count({ where: { canonicalIngredientId: ingredientId } }),
      prisma.stockCountLine.count({ where: { stockCount: { store: { accountId } } } }),
      prisma.$queryRaw<Array<{ mine: number; all: number }>>`
        SELECT COALESCE(SUM(li."extendedPrice") FILTER (
                 WHERE li."canonicalIngredientId" = ${ingredientId}), 0)::float AS mine,
               COALESCE(SUM(li."extendedPrice"), 0)::float AS all
        FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
        WHERE i."accountId" = ${accountId}
          AND i."invoiceDate" >= ${startDate} AND i."invoiceDate" <= ${endDate}`,
      // THE ARRIVALS. Not scoped to the reader's range on purpose: "when did
      // this last turn up" is the question a range cannot be allowed to answer
      // "never" to just because the reader stepped the control back a week.
      // The rows are the newest `DELIVERIES` of them and the section's total is
      // Σ over exactly those, which is what its copy claims.
      //
      // No `isReturn` filter. A credit memo's quantity is stored with its
      // natural negative sign (schema comment on `Invoice.isReturn`), so
      // leaving it in nets it out of the total rather than overstating what
      // arrived; it shows on the list as a negative row, and the note names it.
      prisma.$queryRaw<
        Array<{
          id: string
          d: Date
          vendor: string
          qty: number
          unit: string | null
          ext: number
        }>
      >`
        SELECT li.id AS id, i."invoiceDate" AS d, i."vendorName" AS vendor,
               li.quantity::float AS qty, li.unit AS unit,
               li."extendedPrice"::float AS ext
        FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
        WHERE li."canonicalIngredientId" = ${ingredientId} AND i."accountId" = ${accountId}
          AND i."invoiceDate" IS NOT NULL
        ORDER BY i."invoiceDate" DESC, li.id DESC
        LIMIT ${DELIVERIES}`,
    ])

  // Sold volume per recipe, over the reader's range.
  const recipeIds = recipeUses.map((r) => r.recipe.id)
  const sold =
    storeIds.length === 0 || recipeIds.length === 0
      ? []
      : await prisma.$queryRaw<Array<{ rid: string; qty: number }>>`
          SELECT m."recipeId" AS rid, SUM(oi.quantity)::int AS qty
          FROM "OtterItemMapping" m
          JOIN "OtterOrderItem" oi ON oi.name = m."otterItemName"
          JOIN "OtterOrder" o ON o.id = oi."orderId"
          WHERE m."recipeId" = ANY(${recipeIds})
            AND o."storeId" = ANY(${storeIds})
            AND o."referenceTimeLocal" >= ${startDate}
            AND o."referenceTimeLocal" <= ${endDate}
          GROUP BY 1`
  const soldById = new Map(sold.map((s) => [s.rid, s.qty]))

  // The learned match, keyed the way the matcher keys it, so a row stored
  // against "Sysco" is found by a line that says "Sysco Los Angeles, Inc.".
  const matchKey = (vendor: string, sku: string | null) =>
    `${normalizeVendorName(vendor).toLowerCase()} ${(sku ?? "").toUpperCase()}`
  const learned = new Map(skuMatches.map((m) => [matchKey(m.vendorName, m.sku), m]))

  // Weekly medians, normalized vendor, oldest first — the move below and the
  // chart above are the same series, so the cell and the picture agree.
  const points = weekly.map((w) => ({
    week: w.wk.toISOString().slice(0, 10),
    vendor: normalizeVendorName(w.vendor),
    price: w.px,
  }))
  const allWeeks = [...new Set(points.map((p) => p.week))].sort()
  const overall = allWeeks.map((w) => {
    const at = points.filter((p) => p.week === w)
    return at.reduce((t, p) => t + p.price, 0) / at.length
  })
  const move =
    overall.length >= 2 && overall[0] > 0
      ? ((overall[overall.length - 1] - overall[0]) / overall[0]) * 100
      : null

  const costOf = (recipeId: string): number | null => {
    const walked = costs.get(recipeId)
    const line = walked?.lines.find((l) => l.refId === ingredientId)
    return line && !line.missingCost ? line.lineCost : null
  }

  return {
    id: ing.id,
    name: ing.name,
    recipeUnit: ing.recipeUnit,
    category: ing.category,
    costNow: ing.costPerRecipeUnit,
    costSource: ing.costSource,
    costLocked: ing.costLocked,
    vendors: new Set(lines.map((l) => normalizeVendorName(l.vendor))).size,
    spendRange: spend[0]?.mine ?? 0,
    spendShare:
      (spend[0]?.all ?? 0) > 0 ? ((spend[0]?.mine ?? 0) / (spend[0]?.all ?? 1)) * 100 : null,
    weekly: points,
    move,
    skus: foldSkus(lines, learned, matchKey),
    uses: recipeUses
      .map((r) => ({
        recipeId: r.recipe.id,
        recipe: r.recipe.itemName,
        quantity: r.quantity,
        unit: r.unit,
        lineCost: costOf(r.recipe.id),
        sold: soldById.get(r.recipe.id) ?? 0,
      }))
      .sort((a, b) => b.sold - a.sold),
    deliveries: deliveries.map((l) => ({
      id: l.id,
      date: l.d,
      vendor: normalizeVendorName(l.vendor),
      quantity: l.qty,
      unit: l.unit,
      value: l.ext,
    })),
    pack: {
      caseUnit: ing.caseUnit,
      recipeUnitsPerCase: ing.recipeUnitsPerCase,
      innerPackUnit: ing.innerPackUnit,
      innerPacksPerCase: ing.innerPacksPerCase,
    },
    asOf: businessQueryDate(today),
    onHandLines: onHand,
    accountCountLines: allCounts,
    rangeLabel: rangeLabel(range, "custom"),
  }
}

/**
 * One row per (vendor, SKU) — after the vendor name is normalized, not before.
 *
 * The SQL groups on the raw `vendorName`, so `Premier Meats & Crystal Bay` and
 * `Premier Meats` come back as two rows carrying the SAME part number,
 * `0014046-01`. They are one supplier billing one product under two spellings,
 * and rendering them as two rows says this ingredient has two sources when it
 * has one. (React noticed before a reader would: both rows keyed to the same
 * normalized vendor and SKU, which is the collision that exposed this.)
 *
 * Folding is the fourth page this same vendor-identity fact has surfaced on,
 * and the first where it changes a row COUNT rather than a total. Lines add;
 * the newest price and product name win, because the fold is ordered by the
 * SQL's own `invoiceDate DESC` aggregation and the first row seen is the most
 * recent. Pack shape takes the largest seen — catch-weight cases genuinely
 * vary delivery to delivery, so a single figure there is indicative, not exact.
 *
 * `lastSeen` takes the LATER of the two, for the same reason the lines add: a
 * supplier who billed this part number last week under one spelling and
 * eighteen months ago under another has been buying it for eighteen months and
 * bought it last week. Taking the earlier date would age the row the fold just
 * merged into and mark a current SKU as history.
 */
function foldSkus(
  lines: ReadonlyArray<{
    vendor: string
    sku: string | null
    product: string
    n: number
    pack: number | null
    unit_size: number | null
    uom: string | null
    last_px: number | null
    line_unit: string | null
    last_seen: Date | null
  }>,
  learned: Map<string, { confirmedAt: Date | null; conversionFactor: number; fromUnit: string | null; toUnit: string | null }>,
  matchKey: (vendor: string, sku: string | null) => string,
): SkuRow[] {
  const out = new Map<string, SkuRow>()
  for (const l of lines) {
    const vendor = normalizeVendorName(l.vendor)
    const key = `${vendor}\u0000${(l.sku ?? "").toUpperCase()}`
    const seen = out.get(key)
    if (seen) {
      seen.lines += l.n
      seen.packSize = Math.max(seen.packSize ?? 0, l.pack ?? 0) || null
      seen.unitSize = Math.max(seen.unitSize ?? 0, l.unit_size ?? 0) || null
      seen.lastSeen =
        seen.lastSeen === null || (l.last_seen !== null && l.last_seen > seen.lastSeen)
          ? l.last_seen
          : seen.lastSeen
      continue
    }
    const m = learned.get(matchKey(l.vendor, l.sku))
    out.set(key, {
      vendor,
      sku: l.sku,
      product: l.product,
      lines: l.n,
      packSize: l.pack,
      unitSize: l.unit_size,
      unitSizeUom: l.uom,
      lastPrice: l.last_px,
      lineUnit: l.line_unit,
      confirmed: m?.confirmedAt != null,
      conversion: m?.conversionFactor ?? null,
      fromUnit: m?.fromUnit ?? null,
      toUnit: m?.toUnit ?? null,
      lastSeen: l.last_seen,
    })
  }
  return [...out.values()].sort((a, b) => b.lines - a.lines)
}

/* -- helpers ---------------------------------------------------------- */

const D = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

/**
 * A `@db.Date` value as a day, carrying its YEAR only when that year is not
 * the one the page is being read in.
 *
 * `D` above is for the price chart's axis, where every label is inside the
 * same eight weeks and a year on each would be noise. These two lists are not:
 * the whole point of "last seen" is that a SKU can be fourteen months old, and
 * "Jul 1" with no year on a row that is really July of last year is the exact
 * misreading the column exists to remove.
 */
const day = (d: Date, asOf: Date): string => {
  const iso = d.toISOString().slice(0, 10)
  const sameYear = iso.slice(0, 4) === asOf.toISOString().slice(0, 4)
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  })
}

/** Whole days between two `@db.Date` values, both of which are UTC midnight. */
const daysBetween = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)

const moveText = (m: number | null) =>
  m === null
    ? "no prior"
    : Math.abs(m) < FLAT_PCT
      ? "flat"
      : `${m > 0 ? "▲" : "▼"} ${Math.abs(m).toFixed(0)}%`

/**
 * True when the invoice's product name disagrees with the canonical's about
 * something that is not spelling.
 *
 * Only fat ratios and a handful of qualifiers, because a general "do these
 * names agree" is a matching problem and this is a glyph on a table. `73/27`
 * against `75/25` is a different blend; `Halal` against a canonical that does
 * not say so is a different product line. Both are legitimate substitutions a
 * buyer may have made on purpose — the mark says "this row is not the thing
 * the canonical is named after", not "this is wrong".
 */
function disagrees(product: string, canonical: string): boolean {
  // A fat ratio both names state, differently. 73/27 against 75/25 is a
  // different blend of the same meat.
  const ratio = (s: string) => s.match(/\b(\d{2})\s*\/\s*(\d{2})\b/)?.[0]?.replace(/\s/g, "")
  const a = ratio(product)
  const b = ratio(canonical)
  if (a && b && a !== b) return true

  // Descriptors that cannot both be true of one product. Each group is
  // checked only when BOTH names commit to a value in it, so a canonical that
  // simply does not mention colour never flags anything.
  for (const group of EXCLUSIVE) {
    const inProduct = group.find((w) => w.test(product))
    const inCanonical = group.find((w) => w.test(canonical))
    if (inProduct && inCanonical && inProduct !== inCanonical) return true
  }

  // A qualifier one name carries and the other does not.
  const halal = /\bhalal\b/i
  return halal.test(product) !== halal.test(canonical)
}

/**
 * Descriptor groups whose members are mutually exclusive.
 *
 * Deliberately short. This is a glyph on a table, not a matcher — the job is
 * to catch a row that is visibly not the thing the canonical is named after,
 * and to stay quiet otherwise. It found `CAN LINER 22X14X58 1.5 MIL CLR
 * 55GAL` billing against `can liner 40 x 46 1.5 mil black roll`: a clear
 * 55-gallon liner against a black 40x46 one, which is the can-liner
 * name-splitting problem showing up inside the catalogue rather than in the
 * unmatched queue.
 *
 * It does NOT catch a size that differs with no colour word to go on, and it
 * is not trying to. A general "are these the same product" belongs to the
 * matcher, where a wrong answer costs a mis-booked cost rather than a glyph.
 */
const EXCLUSIVE: RegExp[][] = [
  [/\bblack\b|\bblk\b/i, /\bclear\b|\bclr\b/i, /\bwhite\b|\bwht\b/i],
  [/\bfrozen\b|\bfrz\b/i, /\bfresh\b/i],
]

/* -- sections --------------------------------------------------------- */

/**
 * The strip, and the cell the prototype gives to inventory.
 *
 * `P.ingredient` reads `Price now / Vendors / In recipes / On hand / Spend`.
 * **`On hand - 36 lb - below a 40 lb par` has no data.** The account holds 4
 * stock counts and 10 count lines in total, and this ingredient — the largest
 * in the account by spend — has none of them. So the cell says how many count
 * lines exist rather than inventing a level, which is the same answer
 * `2026-08-28-inventory.md` reached from the other end.
 *
 * `Vendors` counts NORMALIZED names. The lines carry `Premier Meats & Crystal
 * Bay`, `Premier Meats` and `Sysco Los Angeles, Inc.`; that is three strings
 * and two suppliers, and a `COUNT(DISTINCT vendorName)` would print 3.
 */
function headOf(d: Loaded): IngredientHead {
  const priceCell: FigureProps = {
    label: "Price now",
    value:
      d.costNow === null
        ? "—"
        : `${unitCost(d.costNow)} / ${(d.recipeUnit ?? "unit").toLowerCase()}`,
    delta: d.move === null ? "no prior weeks" : `${moveText(d.move)} in ${count(WEEKS)} weeks`,
    // A price RISE is the bad one — this is what the restaurant pays.
    deltaTone: d.move === null ? "is-flat" : d.move > FLAT_PCT ? "is-down" : "is-flat",
  }
  const onHandCell: FigureProps = {
    label: "On hand",
    value: d.onHandLines === 0 ? "—" : count(d.onHandLines),
    delta:
      d.onHandLines === 0
        ? d.accountCountLines === 0
          ? "nothing has been counted"
          : `never counted · ${plural(d.accountCountLines, "line")} in the account`
        : "count lines",
    deltaTone: "is-down",
  }

  return {
    title: titleCase(d.name),
    sub:
      `Canonical ingredient · recipe unit: ${(d.recipeUnit ?? "not set").toLowerCase()}` +
      (d.category ? ` · ${d.category}` : ""),
    cells: [
      priceCell,
      {
        label: "Vendors",
        value: count(d.vendors),
        delta: [...new Set(d.skus.map((s) => s.vendor))].slice(0, 2).join(", ") || "none",
        deltaTone: "is-flat",
      },
      {
        label: "In recipes",
        value: count(d.uses.length),
        delta:
          d.spendShare === null
            ? d.rangeLabel
            : `${pct(d.spendShare, { scaled: true })} of food spend`,
        deltaTone: d.uses.length === 0 ? "is-down" : "is-flat",
      },
      onHandCell,
      {
        label: "Spend",
        value: money(d.spendRange),
        delta: d.rangeLabel,
        deltaTone: "is-flat",
      },
    ],
    phoneCells: [priceCell, onHandCell],
  }
}

/** Price history, one series per NORMALIZED vendor. */
function pricesOf(d: Loaded): IngredientPrices {
  const weeks = [...new Set(d.weekly.map((p) => p.week))].sort()
  const byVendor = new Map<string, Map<string, number>>()
  for (const p of d.weekly) {
    const m = byVendor.get(p.vendor) ?? new Map<string, number>()
    m.set(p.week, p.price)
    byVendor.set(p.vendor, m)
  }
  const ranked = [...byVendor.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, SERIES)

  const COLOURS = ["var(--bad)", "var(--ink-3)", "var(--signal)"]
  const build = (h: number, ticks: boolean): ChartSpec => ({
    type: "line",
    h,
    ticks,
    legend: ranked.length > 1,
    labels: weeks.map(D),
    series: ranked.map(([vendor, series], i) => ({
      name: vendor,
      color: COLOURS[i % COLOURS.length],
      // A week with no delivery from this vendor is a GAP. Carrying the last
      // price forward would draw a flat line through weeks nobody bought in
      // and make a two-delivery vendor look like a standing quote.
      data: weeks.map((w) => series.get(w) ?? null),
      fill: i === 0,
    })),
    alt: "Unit price by week and vendor",
  })

  const thin = ranked.filter(([, s]) => s.size < 2).map(([v]) => v)

  return {
    chart: build(158, true),
    phoneChart: build(112, false),
    meta:
      weeks.length === 0
        ? "no priced delivery in eight weeks"
        : `${plural(weeks.length, "week")} · ${plural(ranked.length, "vendor")}`,
    note:
      weeks.length === 0
        ? `No priced delivery in the last ${count(WEEKS)} weeks, so there is no history to ` +
          `draw. The price above, if there is one, is the newest invoice line older than that.`
        : thin.length === 0
        ? `Weekly medians, not single readings: one invoice priced against a different pack ` +
          `size reads as a price move that never happened.`
        : `${thin.join(", ")} ${thin.length === 1 ? "has" : "have"} a single delivery in the ` +
          `window, so ${thin.length === 1 ? "it is" : "they are"} a point rather than a trend — ` +
          `drawn as one, not joined into a line the data cannot support.`,
  }
}

/**
 * Matched SKUs, and the column the prototype invents.
 *
 * `P.ingredient`'s last column is `Confidence`, showing `Confirmed`,
 * `Confirmed`, `72%`. **`IngredientSkuMatch` has no confidence column** — a
 * row exists because a person confirmed it, and all 73 of this account's rows
 * are confirmed. A column reading "Confirmed" every time is not a column.
 *
 * What is worth a column is what the invoice actually said. Four distinct
 * `(vendor, sku)` pairs bill against a canonical named **73/27 Creekstone**,
 * and two of them are not that: one is the **halal** line, one is a Sysco
 * **75/25** chub. Both may be deliberate substitutions. Neither is announced
 * anywhere in the product, and both price into every recipe that uses this
 * ingredient — so the row prints the invoice's own product name and marks the
 * ones that disagree with the canonical.
 *
 * ## `Last seen`, and why a list of codes without one is half a list
 *
 * This table's job is to say what an owner is actually buying this ingredient
 * as. Every other column describes a code — its pack, its conversion, its last
 * price, how many lines carry it — and none of them said whether the code is
 * still one in use. A part number last billed fourteen months ago sat here
 * looking exactly like one on this week's invoice, with a "last price" beside
 * it that reads as a current quote.
 *
 * `MAX("Invoice"."invoiceDate")` per (vendor, SKU) is the whole answer, and it
 * was one aggregate away in the query this table was already built from.
 *
 * Undated lines are NOT stale. `Invoice.invoiceDate` is nullable, so a SKU
 * whose every line is undated folds to null — "we do not know when" is a
 * different finding from "not for six months", and it renders as an em dash
 * rather than being counted as the second.
 */
function skusOf(d: Loaded): IngredientSkus {
  const odd = d.skus.filter((s) => disagrees(s.product, d.name))
  const usedInCount = d.uses.length
  const isStale = (s: SkuRow) =>
    s.lastSeen !== null && daysBetween(s.lastSeen, d.asOf) > SKU_STALE_DAYS
  const stale = d.skus.filter(isStale)

  return {
    rows: d.skus.map((s) => ({
      key: `${s.vendor}:${s.sku ?? "none"}`,
      cells: {
        vendor: s.vendor,
        product: disagrees(s.product, d.name) ? { v: s.product, cls: "hot" } : s.product,
        pack:
          s.packSize === null && s.unitSize === null
            ? "—"
            : `${s.packSize ?? "?"} × ${s.unitSize === null ? "?" : s.unitSize.toFixed(2)} ${(s.unitSizeUom ?? "").toLowerCase()}`.trim(),
        conversion:
          s.conversion === null
            ? { v: "not learned", cls: "hot" }
            : s.fromUnit === s.toUnit
              ? `1 ${(s.fromUnit ?? "").toLowerCase()}`
              : `${s.conversion} ${(s.fromUnit ?? "").toLowerCase()} to ${(s.toUnit ?? "").toLowerCase()}`,
        price: s.lastPrice === null ? "—" : unitCost(s.lastPrice),
        seen:
          s.lastSeen === null
            ? "—"
            : isStale(s)
              ? { v: day(s.lastSeen, d.asOf), cls: "hot" }
              : day(s.lastSeen, d.asOf),
        lines: count(s.lines),
      },
    })),
    meta: `${count(d.skus.length)} · ${count(d.skus.filter((s) => s.confirmed).length)} learned`,
    note:
      (odd.length === 0
        ? `Every SKU billing against this ingredient names the same product it does.`
        : `${count(odd.length)} of these ${odd.length === 1 ? "bills" : "bill"} against this ` +
          `ingredient under a different product — ${odd.map((s) => s.product).join(", ")} — so ` +
          `${odd.length === 1 ? "its" : "their"} price is part of what this ingredient costs` +
          (usedInCount > 0
            ? `, and that cost feeds every recipe beside this table.`
            : `, though nothing on the menu costs against it.`) +
          ` That may be a deliberate substitution; nothing in the data says, and nothing else ` +
          `in the product mentions it.`) +
      (stale.length === 0
        ? ``
        : ` ${count(stale.length)} of these ${pluralWord(stale.length, "has", "have")} not been ` +
          `billed in six months, so the pack, the conversion and the last price beside ` +
          `${pluralWord(stale.length, "it", "them")} are the last ones seen rather than ` +
          `${pluralWord(stale.length, "a current quote", "current quotes")}.`),
  }
}

/**
 * Used in — and the column the prototype can only phrase as a loss.
 *
 * Its last column is `Cost of the rise`, and its narrative throughout is beef
 * getting more expensive. This ingredient's weekly medians ran $4.61 to $4.39
 * over eight weeks: it got **cheaper**. So the column is signed and named for
 * the move rather than the direction, and it reports about $3,400 that did not
 * have to be spent. A page that can only say "lost" cannot report the good
 * half of its own data.
 */
function usedInOf(d: Loaded): IngredientUsedIn {
  const perUnitMove =
    d.move !== null && d.costNow !== null && d.move !== -100
      ? d.costNow - d.costNow / (1 + d.move / 100)
      : null

  const impactOf = (u: UseRow): number | null => {
    if (perUnitMove === null || u.lineCost === null || d.costNow === null || d.costNow === 0) {
      return null
    }
    // The line's own quantity, expressed in the cost unit, is `lineCost /
    // costNow` — no second unit conversion, so this cannot disagree with the
    // walk that produced the line cost.
    return (u.lineCost / d.costNow) * perUnitMove * u.sold
  }

  const impacts = d.uses.map(impactOf).filter((v): v is number => v !== null)
  const total = impacts.reduce((t, v) => t + v, 0)

  const moveCell = (u: UseRow) => {
    const v = impactOf(u)
    if (v === null || Math.abs(v) < 1) return "—"
    return { v: `${v > 0 ? "+" : "−"}${money(Math.abs(v))}`, cls: v > 0 ? "hot" : "" }
  }

  return {
    rows: d.uses.map((u) => ({
      key: u.recipeId,
      href: `/dashboard/recipes/${u.recipeId}`,
      cells: {
        recipe: u.recipe,
        qty: `${u.quantity} ${u.unit.toLowerCase()}`,
        cost: u.lineCost === null ? { v: "—", cls: "hot" } : unitCost(u.lineCost),
        sold: u.sold === 0 ? { v: "none", cls: "hot" } : count(u.sold),
        move: moveCell(u),
      },
    })),
    phoneRows: d.uses.slice(0, PHONE_ROWS).map((u) => ({
      key: u.recipeId,
      href: `/dashboard/recipes/${u.recipeId}`,
      title: u.recipe,
      detail: `${u.quantity} ${u.unit.toLowerCase()} · ${u.sold === 0 ? "none sold" : `${count(u.sold)} sold`}`,
      value: u.lineCost === null ? "—" : unitCost(u.lineCost),
    })),
    meta:
      d.uses.length === 0
        ? "no recipe"
        : `${count(d.uses.length)} ${d.uses.length === 1 ? "recipe" : "recipes"}`,
    note:
      d.uses.length === 0
        ? `This ingredient is bought and reaches no plate. Nothing on the menu costs against ` +
          `it, so the ${money(d.spendRange)} above lands in no plate cost — it is one of the ` +
          `items the Ingredients page counts as bought into no recipe.`
        : Math.abs(total) < 1
          ? `The price has not moved enough over ${count(WEEKS)} weeks to change what these ` +
            `recipes cost.`
          : `${moveText(d.move)} over ${count(WEEKS)} weeks is about ` +
            `${money(Math.abs(total))} ${total > 0 ? "more than" : "less than"} these recipes ` +
            `would have cost at the older price, across what they sold in ${d.rangeLabel}. ` +
            `${total > 0 ? "Spent." : "Saved — the column is signed, because this one fell."}`,
  }
}

/**
 * WHEN IT LAST ARRIVED, AND HOW MUCH OF IT DID.
 *
 * The page could say what this ingredient costs and not when any of it turned
 * up. `InvoiceLineItem` joined to `Invoice` has carried both all along — the
 * date, the vendor, the quantity, the unit it was billed in and what the line
 * came to — and an owner standing in a walk-in asking "am I about to run out"
 * had a price chart and a list of part numbers instead.
 *
 * ## The total is honest about what it leaves out, because it has to be
 *
 * Invoices are written in cases and recipes are written in pounds and eaches.
 * `convertDelivered` (`@/lib/inventory/usage-math`) is the one function that
 * bridges the two, through the ingredient's own pack definition first and
 * dimensional conversion second, and it returns null when neither applies —
 * at which point `sumDeliveries` DROPS the line. That is not a rare edge: its
 * own docblock measures `recipeUnitsPerCase` as set on 61 of this account's 76
 * ingredients, so on the rest every case-billed arrival falls out of the sum.
 *
 * A dropped line makes the total an UNDER-count with no way to say by how
 * much, so the note names the count of them and says so outright, rather than
 * printing a figure that looks like a measurement of everything that arrived.
 *
 * The total comes from `sumDeliveries` — the same function the inventory walk
 * sums with, so this page and that one cannot disagree about what a case
 * converts to. The dropped COUNT is not something it returns (it reports
 * `partial` as a boolean), so the same lines are walked once more through the
 * same `convertDelivered` to count them; the two agree by construction,
 * because there is only one conversion.
 *
 * ## An ingredient with no recipe unit gets no total at all
 *
 * `recipeUnit` is nullable, and with it null nothing converts — the arithmetic
 * still produces 0, and 0 is a measurement. So that case claims nothing and
 * points at the form below, which is where a recipe unit is set.
 */
function deliveriesOf(d: Loaded): IngredientDeliveries {
  const unit = d.recipeUnit
  const lines = d.deliveries
  const converted = lines.map((l) =>
    unit === null ? null : convertDelivered(l.quantity, l.unit ?? unit, unit, d.pack),
  )
  const dropped = converted.filter((q) => q === null).length
  const total =
    unit === null
      ? null
      : sumDeliveries(
          lines.map((l) => ({ quantity: l.quantity, unit: l.unit })),
          unit,
          d.pack,
        ).deliveriesQty
  // A negative quantity is a credit, not an arrival. It is left on the list
  // and named, rather than filtered out: a reader who sees six lines here and
  // seven on the invoice list would have no way to find the difference.
  const credits = lines.filter((l) => l.quantity < 0).length
  const sinceLast = lines.length === 0 ? null : daysBetween(lines[0].date, d.asOf)
  // Nothing converted at all. The arithmetic still yields 0, and 0 here is the
  // em-dash case rather than a measurement — so this branch claims no total.
  const allDropped = lines.length > 0 && dropped === lines.length

  const qtyText = (i: number) =>
    converted[i] === null ? null : `${count(converted[i])} ${(unit ?? "").toLowerCase()}`
  const billed = (l: DeliveryLineRow) => `${count(l.quantity)} ${(l.unit ?? "").toLowerCase()}`.trim()

  return {
    rows: lines.map((l, i) => ({
      key: l.id,
      cells: {
        date: day(l.date, d.asOf),
        vendor: l.vendor,
        qty: billed(l),
        // `hot` on the ones that did not convert, because those are exactly
        // the lines the total below leaves out.
        recipeQty: qtyText(i) ?? { v: "—", cls: "hot" },
        value: money(l.value),
      },
    })),
    // The phone's value column is the CONVERTED quantity or an em dash — never
    // the line's dollar value as a substitute. A column that is a quantity on
    // two rows and a price on the third is not a column, and the em dash is
    // this system's word for "not there", which is exactly what a quantity
    // that would not convert is.
    phoneRows: lines.slice(0, PHONE_ROWS).map((l, i) => ({
      key: l.id,
      title: day(l.date, d.asOf),
      detail: `${l.vendor} · ${billed(l)}`,
      value: qtyText(i) ?? "—",
    })),
    unit,
    meta:
      sinceLast === null
        ? `never delivered`
        : `${
            // A future-dated invoice is a real thing an owner can be looking
            // at, and "−2 days ago" is not a sentence. It gets its date.
            sinceLast < 0
              ? `dated ${day(lines[0].date, d.asOf)}`
              : sinceLast === 0
                ? "delivered today"
                : sinceLast === 1
                  ? "delivered yesterday"
                  : `${plural(sinceLast, "day")} ago`
          } · ${plural(lines.length, "delivery", "deliveries")}`,
    note:
      lines.length === 0
        ? `No dated invoice line bills this ingredient, so there is no delivery history to ` +
          `show. An arrival reaches this list when an invoice carrying it is matched to this ` +
          `ingredient and carries a date.`
        : (unit === null
            ? `This ingredient has no recipe unit set, so nothing on this list can be added ` +
              `up: a case, a bag and a pound are three different quantities until the recipe ` +
              `unit says which one counts.`
            : allDropped
              ? `${plural(lines.length, "delivery", "deliveries")}. ` +
                `${pluralWord(lines.length, "It is not", "None of them is")} billed in a ` +
                `unit that converts to ${unit.toLowerCase()}, so there is no total under this ` +
                `list — ` +
                `only the lines themselves.`
              : `${plural(lines.length, "delivery", "deliveries")}, ${count(total)} ` +
                `${unit.toLowerCase()} in total` +
                (dropped === 0
                  ? `. Every line on the list converted to ${unit.toLowerCase()}.`
                  : `. ${count(dropped)} of these ${count(lines.length)} lines ` +
                    `${pluralWord(dropped, "is", "are")} billed in a unit that will not ` +
                    `convert to ${unit.toLowerCase()}, so ` +
                    `${pluralWord(dropped, "it is", "they are")} left out of that figure — ` +
                    `what actually arrived is understated by an unknown amount.`)) +
          (credits === 0
            ? ``
            : ` ${count(credits)} of these rows ` +
              `${pluralWord(credits, "carries", "carry")} a negative quantity: a credit, not ` +
              `an arrival.`),
  }
}

/**
 * The ingredient's name, for the masthead and the breadcrumb.
 *
 * Same reason as `getRecipeName`: a detail route needs its record's name
 * before the sections resolve, and awaiting the loader to get it would need
 * the `no-awaited-loader` exemption that names only the two order routes.
 */
export async function getIngredientName(
  ingredientId: string,
  accountId: string,
): Promise<{ name: string } | null> {
  const row = await prisma.canonicalIngredient.findFirst({
    where: { id: ingredientId, accountId },
    select: { name: true },
  })
  return row ? { name: titleCase(row.name) } : null
}

/* -- assembly --------------------------------------------------------- */

export function getIngredientSectionPromises(
  input: IngredientInput,
): StreamedSections<IngredientSections> {
  const dataP = classify(() => loadIngredient(input), {
    retryAction: "retryIngredient",
    isEmpty: (d) => d === null,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: Loaded) => T) =>
    guardSection(
      dataP.then((sd) => mapReady(sd, (d) => f(d as Loaded))),
      "retryIngredient",
    )

  return {
    head: s(headOf),
    prices: s(pricesOf),
    deliveries: s(deliveriesOf),
    skus: s(skusOf),
    usedIn: s(usedInOf),
    cost: s(costOf),
  }
}

/**
 * THE ONE FIGURE ON THIS PAGE THE OWNER CAN BE RIGHT ABOUT AND WE CAN BE WRONG.
 *
 * `costPerRecipeUnit` is derived from invoice lines, and the derivation reads
 * pack metadata that vendors write inconsistently. When it mis-parses, the
 * error is not small: a case price read as a unit price inflates $/unit by ten
 * to two hundred times, it propagates into every recipe that uses the
 * ingredient, and from there into COGS and the P&L. That failure is why
 * `selectNonSpikeCostIndex` exists, and it is why one week of this account
 * once read $193k.
 *
 * The guard suppresses the spike in the figures. It does not fix the stored
 * cost, and until now nothing could: the editorial ingredient sheet had this
 * form, the Counter rebuild dropped it, and the owner — the only person who
 * knows what a case of anything actually costs — had no way to say so.
 *
 * Three fields, because a wrong cost is wrong in three different ways:
 *
 *   - **the number** is misread from the invoice,
 *   - **the unit** is right on the invoice and wrong in the recipe (a good
 *     price per case stored as a price per ounce is the same disaster as a bad
 *     price, and is the more common of the two),
 *   - **the source** keeps winning: the next sync re-derives and overwrites
 *     the correction. `costLocked` is the answer to that, and it is on this
 *     panel rather than hidden in an admin screen because the owner who just
 *     typed the right number is the person who needs it.
 *
 * Writing any of this flags the row `costSource = "manual"`, which is
 * deliberate and visible: the note names the current source so nobody
 * overwrites an invoice-derived figure without knowing that is what they are
 * doing.
 */
function costOf(d: Loaded): IngredientCost {
  return {
    ingredientId: d.id,
    costNow: d.costNow,
    costSource: d.costSource,
    recipeUnit: d.recipeUnit,
    costLocked: d.costLocked,
    meta: d.costLocked ? "locked" : (d.costSource ?? "not set"),
    note:
      d.costSource === "manual"
        ? `This cost was typed, not derived. ${
            d.costLocked
              ? "It is locked, so invoice sync will not overwrite it."
              : "It is not locked, so the next invoice that prices this ingredient will replace it."
          }`
        : d.costNow === null
          ? `No cost is stored, so every recipe using this ingredient is costed as incomplete. ` +
            `A price here fixes all of them at once.`
          : `Derived from invoice lines. Correct it here when the pack size was misread — ` +
            `a case price stored as a unit price multiplies straight through into COGS. ` +
            `Lock it to stop the next sync from putting the bad figure back.`,
  }
}

export async function getIngredientSections(
  input: IngredientInput,
): Promise<IngredientSections> {
  return awaitSections(getIngredientSectionPromises(input))
}
