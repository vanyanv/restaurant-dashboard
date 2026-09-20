import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { isNonIngredientRow } from "@/lib/invoice-charges"
import { splitReach, type ReachSplit } from "@/lib/counter/ingredient-reach"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { count, money, pct, plural, titleCase, unitCost } from "@/lib/counter/format"
import { rangeLabel, toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import { shortLabels } from "@/lib/counter/short-labels"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, QueueItem, Row } from "@/components/counter"

/**
 * Ingredients — `P.ingredients`
 * (`docs/counter/counter-prototype.html:5769`).
 *
 * "The catalogue, what each thing costs now, and what has not been matched
 * yet."
 *
 * Measured before it was written; the queries and the numbers are in
 * `docs/counter/measurements/2026-08-28-ingredients.md`. Three of that
 * document's findings changed what this file computes.
 *
 * ## The three windows
 *
 * This page draws a full `DateControl`, and for a long time nothing behind it
 * read the range: every window was a constant derived from `today`, so picking
 * a range pushed the URL, greyed the page and returned byte-identical numbers.
 * Note 19 — "a range that only changes the label is a lie" — and this was the
 * version that did not even change the label.
 *
 * What the control governs now is SPEND: the catalogue's spend column and the
 * order it sorts in, the pantry's spend by group, and the modifier volumes.
 * Those are the reader's window and they move with it.
 *
 * Two windows are deliberately NOT the control's, and each says so where it is
 * printed rather than borrowing the control's authority:
 *
 *   - **The price monitor is a fixed 8 weeks.** See `pricesOf`.
 *   - **The catalogue's move column is a fixed 30 days**, and its header says
 *     "30d move". It is read off the same weekly medians the monitor is drawn
 *     from (see `moveOf`), so it is bounded by that 8-week series; and the
 *     default range on every Counter page is a single day, which has no
 *     weekly median to compare against at all. A move column that emptied
 *     itself to "no prior" whenever somebody picked Yesterday would be worse
 *     than a fixed one, and dishonest on top of it.
 *
 * The catalogue's ROW SET is not range-bound either: it is every ingredient
 * that has ever been invoiced, so a quiet range empties the spend column
 * rather than the table.
 *
 * ## The catalogue is frozen, and that is the first cell
 *
 * All 76 canonical ingredients were created between 19 April and 3 May 2026, a
 * two-week burst four months ago, and **none in the 30 days since** — while 39
 * invoices arrived. The prototype's first cell reads "▲ 8 this month". Here
 * the truthful delta is that nothing has been added, which is not growth
 * slowing down: it is a pipeline that stopped.
 *
 * ## "Needs review" has nothing in it, and the real queue is elsewhere
 *
 * `RecipeMappingProposal` holds ten rows and every one is decided — three
 * accepted, seven rejected. There is no pending proposal to review. What IS
 * waiting is 24 unmatched invoice lines, and they are not 24 products. So
 * "Review inbox" shows clusters rather than lines, because the work is one
 * alias per cluster and not one decision per row.
 *
 * The clusters are keyed on the vendor's part number, not on the words —
 * `clusterKey` explains why, and it is a correction to what this page shipped
 * saying. Seven of the eight can-liner spellings are IFS part 30819; the
 * eighth is part 213232 and is a different liner.
 *
 * ## The biggest gap is not the unmatched lines, and it is not $36,589 either
 *
 * The 24 unmatched lines are worth $846. **43 of the 76 ingredients — 57% —
 * appear in no recipe at all, and they carry $36,589 of purchases.** Both
 * true, and the second figure is the wrong one to put in front of an owner:
 * $21,817 of it is foam containers, gloves and can liners, which are SUPPOSED
 * to be outside plate cost, and −$1,302 of it is a fuel surcharge and a credit
 * memo that are not ingredients at all.
 *
 * **What understates plate cost is $16,074 of food across 17 ingredients** —
 * fry shortening $4,456, mayonnaise $3,562, lemonade syrup $2,138. That is
 * still 19× the unmatched figure, it is still the section the prototype gives
 * to unmatched lines, and unlike $36,589 it is a list somebody can work
 * through. `src/lib/counter/ingredient-reach.ts` draws the line and both this
 * page and COGS read it from there.
 *
 * Two of those 17 are the same product twice — "sysco classic mayonnaise
 * banquet xhv duty" and "sys cls mayonnaise banquet xhv duty", "mustard
 * packets 5.5gr" and "mustard packets 5.5 g". The catalogue has the same
 * name-splitting problem as the invoice vendors and the menu's item names.
 */

/** Rows drawn before a table stops. */
const CATALOGUE_ROWS = 10
const MODIFIER_ROWS = 8
const INBOX_ROWS = 5
const PHONE_ROWS = 3
/** Series on the price monitor — the prototype's own three. */
const SERIES = 3
/** Weeks on it — the prototype's own eight. */
const WEEKS = 8
/** A price move smaller than this reads "flat". */
const FLAT_PCT = 2
/** Characters a legend name is cut to before its price is appended. */
const LEGEND_CHARS = 22

export interface IngredientHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface IngredientPrices {
  chart: ChartSpec
  phoneChart: ChartSpec
  meta: string
}

export interface IngredientCatalogue {
  rows: Row[]
  meta: string
}

