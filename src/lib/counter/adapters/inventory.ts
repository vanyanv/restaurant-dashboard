import { prisma } from "@/lib/prisma"
import { count, money, titleCase, unitCost } from "@/lib/counter/format"
import type { ChartSpec } from "@/lib/counter/chart-geometry"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { CostBand, FigureProps, MoneyLine, Row } from "@/components/counter"

/**
 * Inventory — `P.inventory`
 * (`docs/counter/counter-prototype.html:5730`).
 *
 * "On the desk it is a table; on the phone it is a keypad, one item at a time."
 *
 * ## This is the first page whose prototype asks for data that does not exist
 *
 * Not "a smaller gap than the fixture's" — none. There is **no par level in
 * the schema**, no shrink or waste table, **zero `InventoryAdjustment` rows**
 * and **zero `IngredientModelState` rows**, and `StockCount.status` has never
 * been `COMPLETED`: four attempts, all in May, the fullest of them ten lines of
 * soda syrup. `docs/counter/measurements/2026-08-28-inventory.md` has the
 * table of what each of the prototype's figures asks for against what is
 * behind it.
 *
 * ## So this page states no on-hand quantity, anywhere
 *
 * `computeRunningOnHand` anchors on the most recent COMPLETED count. With none
 * it integrates from the first invoice — 225 days. The commit before this one
 * fixed a defect underneath that (every case-priced delivery was being dropped,
 * taking Σ(cost × onHand) from −$372,975 to +$166,279), but the drift is
 * structural and survives it: Coke still reads −590,000 ml. Printing that, or
 * a dollar value derived from it, would be the same defect one layer up.
 *
 * What the page states instead is what is true: what has never happened, what
 * is tracked, how long the window has been open, and what went into it
 * unchecked. Every section keeps the prototype's shape and changes its subject,
 * and each one says on the page why.
 */

export interface InventoryHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface InventoryRoster {
  rows: Row[]
  meta: string
  note: string
}

export interface InventoryAction {
  label: string
  href: string
  primary?: boolean
  /**
   * `.btn--quiet` — the prototype's borderless secondary. Its second button in
   * "Coverage health" is one, and the fidelity gate reads the difference:
   * transparent ground, lighter weight, `--ink-2` rather than `--ink`.
   */
  quiet?: boolean
}

export interface InventoryReadiness {
  bands: CostBand[]
  meta: string
  note: string
  actions: InventoryAction[]
}

export interface InventoryDelivered {
  chart: ChartSpec
  meta: string
}

export interface InventoryNextCount {
  meta: string
  lead: string
  /** The phone's `.mhead` — the state of the count, in three lines. */
  head: { label: string; value: string; delta: string; note: string }
  actions: InventoryAction[]
}

export interface InventorySettle {
  money: MoneyLine[]
  meta: string
  callout: string
  actions: InventoryAction[]
}

export interface InventorySections {
  headline: SectionData<InventoryHeadline>
  roster: SectionData<InventoryRoster>
  readiness: SectionData<InventoryReadiness>
  delivered: SectionData<InventoryDelivered>
  nextCount: SectionData<InventoryNextCount>
  settle: SectionData<InventorySettle>
}

export interface InventoryInput {
  storeId: string | null
  accountId: string
  today: Date
}

/** Rows drawn before the roster stops. The meta says what was left out. */
const ROSTER_ROWS = 24
/** Weeks on the delivered chart — the prototype's own eight. */
const WEEKS = 8

/* -- loading ---------------------------------------------------------- */

interface Ing {
  id: string
  name: string
  category: string | null
  recipeUnit: string | null
  costPerRecipeUnit: number | null
  caseUnit: string | null
  recipeUnitsPerCase: number | null
  innerPackUnit: string | null
  innerPacksPerCase: number | null
  /** When this ingredient was last written down by a person. */
  lastCountedAt: Date | null
}

interface Attempt {
  countedAt: Date
  status: string
  lines: number
  by: string
}

