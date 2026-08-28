import { prisma } from "@/lib/prisma"
import { isNonIngredientRow } from "@/lib/invoice-charges"
import { splitReach, type ReachSplit } from "@/lib/counter/ingredient-reach"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { count, money, pct, titleCase, unitCost } from "@/lib/counter/format"
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
  spend30: number
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
  today: Date
}

async function loadIngredients(input: IngredientsInput): Promise<IngredientData> {
  const { accountId, storeId, today } = input

  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)

  const d30 = new Date(today)
  d30.setDate(d30.getDate() - 30)

  const [
    total,
    addedRecently,
    costedCount,
    lineCounts,
    catalogue,
    weekly,
    unmatched,
    modifiers,
    orphanRows,
    categories,
  ] = await Promise.all([
    prisma.canonicalIngredient.count({ where: { accountId } }),
    prisma.canonicalIngredient.count({ where: { accountId, createdAt: { gte: d30 } } }),
    prisma.canonicalIngredient.count({ where: { accountId, costPerRecipeUnit: { not: null } } }),
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
          COALESCE(SUM(l.ep) FILTER (WHERE l.d >= ${d30}), 0)::float AS spend30
        FROM l GROUP BY l.cid
      )
      SELECT ci.id, ci.name, ci.category, a.vendors,
             n.px::float AS last_price, n.u AS last_unit,
             (SELECT COUNT(*)::int FROM "RecipeIngredient" ri
               WHERE ri."canonicalIngredientId" = ci.id) AS recipes,
             a.spend30,
             (ci."costPerRecipeUnit" IS NOT NULL) AS costed
      FROM agg a
      JOIN "CanonicalIngredient" ci ON ci.id = a.cid
      LEFT JOIN newest n ON n.cid = a.cid
      ORDER BY a.spend30 DESC NULLS LAST`,
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
      Array<{ product: string; vendor: string; sku: string | null; n: number; spend: number }>
    >`
      SELECT li."productName" AS product, i."vendorName" AS vendor, li.sku AS sku,
             COUNT(*)::int AS n, SUM(li."extendedPrice")::float AS spend
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
          WHERE o."storeId" = ANY(${storeIds}) AND o."referenceTimeLocal" >= ${d30}
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
             COALESCE(SUM(li."extendedPrice") FILTER (WHERE i."invoiceDate" >= ${d30}), 0)::float AS spend30
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
    total,
    addedRecently,
    costedCount,
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
        deltaTone: d.addedRecently === 0 ? "is-down" : "is-flat",
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
 * The three are the biggest by 30-day spend that carry a reading in at least
 * half the weeks. A series drawn from two points is a straight line between
 * two invoices and reads as a trend.
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
    meta:
      picked.length === 0
        ? "no ingredient has enough readings"
        : `${count(picked.length)} biggest by spend · change from ${D(weeks[0])}`,
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
    meta: `${count(d.total)} items · ${count(shown.length)} by spend`,
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
    meta: `${count(d.modifiers.length)} modifiers · ${count(mapped)} mapped`,
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

  return { items, meta: `${count(items.length)} things to do` }
}

function pantryOf(d: IngredientData): IngredientPantry {
  // Groups where money is concentrated AND something is uncosted — the two
  // together, because an uncosted item in a $416 group is not worth a sentence.
  const gapped = d.categories
    .filter((c) => c.costed < c.items && c.spend30 > 0)
    .sort((a, b) => b.spend30 - a.spend30)
    .slice(0, 2)

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
    note: gapped.length === 0
      ? `Every group is fully costed.`
      : `${gapped.map((g) => g.name).join(" and ")} carry ` +
        `${money(gapped.reduce((t, g) => t + g.spend30, 0))} of the last thirty days between ` +
        `${gapped.length === 1 ? "it" : "them"} and ` +
        `${gapped.reduce((t, g) => t + (g.items - g.costed), 0)} of those items have no cost at ` +
        `all, so that spend reaches no plate.`,
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
    emptyReason: "no_match",
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