export interface InboxCluster {
  key: string
  /**
   * One `InvoiceLineItem.id` per SPELLING in this cluster.
   *
   * `confirmSkuMatch` learns an alias from one line's (vendor, sku,
   * productName) and backfills every line that matches THAT spelling — so a
   * cluster of eight spellings of one can liner needs eight confirmations,
   * not one. Accepting the cluster runs them in order and reports what it
   * backfilled; that is the whole reason the inbox groups by product rather
   * than listing 24 lines.
   */
  lineIds: string[]
  /** The spelling that reads best — the longest one. */
  name: string
  /** "8 spellings · $493 · Individual FoodService". */
  sub: string
  /** How many spellings agree, as a share — the tag's number. */
  agreement: number
  tone: "good" | "warn" | "bad"
}

export interface IngredientInbox {
  clusters: InboxCluster[]
  meta: string
  note: string
  /**
   * Every canonical ingredient on the account, for the picker beside each
   * cluster. The whole catalogue rather than a suggestion: auto-match runs in
   * SHADOW mode and is right about 55% of the time on genuinely new products,
   * which is exactly why the prototype's section head says "nothing is
   * written until you decide" — a single suggested answer would be wrong
   * about half the time and would still look like the confident one.
   */
  candidates: Array<{ id: string; name: string }>
}

export interface IngredientModifiers {
  rows: Row[]
  meta: string
}

export interface IngredientWork {
  items: QueueItem[]
  meta: string
}

export interface IngredientPantry {
  rows: Row[]
  meta: string
  note: string
}

export interface IngredientMoving {
  rows: MListRow[]
  meta: string
}

export interface IngredientsSections {
  headline: SectionData<IngredientHeadline>
  prices: SectionData<IngredientPrices>
  catalogue: SectionData<IngredientCatalogue>
  inbox: SectionData<IngredientInbox>
  modifiers: SectionData<IngredientModifiers>
  work: SectionData<IngredientWork>
  pantry: SectionData<IngredientPantry>
  moving: SectionData<IngredientMoving>
}

export interface IngredientsInput {
  storeId: string | null
  accountId: string
  /** The reader's window — what the masthead's `DateControl` is set to. */
  range: DateRange
  today: Date
}

/* -- loading ---------------------------------------------------------- */

interface CatRow {
  id: string
  name: string
  category: string | null
  vendors: number
  lastPrice: number | null
  lastUnit: string | null
  /** Percent change against the newest reading at least 30 days older, same unit. */
  move: number | null
  recipes: number
  /**
   * Spend inside the READER'S range. Still called `spend30` because the name
   * is internal and renaming it reaches into four sections for nothing; every
   * string printed from it names the range it came from.
   */
  spend30: number
  /**
   * Spend over the price monitor's own fixed 8 weeks — what picks the three
   * series it draws. Not the reader's window, on purpose: the default range is
   * a single day, and letting one day choose which lines an 8-week chart draws
   * would make the chart flicker between ingredients for no reason a reader
   * could see.
   */
  spendChart: number
  costed: boolean
}

interface WeekPoint {
  id: string
  week: string
  price: number
}

interface UnmatchedRow {
  productName: string
  vendorName: string
  /** The vendor's own part number, when the extractor read one. */
  sku: string | null
  n: number
  spend: number
  /** One `InvoiceLineItem.id` from this spelling — what a match is confirmed against. */
  sampleLineId: string
}

interface ModRow {
  name: string
  sold: number
  price: number | null
  mapsTo: string | null
  cost: number | null
}

interface IngredientData {
  total: number
  addedRecently: number
  costedCount: number
  lines: number
  matched: number
  catalogue: CatRow[]
  weekly: WeekPoint[]
  unmatched: UnmatchedRow[]
  modifiers: ModRow[]
  orphans: ReachSplit
  categories: Array<{ name: string; items: number; costed: number; spend30: number }>
  /** The reader's window, written out — "Aug 20 – Sep 19". */
  rangeLabel: string
  today: Date
}