interface InventoryData {
  ingredients: Ing[]
  attempts: Attempt[]
  /** The most recent COMPLETED count, or null — and it is null. */
  anchoredAt: Date | null
  /** The first invoice, which is where an unanchored window starts. */
  windowFrom: Date | null
  today: Date
  /**
   * The two halves of what a count would settle, both in DIRECTLY MEASURED
   * dollars over the same window:
   *
   *   `delivered` — Σ `InvoiceLineItem.extendedPrice` for lines that carry a
   *   costed ingredient. Invoice dollars, the figure the Invoices page reads.
   *
   *   `used` — Σ `DailyCogsItem.lineCost`, the same figure COGS and the P&L
   *   read.
   *
   * NOT reconstructed as cost × quantity. That path multiplies
   * `costPerRecipeUnit` by a converted delivery, and the two are derived from
   * different pack readings on rows the sanity checker has already flagged for
   * pack shape — it came to $666,365 against $383,935 of invoices ever issued.
   * Two measured figures that other pages already agree on beat one
   * reconstruction of them.
   */
  delivered: number
  used: number
  /** Weekly $ of costed ingredient delivered, oldest first. */
  weekly: Array<{ week: Date; value: number }>
  storeName: string
}

async function loadInventory(input: InventoryInput): Promise<InventoryData> {
  const { accountId, storeId, today } = input

  const store = await prisma.store.findFirst({
    where: { accountId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })
  if (!store) {
    return {
      ingredients: [], attempts: [], anchoredAt: null, windowFrom: null, today,
      delivered: 0, used: 0, weekly: [], storeName: "No store",
    }
  }

  const [rawIngredients, counts, firstInvoice, weeklyRows, countLines] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      where: { accountId },
      select: {
        id: true, name: true, category: true, recipeUnit: true, costPerRecipeUnit: true,
        caseUnit: true, recipeUnitsPerCase: true, innerPackUnit: true, innerPacksPerCase: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.stockCount.findMany({
      where: { storeId: store.id },
      select: {
        countedAt: true, status: true,
        countedByUser: { select: { name: true, email: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { countedAt: "desc" },
      take: 12,
    }),
    prisma.invoice.findFirst({
      where: { accountId, storeId: store.id },
      select: { invoiceDate: true },
      orderBy: { invoiceDate: "asc" },
    }),
    prisma.$queryRaw<Array<{ w: Date; v: number }>>`
      SELECT DATE_TRUNC('week', i."invoiceDate")::date AS w,
             SUM(l."extendedPrice")::float AS v
      FROM "InvoiceLineItem" l JOIN "Invoice" i ON i.id = l."invoiceId"
      WHERE i."accountId" = ${accountId}
        AND i."storeId" = ${store.id}
        AND l."canonicalIngredientId" IS NOT NULL
        AND i."invoiceDate" >= DATE_TRUNC('week', ${today}::date) - MAKE_INTERVAL(weeks => ${WEEKS - 1})
      GROUP BY 1 ORDER BY 1`,
    // When each ingredient was last written down by a person. This is the ONLY
    // thing the page takes from the count tables, because it is the only thing
    // in them that is not derived from a quantity nobody has anchored.
    prisma.stockCountLine.findMany({
      where: { stockCount: { storeId: store.id } },
      select: {
        canonicalIngredientId: true,
        stockCount: { select: { countedAt: true } },
      },
      orderBy: { stockCount: { countedAt: "desc" } },
    }),
  ])

  const windowFrom = firstInvoice?.invoiceDate ?? null

  // The two settle figures, measured rather than reconstructed. Both are
  // scoped to the window and to this store, so they answer the same question.
  const [deliveredAgg, usedAgg] = await Promise.all([
    prisma.invoiceLineItem.aggregate({
      where: {
        canonicalIngredientId: { not: null },
        invoice: {
          accountId,
          storeId: store.id,
          ...(windowFrom ? { invoiceDate: { gte: windowFrom } } : {}),
        },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.dailyCogsItem.aggregate({
      where: {
        storeId: store.id,
        ...(windowFrom ? { date: { gte: windowFrom } } : {}),
      },
      _sum: { lineCost: true },
    }),
  ])

  // Ordered newest-first by the query, so the first write per ingredient wins.
  const lastCounted = new Map<string, Date>()
  for (const l of countLines) {
    if (!lastCounted.has(l.canonicalIngredientId)) {
      lastCounted.set(l.canonicalIngredientId, l.stockCount.countedAt)
    }
  }

  const ingredients: Ing[] = rawIngredients.map((i) => ({
    ...i,
    lastCountedAt: lastCounted.get(i.id) ?? null,
  }))

  return {
    ingredients,
    attempts: counts.map((c) => ({
      countedAt: c.countedAt,
      status: c.status,
      lines: c._count.lines,
      by: c.countedByUser.name ?? c.countedByUser.email ?? "someone",
    })),
    anchoredAt: counts.find((c) => c.status === "COMPLETED")?.countedAt ?? null,
    windowFrom,
    today,
    delivered: deliveredAgg._sum.extendedPrice ?? 0,
    used: usedAgg._sum.lineCost ?? 0,
    weekly: weeklyRows.map((r) => ({ week: r.w, value: r.v })),
    storeName: store.name,
  }
}

/* -- readiness -------------------------------------------------------- */

type Readiness = "ready" | "partial" | "none"

/**
 * Whether an ingredient can be counted at all.
 *
 * "Ready" needs three things and they are all needed for a different reason: a
 * recipe unit to write the number in, a cost to value it, and a pack so the
 * operator can count cases rather than each of nine thousand ketchup packets.
 */
function readinessOf(i: Ing): Readiness {
  const has = [
    i.recipeUnit !== null && i.recipeUnit !== "",
    i.costPerRecipeUnit !== null,
    i.recipeUnitsPerCase !== null,
  ].filter(Boolean).length
  if (has === 3) return "ready"
  if (has === 0) return "none"
  return "partial"
}

const READY_LABEL: Record<Readiness, string> = {
  ready: "Ready",
  partial: "Part-defined",
  none: "Not defined",
}

const D = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

const daysBetween = (a: Date, b: Date) =>
  Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000))

/* -- sections --------------------------------------------------------- */

function headlineOf(d: InventoryData): InventoryHeadline {
  const ready = d.ingredients.filter((i) => readinessOf(i) === "ready").length
  const openDays = d.windowFrom ? daysBetween(d.windowFrom, d.today) : null

  const lastCell: FigureProps = {
    label: "Last completed count",
    value: d.anchoredAt ? D(d.anchoredAt) : "Never",
    delta: d.anchoredAt
      ? `${count(daysBetween(d.anchoredAt, d.today))} days ago`
      : `${count(d.attempts.length)} attempts, none finished`,
    deltaTone: "is-down",
  }
  const unheldCell: FigureProps = {
    label: "Delivered, unchecked",
    value: money(d.delivered),
    delta: openDays === null ? "no deliveries yet" : `over ${count(openDays)} days`,
    deltaTone: "is-down",
  }

  return {
    cells: [
      lastCell,
      {
        label: "Ingredients tracked",
        value: count(d.ingredients.length),
        delta: `${count(ready)} ready to count`,
        deltaTone: "is-flat",
      },
      {
        label: "Window open since",
        value: d.windowFrom ? D(d.windowFrom) : "—",
        delta:
          openDays === null
            ? "nothing delivered"
            : `${count(openDays)} days with no anchor`,
        deltaTone: "is-down",
      },
      unheldCell,
    ],
    phoneCells: [lastCell, unheldCell],
  }
}

/**
 * The roster: what is KNOWN about each ingredient, not how much of it is on the
 * shelf.
 *
 * The prototype's columns are On hand / Par / Value / Variance / Status. Two of
 * those have no source at all — there is no par level in the schema — and the
 * other two derive from a quantity this page will not print. So the table
 * answers the question that is actually answerable and that has to be answered
 * before the prototype's can be: can this be counted, and if not, what is
 * missing.
 */
function rosterOf(d: InventoryData): InventoryRoster {
  const ranked = [...d.ingredients].sort((a, b) => {
    const order: Record<Readiness, number> = { none: 0, partial: 1, ready: 2 }
    const ra = order[readinessOf(a)]
    const rb = order[readinessOf(b)]
    if (ra !== rb) return ra - rb
    return a.name.localeCompare(b.name)
  })
  const shown = ranked.slice(0, ROSTER_ROWS)

  return {
    rows: shown.map((i) => {
      const r = readinessOf(i)
      return {
        key: i.id,
        href: `/dashboard/ingredients/${i.id}`,
        cells: {
          item: titleCase(i.name),
          unit: i.recipeUnit && i.recipeUnit !== "" ? i.recipeUnit : { v: "—", cls: "hot" },
          // `unitCost`, not `money`: bath tissue costs $0.0013 a case, and at
          // two decimals that prints "$0.00" beside a column of real prices.
          cost:
            i.costPerRecipeUnit === null
              ? { v: "—", cls: "hot" }
              : `${unitCost(i.costPerRecipeUnit)} / ${i.recipeUnit ?? "unit"}`,
          pack:
            i.recipeUnitsPerCase === null
              ? { v: "—", cls: "hot" }
              : `${count(i.recipeUnitsPerCase)} per ${(i.caseUnit ?? "case").toLowerCase()}`,
          counted: i.lastCountedAt ? D(i.lastCountedAt) : "never",
          ready: { v: READY_LABEL[r], cls: r === "ready" ? "" : "hot" },
        },
      }
    }),
    meta: `${count(shown.length)} of ${count(d.ingredients.length)} · least defined first`,
    note:
      `What is known about each ingredient, not how much of it is on the shelf. There is no ` +
      `par level in this schema and no completed count to measure a quantity from, so the ` +
      `prototype's On hand, Par and Variance columns have nothing behind them. These six do, ` +
      `and they are the ones that have to be filled in before the other three can exist.`,
  }
}

function readinessSection(d: InventoryData): InventoryReadiness {
  const by = (r: Readiness) => d.ingredients.filter((i) => readinessOf(i) === r)
  const ready = by("ready")
  const partial = by("partial")
  const none = by("none")

  return {
    bands: [
      { key: "ready", label: "Unit, cost and pack — countable today", value: `${count(ready.length)} items`, weight: ready.length, tone: "good" },
      { key: "partial", label: "Missing one of the three", value: `${count(partial.length)} items`, weight: partial.length, tone: "signal" },
      { key: "none", label: "Nothing defined", value: `${count(none.length)} items`, weight: none.length, tone: "bad" },
    ],
    meta: "what has to be true before a count is possible",
    // The prototype's bands measure a forecast model's accuracy per item.
    // There are zero `IngredientModelState` rows in this account, so that
    // model has never run and those three bands would all read zero. These
    // three measure the work that comes first.
    note:
      none.length === 0
        ? `Every ingredient carries a unit, a cost and a pack size.`
        : `The ${count(none.length)} with nothing defined are mostly not ingredients: the ` +
          `auto-matcher promoted invoice rows like "fuel surcharge" and a cancelled beef ` +
          `return into the pantry. Removing them is a smaller job than defining them.`,
    actions: [
      { label: "Define the missing ones", href: "/dashboard/ingredients" },
      { label: "Where the cost comes from", href: "/dashboard/invoices", quiet: true },
    ],
  }
}

function deliveredOf(d: InventoryData): InventoryDelivered {
  return {
    chart: {
      type: "bars",
      h: 138,
      zero: true,
      labels: d.weekly.map((w) => D(w.week)),
      series: [{ name: "Delivered", color: "var(--ink)", data: d.weekly.map((w) => w.value) }],
      alt: "Costed ingredient delivered per week",
    },
    // The prototype charts on-hand value over eight weeks. One point of that
    // series needs one completed count; there are none. This is the series that
    // exists, and it is the one a count is checked against.
    // Anchored on the WEEK boundary, not on today minus 56 days: trunc'ing an
    // arbitrary start date gave seven full weeks and a stub, so the first bar
    // was a fraction of a week drawn the same width as the rest, and the
    // section's own title said eight.
    meta:
      d.weekly.length === WEEKS
        ? "costed ingredient only"
        : `${count(d.weekly.length)} of ${count(WEEKS)} weeks had a delivery · costed ingredient only`,
  }
}

function nextCountOf(d: InventoryData): InventoryNextCount {
  const last = d.attempts[0]
  const abandoned = d.attempts.filter((a) => a.status !== "COMPLETED").length

  return {
    meta: last ? `last tried ${D(last.countedAt)}` : "never attempted",
    head: {
      label: "Counted so far",
      value: d.anchoredAt ? D(d.anchoredAt) : "Nothing",
      delta: last
        ? `${count(last.lines)} of ${count(d.ingredients.length)} written down, then stopped`
        : "no count has been started",
      note: last
        ? `Last tried ${D(last.countedAt)} · ${count(abandoned)} attempts, none finished`
        : `${count(d.ingredients.length)} ingredients waiting`,
    },
    lead:
      last === undefined
        ? `No count has ever been started. The keypad is built and works; nothing has walked it.`
        : `The last attempt was ${D(last.countedAt)}, ${count(daysBetween(last.countedAt, d.today))} days ` +
          `ago, and it stopped at ${count(last.lines)} ${last.lines === 1 ? "line" : "lines"} of ` +
          `${count(d.ingredients.length)}. All ${count(abandoned)} attempts ended the same way. ` +
          `Until one finishes, every on-hand figure in this product is an unanchored integral.`,
    actions: [
      { label: "Start the count", href: "/m/count", primary: true },
      { label: "The ingredients", href: "/dashboard/ingredients" },
    ],
  }
}

/**
 * What a count would settle.
 *
 * The prototype's slot holds an adjustment form and three money lines. There
 * are zero adjustments in this account, ever, so the form has nothing to sit
 * beside — but the three lines have real arithmetic behind them, and it is the
 * whole argument for counting: this much came in, this much should have gone
 * out, and the difference is what nobody has looked at.
 */
function settleOf(d: InventoryData): InventorySettle {
  const diff = d.delivered - d.used
  const share = d.delivered > 0 ? (diff / d.delivered) * 100 : null

  return {
    money: [
      { label: "Delivered, on the invoices", value: money(d.delivered, { cents: true }) },
      { label: "Used, by the recipes", value: money(-d.used, { cents: true }) },
      {
        label: "Never checked against a shelf",
        value: money(diff, { cents: true }),
        tone: "bad",
        total: true,
      },
    ],
    meta: d.windowFrom ? `since ${D(d.windowFrom)}` : "no window",
    // Both halves are measured, not derived from each other: the left is
    // invoice dollars (what Invoices reads) and the right is
    // `DailyCogsItem.lineCost` (what COGS and the P&L read). Their difference
    // is the only honest statement this page can make about stock.
    callout:
      `Every dollar on the left is on an invoice and every dollar on the right is in the ` +
      `recipes${share === null ? "" : ` — the gap is ${share.toFixed(1)}% of what came in`}. ` +
      `It is not shrink and it is not profit: it is standing stock, waste, theft and recipe ` +
      `error, added together, with nothing to tell them apart. A completed count separates ` +
      `them and anchors every figure after it.`,
    actions: [
      { label: "Start the count", href: "/m/count", primary: true },
      { label: "What came in", href: "/dashboard/invoices" },
    ],
  }
}

/* -- assembly --------------------------------------------------------- */

export function getInventorySectionPromises(
  input: InventoryInput,
): StreamedSections<InventorySections> {
  const dataP = classify(() => loadInventory(input), {
    retryAction: "retryInventory",
    isEmpty: (d) => d.ingredients.length === 0,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: InventoryData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryInventory")

  return {
    headline: s(headlineOf),
    roster: s(rosterOf),
    readiness: s(readinessSection),
    delivered: s(deliveredOf),
    nextCount: s(nextCountOf),
    settle: s(settleOf),
  }
}

export async function getInventorySections(input: InventoryInput): Promise<InventorySections> {
  return awaitSections(getInventorySectionPromises(input))
}
