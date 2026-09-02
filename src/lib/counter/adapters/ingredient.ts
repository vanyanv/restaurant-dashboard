import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { count, money, pct, titleCase, unitCost } from "@/lib/counter/format"
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
 */

/** Weeks of price history the chart draws. */
const WEEKS = 8
/** Series before the rest is dropped — one per vendor, biggest first. */
const SERIES = 3
/** Rows on the phone's list. */
const PHONE_ROWS = 3
/** A move smaller than this reads "flat". */
const FLAT_PCT = 2

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
    },
  })
  if (!ing) return null

  const stores = await getScopedStores(accountId, storeId ?? null)
  const storeIds = stores.map((s) => s.id)

  const [lines, weekly, skuMatches, recipeUses, costs, onHand, allCounts, spend] =
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
        }>
      >`
        SELECT i."vendorName" AS vendor, li.sku AS sku,
               (ARRAY_AGG(li."productName" ORDER BY i."invoiceDate" DESC))[1] AS product,
               COUNT(*)::int AS n,
               MAX(li."packSize")::int AS pack, MAX(li."unitSize")::float AS unit_size,
               MAX(li."unitSizeUom") AS uom,
               (ARRAY_AGG(li."unitPrice" ORDER BY i."invoiceDate" DESC))[1]::float AS last_px,
               MAX(li.unit) AS line_unit
        FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
        WHERE li."canonicalIngredientId" = ${ingredientId} AND i."accountId" = ${accountId}
        GROUP BY 1, 2 ORDER BY 4 DESC`,
      prisma.$queryRaw<Array<{ wk: Date; vendor: string; px: number }>>`
        SELECT DATE_TRUNC('week', i."invoiceDate")::date AS wk, i."vendorName" AS vendor,
               (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY li."unitPrice"))::float AS px
        FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
        WHERE li."canonicalIngredientId" = ${ingredientId} AND i."accountId" = ${accountId}
          AND li."unitPrice" > 0
          AND i."invoiceDate" >= DATE_TRUNC('week', ${today}::date) - MAKE_INTERVAL(weeks => ${WEEKS - 1})
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
      prisma.stockCountLine.count(),
      prisma.$queryRaw<Array<{ mine: number; all: number }>>`
        SELECT COALESCE(SUM(li."extendedPrice") FILTER (
                 WHERE li."canonicalIngredientId" = ${ingredientId}), 0)::float AS mine,
               COALESCE(SUM(li."extendedPrice"), 0)::float AS all
        FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
        WHERE i."accountId" = ${accountId}
          AND i."invoiceDate" >= ${startDate} AND i."invoiceDate" <= ${endDate}`,
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
          : `never counted · ${count(d.accountCountLines)} lines in the account`
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
        : `${count(weeks.length)} weeks · ${count(ranked.length)} ${ranked.length === 1 ? "vendor" : "vendors"}`,
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
 */
function skusOf(d: Loaded): IngredientSkus {
  const odd = d.skus.filter((s) => disagrees(s.product, d.name))
  const usedInCount = d.uses.length

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
        lines: count(s.lines),
      },
    })),
    meta: `${count(d.skus.length)} · ${count(d.skus.filter((s) => s.confirmed).length)} learned`,
    note:
      odd.length === 0
        ? `Every SKU billing against this ingredient names the same product it does.`
        : `${count(odd.length)} of these ${odd.length === 1 ? "bills" : "bill"} against this ` +
          `ingredient under a different product — ${odd.map((s) => s.product).join(", ")} — so ` +
          `${odd.length === 1 ? "its" : "their"} price is part of what this ingredient costs` +
          (usedInCount > 0
            ? `, and that cost feeds every recipe beside this table.`
            : `, though nothing on the menu costs against it.`) +
          ` That may be a deliberate substitution; nothing in the data says, and nothing else ` +
          `in the product mentions it.`,
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