async function loadIngredients(input: IngredientsInput): Promise<IngredientData> {
  const { accountId, storeId, range, today } = input
  // The one place a Counter calendar day becomes a database bound — see
  // `toQueryBounds`. `endDate` is that day at 23:59:59, so an inclusive
  // comparison keeps the last day of the range instead of dropping it.
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  const storeIds = stores.map((s) => s.id)

  /*
   * A FIXED THIRTY DAYS, and the only two things still on it.
   *
   * `recent` below ("none added in 30 days" on the strip) asks whether the
   * catalogue pipeline has stopped, and `moveOf` asks how a price has moved.
   * Neither is a question the date control can ask — see the module docblock's
   * "The three windows" — and both print the words "30 days" where the reader
   * can see them.
   */
  const d30 = new Date(today)
  d30.setDate(d30.getDate() - 30)

  const [
    catalogueCounts,
    lineCounts,
    catalogue,
    weekly,
    unmatched,
    modifiers,
    orphanRows,
    categories,
  ] = await Promise.all([
    /*
     * THREE COUNTS OVER ONE TABLE, asked once.
     *
     * These were three `canonicalIngredient.count` calls differing only in a
     * predicate — the whole catalogue, the last thirty days, and the rows that
     * carry a cost — so they were three round trips scanning the same account's
     * rows three times. `FILTER` answers all three in one pass, and
     * `COUNT(col)` is already "rows where col is not null", which is exactly
     * what the third asked for.
     */
    prisma.$queryRaw<Array<{ total: number; recent: number; costed: number }>>`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "createdAt" >= ${d30})::int AS recent,
             COUNT("costPerRecipeUnit")::int AS costed
      FROM "CanonicalIngredient"
      WHERE "accountId" = ${accountId}`,
    prisma.$queryRaw<Array<{ lines: number; matched: number }>>`
      SELECT COUNT(*)::int AS lines,
             COUNT(l."canonicalIngredientId")::int AS matched
      FROM "InvoiceLineItem" l JOIN "Invoice" i ON i.id = l."invoiceId"
      WHERE i."accountId" = ${accountId}`,
    // `unitPrice` is a COLUMN, not extendedPrice/quantity: a derived unit price
    // over lines whose pack size changed mid-window reads as a price move that
    // never happened. Fries showed +31% that way and −13% on the printed one.
    //
    // The 30-day MOVE is not computed here at all — it comes from the same
    // weekly medians the price monitor is drawn from, so the chart and the
    // column cannot disagree. Two single readings 30 days apart put fries at
    // −40% where eight weekly medians put them at −13%, because "CS" covers
    // two different case sizes.
    prisma.$queryRaw<
      Array<{
        id: string
        name: string
        category: string | null
        vendors: number
        last_price: number | null
        last_unit: string | null
        recipes: number
        spend30: number | null
        spend_chart: number | null
        costed: boolean
      }>
    >`
      WITH l AS (
        SELECT li."canonicalIngredientId" AS cid, i."vendorName" AS vendor,
               i."invoiceDate" AS d, li."unitPrice" AS px, li.unit AS u,
               li."extendedPrice" AS ep
        FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
        WHERE i."accountId" = ${accountId} AND li."canonicalIngredientId" IS NOT NULL
          AND li."unitPrice" > 0
      ), newest AS (
        SELECT DISTINCT ON (cid) cid, px, u FROM l ORDER BY cid, d DESC
      ), agg AS (
        SELECT l.cid,
          COUNT(DISTINCT UPPER(REGEXP_REPLACE(l.vendor, '[^A-Za-z]', '', 'g')))::int AS vendors,
          -- The READER'S window, both ends. Not a 30-day offset from today:
          -- a range that ends in the past is a range somebody stepped back to,
          -- and an open upper bound would quietly hand them today's spend.
          COALESCE(SUM(l.ep) FILTER (WHERE l.d >= ${startDate} AND l.d <= ${endDate}), 0)::float
            AS spend30,
          -- The price monitor's own 8 weeks, written with the SAME expression
          -- the weekly query below uses, so the chart and the thing that picks
          -- its series cannot disagree about where 8 weeks starts.
          COALESCE(SUM(l.ep) FILTER (
            WHERE l.d >= DATE_TRUNC('week', ${today}::date) - MAKE_INTERVAL(weeks => ${WEEKS - 1})
          ), 0)::float AS spend_chart
        FROM l GROUP BY l.cid
      )
      SELECT ci.id, ci.name, ci.category, a.vendors,
             n.px::float AS last_price, n.u AS last_unit,
             (SELECT COUNT(*)::int FROM "RecipeIngredient" ri
               WHERE ri."canonicalIngredientId" = ci.id) AS recipes,
             a.spend30, a.spend_chart,
             (ci."costPerRecipeUnit" IS NOT NULL) AS costed
      FROM agg a
      JOIN "CanonicalIngredient" ci ON ci.id = a.cid
      LEFT JOIN newest n ON n.cid = a.cid
      -- Range spend first. The eight-week figure is the TIE-BREAK, because a
      -- quiet range (the default is one day) leaves most of this column at
      -- zero and a table ordered on a field of ties is a table in no order.
      ORDER BY a.spend30 DESC NULLS LAST, a.spend_chart DESC NULLS LAST`,
    prisma.$queryRaw<Array<{ id: string; wk: Date; px: number }>>`
      SELECT li."canonicalIngredientId" AS id,
             DATE_TRUNC('week', i."invoiceDate")::date AS wk,
             (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY li."unitPrice"))::float AS px
      FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
      WHERE i."accountId" = ${accountId} AND li."canonicalIngredientId" IS NOT NULL
        AND li."unitPrice" > 0
        AND i."invoiceDate" >= DATE_TRUNC('week', ${today}::date) - MAKE_INTERVAL(weeks => ${WEEKS - 1})
      GROUP BY 1, 2 ORDER BY 2`,
    prisma.$queryRaw<
      Array<{
        product: string
        vendor: string
        sku: string | null
        n: number
        spend: number
        sample: string
      }>
    >`
      SELECT li."productName" AS product, i."vendorName" AS vendor, li.sku AS sku,
             COUNT(*)::int AS n, SUM(li."extendedPrice")::float AS spend,
             -- ONE line id per group, so the inbox can act on the cluster.
             -- confirmSkuMatch takes a single lineItemId, reads its
             -- (vendor, sku, productName) and BACKFILLS every other line that
             -- matches, so one id per spelling is all a cluster needs; the
             -- newest is the one whose wording the alias should learn.
             (ARRAY_AGG(li.id ORDER BY i."invoiceDate" DESC NULLS LAST))[1] AS sample
      FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
      WHERE i."accountId" = ${accountId} AND li."canonicalIngredientId" IS NULL
      GROUP BY 1, 2, 3 ORDER BY 5 DESC`,
    storeIds.length === 0
      ? Promise.resolve([])
      : prisma.$queryRaw<
          Array<{ name: string; sold: number; price: number | null; maps_to: string | null }>
        >`
          SELECT s."name" AS name, SUM(s.quantity)::int AS sold,
                 AVG(NULLIF(s.price, 0))::float AS price,
                 MAX(r."itemName") AS maps_to
          FROM "OtterOrderSubItem" s
          JOIN "OtterOrderItem" oi ON oi.id = s."orderItemId"
          JOIN "OtterOrder" o ON o.id = oi."orderId"
          LEFT JOIN "OtterSubItemMapping" m
            ON m."otterSubItemName" = s."name" AND m."storeId" = o."storeId"
          LEFT JOIN "Recipe" r ON r.id = m."recipeId"
          WHERE o."storeId" = ANY(${storeIds})
            AND o."referenceTimeLocal" >= ${startDate}
            AND o."referenceTimeLocal" <= ${endDate}
          GROUP BY 1 ORDER BY 2 DESC LIMIT 40`,
    prisma.$queryRaw<
      Array<{ id: string; name: string; category: string | null; spend: number }>
    >`
      SELECT ci.id, ci.name, ci.category, COALESCE(SUM(li."extendedPrice"), 0)::float AS spend
      FROM "CanonicalIngredient" ci
      LEFT JOIN "InvoiceLineItem" li ON li."canonicalIngredientId" = ci.id
      WHERE ci."accountId" = ${accountId}
        AND NOT EXISTS (
          SELECT 1 FROM "RecipeIngredient" ri WHERE ri."canonicalIngredientId" = ci.id
        )
      GROUP BY ci.id ORDER BY 4 DESC`,
    prisma.$queryRaw<
      Array<{ category: string; items: number; costed: number; spend30: number }>
    >`
      SELECT COALESCE(ci.category, 'Uncategorised') AS category,
             COUNT(DISTINCT ci.id)::int AS items,
             COUNT(DISTINCT ci.id) FILTER (WHERE ci."costPerRecipeUnit" IS NOT NULL)::int AS costed,
             COALESCE(SUM(li."extendedPrice") FILTER (
               WHERE i."invoiceDate" >= ${startDate} AND i."invoiceDate" <= ${endDate}
             ), 0)::float AS spend30
      FROM "CanonicalIngredient" ci
      LEFT JOIN "InvoiceLineItem" li ON li."canonicalIngredientId" = ci.id
      LEFT JOIN "Invoice" i ON i.id = li."invoiceId"
      WHERE ci."accountId" = ${accountId}
      GROUP BY 1 ORDER BY 4 DESC, 2 DESC`,
  ])

  // The weekly medians, per ingredient, oldest first — the ONE series both the
  // chart and the catalogue's 30d column read.
  const series = new Map<string, Array<{ week: string; price: number }>>()
  for (const w of weekly) {
    const iso = w.wk.toISOString().slice(0, 10)
    series.set(w.id, [...(series.get(w.id) ?? []), { week: iso, price: w.px }])
  }
  for (const list of series.values()) list.sort((a, b) => a.week.localeCompare(b.week))

  const d30Iso = d30.toISOString().slice(0, 10)
  const moveOf = (id: string): number | null => {
    const list = series.get(id)
    if (!list || list.length < 2) return null
    const latest = list[list.length - 1]
    // The newest week that is still older than the 30-day mark. Falls back to
    // the oldest week we have, so an ingredient delivered only inside the last
    // month still reports the move it made.
    const before = [...list].reverse().find((p) => p.week < d30Iso) ?? list[0]
    if (before.week === latest.week || before.price === 0) return null
    return ((latest.price - before.price) / before.price) * 100
  }

  return {
    // `?? 0` on each: an account with no catalogue at all returns no ROW from
    // an aggregate with no GROUP BY only if the query fails, but the shape is
    // an array and reading `[0]` of an empty one is how the two counts below
    // have always been read.
    total: catalogueCounts[0]?.total ?? 0,
    addedRecently: catalogueCounts[0]?.recent ?? 0,
    costedCount: catalogueCounts[0]?.costed ?? 0,
    lines: lineCounts[0]?.lines ?? 0,
    matched: lineCounts[0]?.matched ?? 0,
    catalogue: catalogue.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      vendors: c.vendors,
      lastPrice: c.last_price,
      lastUnit: c.last_unit,
      move: moveOf(c.id),
      recipes: c.recipes,
      spend30: c.spend30 ?? 0,
      spendChart: c.spend_chart ?? 0,
      costed: c.costed,
    })),
    weekly: weekly.map((w) => ({
      id: w.id,
      week: w.wk.toISOString().slice(0, 10),
      price: w.px,
    })),
    unmatched: unmatched.map((u) => ({
      productName: u.product,
      vendorName: normalizeVendorName(u.vendor),
      sku: u.sku,
      n: u.n,
      spend: u.spend,
      sampleLineId: u.sample,
    })),
    modifiers: modifiers.map((m) => ({
      name: m.name,
      sold: m.sold,
      price: m.price,
      mapsTo: m.maps_to,
      cost: null,
    })),
    orphans: splitReach(orphanRows),
    categories: categories.map((c) => ({
      name: c.category,
      items: c.items,
      costed: c.costed,
      spend30: c.spend30,
    })),
    // "custom" forces the concrete dates rather than a preset name, the same
    // call `recipes.ts` makes and for the same reason: a sentence can carry
    // "over Aug 20 – Sep 19" and cannot carry "over Yesterday".
    rangeLabel: rangeLabel(range, "custom"),
    today,
  }
}

/* -- helpers ---------------------------------------------------------- */

const D = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

const moveText = (m: number | null) =>
  m === null ? "no prior" : Math.abs(m) < FLAT_PCT ? "flat" : `${m > 0 ? "▲" : "▼"} ${Math.abs(m).toFixed(0)}%`

/**
 * A key that collapses spellings of the same product.
 *
 * **The vendor's own part number when there is one**, and only the first two
 * words of the name when there is not.
 *
 * The name key came first and it was wrong in both directions. This account's
 * eight can-liner spellings — `CAN LINER 40X46 1.5MIL BLK CORELESS`, `Can
 * Liner Black Coreless`, `CAN LINER` and five more — are not eight products,
 * and grouping them on "CAN LINER" said so correctly. But it also swept in
 * `CAN LINER CLR`, which is IFS part **213232** where the other seven are IFS
 * **30819**: black coreless liners and clear liners, one word apart in the
 * name and a different product in the stockroom. The page told the owner one
 * alias would clear ten lines. One alias clears seven of them.
 *
 * That matters more than a miscount, because it reframes the work. Seven
 * spellings under one part number are not a naming problem at all — they are
 * one missing `IngredientSkuMatch` row for (Individual FoodService, 30819).
 * The vendor has been telling us which product it is on every line; nothing
 * was reading it.
 *
 * The name fallback stays for lines the extractor read no part number from,
 * where a guess from the words is the only thing on offer. It is deliberately
 * no cleverer than two words: this key decides what a HUMAN is shown, never
 * what gets written, so a cluster that is wrong costs a glance.
 */
function clusterKey(row: { productName: string; vendorName: string; sku: string | null }): string {
  const sku = row.sku?.trim()
  // Scoped by vendor: part numbers are a vendor's private namespace, and two
  // suppliers both numbering something 30819 is not a coincidence worth
  // merging on.
  if (sku) return `${row.vendorName.toUpperCase()}\u0000${sku.toUpperCase()}`
  return row.productName
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
}

/* -- sections --------------------------------------------------------- */

function headlineOf(d: IngredientData): IngredientHeadline {
  const rate = d.lines > 0 ? (d.matched / d.lines) * 100 : null
  const unmatchedLines = d.unmatched.reduce((t, u) => t + u.n, 0)
  const unmatchedSpend = d.unmatched.reduce((t, u) => t + u.spend, 0)

  // The FOOD, not the total. 43 items and $36,589 is the true headline of the
  // whole gap, and it is the wrong number for a cell that has one line to say
  // what it costs the reader: over half of it is foam containers and gloves,
  // which are supposed to be outside plate cost. What understates a plate is
  // the 17 food items and $16,074, and that is what this cell counts. The
  // queue item below states all three.
  const orphanCell: FigureProps = {
    label: "Food in no recipe",
    value: count(d.orphans.food.n),
    delta: `${money(d.orphans.food.spend)} bought`,
    deltaTone: "is-down",
  }
  const unmatchedCell: FigureProps = {
    label: "Unmatched",
    value: count(unmatchedLines),
    delta: `${money(unmatchedSpend)} of lines`,
    deltaTone: unmatchedLines > 0 ? "is-down" : "is-flat",
  }

  return {
    cells: [
      {
        label: "Canonical items",
        value: count(d.total),
        // The prototype's own delta is "▲ 8 this month". Nothing has been
        // added in thirty days, and saying so is the point of the cell.
        delta:
          d.addedRecently === 0
            ? "none added in 30 days"
            : `${d.addedRecently} added in 30 days`,
        /*
         * FLAT EITHER WAY — a catalogue that did not grow is not a fault.
         *
         * Nothing adds canonicals automatically: auto-create was dropped and
         * the shadow matcher only proposes against products that already
         * exist. So "none added in 30 days" is the state this product was
         * built to be in, and painting it red said a working system was
         * broken. It also spent the accent: three of this strip's four
         * captions carried the down tone, and the other two are real money —
         * $16,346 of food in no recipe, $875 of unmatched lines. DESIGN.md is
         * explicit that the accent marks state and not rest, and that more
         * than one at rest on a screen means something is wrong. Adding items
         * was already flat; not adding them is the same kind of fact.
         */
        deltaTone: "is-flat",
      },
      {
        label: "Auto-matched",
        value: rate === null ? "—" : pct(rate, { scaled: true }),
        delta: `of ${count(d.lines)} invoice lines`,
        deltaTone: "is-flat",
      },
      orphanCell,
      unmatchedCell,
    ],
    phoneCells: [orphanCell, unmatchedCell],
  }
}

/**
 * The price monitor, drawn as PERCENT CHANGE rather than dollars.
 *
 * The three biggest ingredients here cost $4.39 a pound, $118.71 a case and
 * $28.00 a case. On a shared dollar axis spanning $4 to $125, ground beef —
 * the single largest line in the account — is a flat rule along the bottom and
 * a 5% move in it is invisible. The prototype's fixture dodges this by picking
 * three items that all cost between $2 and $5.
 *
 * So every series is indexed to its own first reading and the axis is percent.
 * That is also the question the section asks: not which ingredient costs more
 * per case — the catalogue beside it answers that, in native units — but which
 * of them is MOVING.
 *
 * ## EIGHT WEEKS, FIXED, AND IT SAYS SO
 *
 * This section does NOT follow the date control, and the decision is
 * deliberate. The series are weekly medians (`loadIngredients`'s `weekly`
 * query), and a median is the whole reason the number is trustworthy: a
 * single reading either side of a window put fries at −40% where eight weekly
 * medians put them at −13%, because "CS" covers two case sizes. A weekly
 * median series needs weeks to mean anything, and the default range on a
 * Counter page is ONE DAY — which is no weeks at all. Following the control
 * would mean redrawing this chart with one point, or two, whenever anybody
 * touched it.
 *
 * The alternative to holding it fixed is not "a shorter chart", it is a chart
 * that lies faster. So it stays eight weeks and the `meta` under the section
 * head states that in words, rather than letting the control above it take
 * credit for a window it does not set.
 *
 * The three drawn are the biggest by spend OVER THOSE EIGHT WEEKS —
 * `spendChart`, not the reader's window — that carry a reading in at least
 * half the weeks. Picking them by the range would let a one-day window choose
 * which lines an eight-week chart draws. A series drawn from two points is a
 * straight line between two invoices and reads as a trend.
 */
function pricesOf(d: IngredientData): IngredientPrices {
  const byId = new Map<string, Map<string, number>>()
  for (const w of d.weekly) {
    const m = byId.get(w.id) ?? new Map<string, number>()
    m.set(w.week, w.price)
    byId.set(w.id, m)
  }

  const weeks = [...new Set(d.weekly.map((w) => w.week))].sort()
  const minWeeks = Math.max(2, Math.ceil(weeks.length / 2))

  const picked = d.catalogue
    .filter((c) => (byId.get(c.id)?.size ?? 0) >= minWeeks)
    // By the chart's own eight weeks, not by `d.catalogue`'s range-spend order.
    .sort((a, b) => b.spendChart - a.spendChart)
    .slice(0, SERIES)

  // `--bad`, `--signal`, `--ink-3` — the prototype's own three, in its order.
  const COLOURS = ["var(--bad)", "var(--signal)", "var(--ink-3)"]

  // The legend carries the native price, because the axis no longer does. Cut
  // by `shortLabels` so three names fit one row without a mid-word truncation.
  const names = shortLabels(
    picked.map((c) => titleCase(c.name)),
    LEGEND_CHARS,
  ).map((short, i) => {
    const c = picked[i]
    return c.lastPrice === null
      ? short
      : `${short} · ${unitCost(c.lastPrice)}${c.lastUnit ? `/${c.lastUnit.toLowerCase()}` : ""}`
  })

  const build = (h: number, ticks: boolean): ChartSpec => ({
    type: "line",
    h,
    ticks,
    legend: true,
    labels: weeks.map(D),
    series: picked.map((c, i) => {
      const readings = weeks.map((w) => byId.get(c.id)?.get(w) ?? null)
      const base = readings.find((v) => v !== null && v !== 0) ?? null
      return {
        name: names[i],
        color: COLOURS[i % COLOURS.length],
        // A week with no delivery is a gap, not a zero — the price did not
        // fall to nothing, nobody bought any. `null` is what `chartScale`
        // skips.
        data: readings.map((v) =>
          v === null || base === null ? null : ((v - base) / base) * 100,
        ),
      }
    }),
    alt: "Unit price change by week",
  })

  return {
    chart: build(158, true),
    phoneChart: build(116, false),
    // The window, stated. This chart is the one section on the page that does
    // not follow the control above it, so its meta says which weeks it is on
    // instead of leaving the reader to assume the range applies here too.
    meta:
      picked.length === 0
        ? `no ingredient has enough readings · a fixed ${WEEKS} weeks, not the date range`
        : `${count(picked.length)} biggest over a fixed ${WEEKS} weeks · ` +
          `change from ${D(weeks[0])} · not the date range`,
  }
}

function catalogueOf(d: IngredientData): IngredientCatalogue {
  const shown = d.catalogue.slice(0, CATALOGUE_ROWS)

  return {
    rows: shown.map((c) => ({
      key: c.id,
      href: `/dashboard/ingredients/${c.id}`,
      cells: {
        item: titleCase(c.name),
        vendors: count(c.vendors),
        price:
          c.lastPrice === null
            ? "—"
            : `${unitCost(c.lastPrice)}${c.lastUnit ? ` / ${c.lastUnit.toLowerCase()}` : ""}`,
        move:
          c.move !== null && Math.abs(c.move) >= FLAT_PCT
            ? { v: moveText(c.move), cls: "hot" }
            : moveText(c.move),
        recipes: c.recipes === 0 ? { v: "—", cls: "hot" } : count(c.recipes),
      },
    })),
    // Every ingredient ever invoiced is in the table; what the range governs
    // is the spend that ORDERS it. The ORDER BY falls back to the 8-week
    // `spend_chart` wherever the range's own spend ties — and on the default
    // one-day preset it ties at zero for nearly every row, so the visible
    // order is the 8-week one. Claiming "by spend over Sep 19" for twelve rows
    // that each spent nothing on Sep 19 would be false, so the meta says which
    // of the two it actually ranked on.
    meta:
      `${count(d.total)} items · ${count(shown.length)} by spend over ` +
      (shown.some((c) => c.spend30 > 0) ? d.rangeLabel : `the last 8 weeks`),
  }
}

function inboxOf(d: IngredientData): IngredientInbox {
  const groups = new Map<string, UnmatchedRow[]>()
  for (const u of d.unmatched) {
    const k = clusterKey(u)
    groups.set(k, [...(groups.get(k) ?? []), u])
  }

  const clusters: InboxCluster[] = [...groups.entries()]
    .map(([key, rows]) => {
      const spend = rows.reduce((t, r) => t + r.spend, 0)
      const lines = rows.reduce((t, r) => t + r.n, 0)
      const vendors = new Set(rows.map((r) => r.vendorName))
      const skus = new Set(rows.map((r) => r.sku?.trim()).filter(Boolean) as string[])
      // The longest spelling, because it is the one carrying the size and the
      // material — "CAN LINER" alone would name the cluster after its least
      // useful member.
      const name = rows.slice().sort((a, b) => b.productName.length - a.productName.length)[0]
        .productName
      return {
        key,
        lineIds: rows.map((r) => r.sampleLineId),
        name: titleCase(name.toLowerCase()),
        // The figure FIRST. In the prototype's own three-column split this
        // line ellipsises at about thirty characters, and the money is what
        // ranks the row — put it last and the reader sees "8 spellings · 10
        // lines …" and nothing that says whether it matters.
        // Money, then the PART NUMBER, then the counts. This line ellipsises
        // at about thirty characters in the prototype's three-column split,
        // so the order is the priority: the money ranks the row and the part
        // number is the thing the owner types into the alias. Both were below
        // the cut when the part number went last, which made adding it
        // pointless.
        sub:
          `${money(spend, { cents: true })} · ` +
          (skus.size === 1 ? `part ${[...skus][0]} · ` : "") +
          `${count(rows.length)} ${rows.length === 1 ? "spelling" : "spellings"} · ` +
          `${count(lines)} ${lines === 1 ? "line" : "lines"} · ` +
          [...vendors].join(", "),
        agreement: rows.length,
        // A cluster keyed on the vendor's own part number is certain, however
        // many spellings it has: the vendor said so. Only the name-keyed
        // fallback has to earn confidence from agreement between spellings.
        tone: (skus.size === 1
          ? "good"
          : rows.length >= 4
            ? "good"
            : rows.length >= 2
              ? "warn"
              : "bad") as InboxCluster["tone"],
        spend,
      }
    })
    .sort((a, b) => b.spend - a.spend)
    .map(({ spend: _spend, ...c }) => c)

  return {
    clusters: clusters.slice(0, INBOX_ROWS),
    // The catalogue is already loaded for the pantry table; the picker reads
    // the same list rather than a second query, so a name here and a name
    // there cannot disagree.
    candidates: d.catalogue
      .map((c) => ({ id: c.id, name: titleCase(c.name.toLowerCase()) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    meta: `${count(clusters.length)} products · ${count(d.unmatched.reduce((t, u) => t + u.n, 0))} lines`,
    // The prototype's inbox is a list of AI-proposed matches waiting on a
    // decision. Every one of this account's ten proposals is already decided,
    // so there is nothing pending to accept — what is actually waiting is
    // these, and they are clusters rather than lines because the work is one
    // alias per product, not one decision per row.
    note:
      `Grouped by the vendor's own part number where the line carries one, and by the first two ` +
      `words where it does not. Seven spellings of "can liner" are IFS part 30819 and collapse to ` +
      `one row; the eighth is part 213232, a clear liner rather than a black one, and stays its ` +
      `own row. ` +
      `Nothing here has been written: the auto-matcher runs in shadow mode and every proposal it ` +
      `has ever made — all ten — has already been decided by hand.`,
  }
}

function modifiersOf(d: IngredientData): IngredientModifiers {
  const shown = d.modifiers.slice(0, MODIFIER_ROWS)
  const mapped = d.modifiers.filter((m) => m.mapsTo !== null).length

  return {
    rows: shown.map((m) => ({
      key: m.name,
      cells: {
        modifier: m.name.trim() === m.name ? m.name : `"${m.name}"`,
        sold: count(m.sold),
        // A modifier with no price is FREE, not unpriced — every one of the
        // top six here is. Printing an em-dash would read as missing data.
        price: m.price === null ? "free" : money(m.price, { cents: true }),
        maps: m.mapsTo === null ? { v: "unmapped", cls: "hot" } : m.mapsTo,
        state: m.mapsTo === null ? { v: "no recipe", cls: "hot" } : "costed",
      },
    })),
    // These are the modifiers SOLD inside the reader's window, not every
    // modifier that exists, so the count is a claim about the range and says
    // which range it is.
    meta: `${count(d.modifiers.length)} modifiers over ${d.rangeLabel} · ${count(mapped)} mapped`,
  }
}

function workOf(d: IngredientData): IngredientWork {
  const biggest = [...d.unmatched].sort((a, b) => b.spend - a.spend)
  const clusters = new Set(d.unmatched.map((u) => clusterKey(u)))
  const items: QueueItem[] = [
    {
      key: "orphans",
      tone: "bad",
      lead: count(d.orphans.food.n),
      unit: "items",
      title: "Food bought, and in no recipe",
      // Three figures, because there are three and only one of them is work.
      // This section used to print $36,589 and the sentence "some of that is
      // genuinely not food" — true, and unactionable: it left the owner to
      // guess which share, and the honest answer turned out to be under half.
      body:
        `${money(d.orphans.food.spend)} of food sits against ingredients that appear in no recipe — ` +
        `${d.orphans.food.top.slice(0, 3).map((r) => titleCase(r.name)).join(", ")} lead it. ` +
        `Every plate cost in this product is understated by some part of that. ` +
        `A further ${money(d.orphans.supplies.spend)} across ${count(d.orphans.supplies.n)} items ` +
        `is packaging and cleaning, which belongs outside plate cost` +
        (d.orphans.artifacts.n > 0
          ? `, and ${count(d.orphans.artifacts.n)} more are not ingredients at all — a delivery ` +
            `surcharge and a credit memo the extractor filed into the catalogue.`
          : "."),
      act: "See what it cost",
      href: "/dashboard/cogs",
    },
    {
      key: "unmatched",
      tone: "warn",
      lead: count(clusters.size),
      unit: "products",
      title: "Unmatched invoice lines",
      body:
        `${count(d.unmatched.reduce((t, u) => t + u.n, 0))} lines worth ` +
        `${money(d.unmatched.reduce((t, u) => t + u.spend, 0))} match nothing in the catalogue, ` +
        `and they are ${count(clusters.size)} products, not ${count(d.unmatched.length)}. ` +
        (biggest[0] ? `The largest is "${biggest[0].productName}".` : ""),
      act: "Where they came from",
      href: "/dashboard/invoices",
    },
  ]

  return { items, meta: `${plural(items.length, "thing")} to do` }
}

function pantryOf(d: IngredientData): IngredientPantry {
  // Groups with something uncosted, ranked by the money in the reader's range.
  //
  // The `costed < c.items` test and the RANKING are deliberately separate, and
  // that separation is the fix for a bug this file shipped: the filter used to
  // be `costed < c.items && c.spend30 > 0`, which was safe only while
  // `spend30` was a fixed trailing 30 days. It is the reader's range now, and
  // the default preset on every Counter page is `yesterday` — so on any day a
  // restaurant took no delivery, EVERY group fell out of `gapped` and the note
  // printed "Every group is fully costed." directly beneath a table painting
  // its uncosted counts red. A window quietly changing what a sentence means
  // is the exact defect this range work exists to remove; it must not be
  // reintroduced by the ranking.
  //
  // So: what is uncosted is a fact about the catalogue and never about the
  // range. The range only decides which two are worth naming.
  const uncosted = d.categories.filter((c) => c.costed < c.items)
  const gapped = [...uncosted].sort((a, b) => b.spend30 - a.spend30).slice(0, 2)
  const gappedSpend = gapped.reduce((t, g) => t + g.spend30, 0)
  const gappedItems = gapped.reduce((t, g) => t + (g.items - g.costed), 0)

  return {
    rows: d.categories.map((c) => ({
      key: c.name,
      cells: {
        group: c.name,
        items: count(c.items),
        costed: c.costed === c.items ? count(c.costed) : { v: count(c.costed), cls: "hot" },
        spend: money(c.spend30),
      },
    })),
    meta: `${count(d.total)} canonical items · ${count(d.costedCount)} costed`,
    // The two groups holding the most money are the two smallest, and each has
    // half its items costed. It is not a rounding gap — it is the two largest
    // single ingredients in the account sitting beside an uncosted twin.
    note:
      gapped.length === 0
        ? `Every group is fully costed.`
        : gappedSpend > 0
          ? `${gapped.map((g) => g.name).join(" and ")} carry ` +
            `${money(gappedSpend)} of ${d.rangeLabel} between ` +
            `${gapped.length === 1 ? "it" : "them"} and ` +
            `${count(gappedItems)} of those items have no cost at all, so that spend reaches ` +
            `no plate.`
          : // Nothing bought in this window, which says nothing about whether
            // the items are costed. State the gap without dressing it in a
            // spend figure of zero.
            `${count(uncosted.length)} ${uncosted.length === 1 ? "group has" : "groups have"} ` +
            `items with no cost at all — ${gapped.map((g) => g.name).join(" and ")} ` +
            `${gapped.length === 1 ? "is" : "are"} the largest by spend. Nothing in ` +
            `${gapped.length === 1 ? "it" : "them"} was bought in ${d.rangeLabel}, so widen ` +
            `the range to see what the gap costs.`,
  }
}

function movingOf(d: IngredientData): IngredientMoving {
  const moved = d.catalogue
    .filter((c) => c.move !== null && Math.abs(c.move) >= FLAT_PCT)
    .sort((a, b) => Math.abs(b.move!) - Math.abs(a.move!))
    .slice(0, PHONE_ROWS)

  return {
    rows: moved.map((c) => ({
      key: c.id,
      href: `/dashboard/ingredients/${c.id}`,
      title: titleCase(c.name),
      detail:
        `${c.lastPrice === null ? "—" : unitCost(c.lastPrice)}` +
        `${c.lastUnit ? ` / ${c.lastUnit.toLowerCase()}` : ""} · ` +
        `${count(c.recipes)} ${c.recipes === 1 ? "recipe" : "recipes"}`,
      value: moveText(c.move),
      // A price RISE is the bad one — this is what the restaurant pays.
      noteTone: (c.move ?? 0) > 0 ? "down" : "up",
    })),
    // The same fixed thirty days the desk's "30d move" column is on — see the
    // module docblock. It is written out here because the phone has no control
    // at all, so the window has to come from somewhere.
    meta: "30 days",
  }
}

/* -- assembly --------------------------------------------------------- */

export function getIngredientsSectionPromises(
  input: IngredientsInput,
): StreamedSections<IngredientsSections> {
  const dataP = classify(() => loadIngredients(input), {
    retryAction: "retryIngredients",
    isEmpty: (d) => d.total === 0,
    /*
     * `no_ingredients`, not `no_match`.
     *
     * `d.total` is `COUNT(*) FROM "CanonicalIngredient" WHERE "accountId" = …`
     * — see `loadIngredients`. It takes neither the range nor the store scope,
     * so no control this page draws can change it, and `no_match`'s "Widen
     * either to see figures" was advice that could be followed to the letter
     * and leave all seven panels reading the same sentence.
     */
    emptyReason: "no_ingredients",
  })

  const s = <T,>(f: (d: IngredientData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryIngredients")

  return {
    headline: s(headlineOf),
    prices: s(pricesOf),
    catalogue: s(catalogueOf),
    inbox: s(inboxOf),
    modifiers: s(modifiersOf),
    work: s(workOf),
    pantry: s(pantryOf),
    moving: s(movingOf),
  }
}

export async function getIngredientsSections(
  input: IngredientsInput,
): Promise<IngredientsSections> {
  return awaitSections(getIngredientsSectionPromises(input))
}
