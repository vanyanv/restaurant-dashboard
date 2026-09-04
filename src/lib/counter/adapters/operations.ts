import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { count, money, pct, plural } from "@/lib/counter/format"
import { rangeLabel, toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import {
  awaitSections,
  classify,
  guardSection,
  type StreamedSections,
} from "@/lib/counter/adapters/types"
import { mapReady, type SectionData } from "@/lib/counter/section-data"
import type { FigureProps, MListRow, QueueItem, Row } from "@/components/counter"

/**
 * Operations — `P.operations` (`docs/counter/counter-prototype.html`).
 *
 * "The hub both surfaces link to: what is open, and what each area is worth."
 *
 * A hub prints no figure of its own — every number on it is a count some other
 * page owns, and the whole risk of the page is drifting from them. So each
 * figure below names the page that owns it in a comment, and the definitions
 * are the same ones those pages use: `status = REVIEW` for invoices,
 * `canonicalIngredientId IS NULL` for unmatched lines, `isConfirmed = false`
 * for recipes.
 *
 * ## What the hub turned out to be about
 *
 * The prototype's areas are six equals with an open count each. Measured, they
 * are not equals: **two of the six have been touched this month and four
 * stopped in May.**
 *
 *   Invoices     last activity 27 Aug   live
 *   Ingredients  last activity 27 Aug   live
 *   Stock counts last activity 12 May   4 counts, 0 ever completed
 *   Recipes      last activity  3 May   34 unconfirmed
 *
 * That is the hub's actual answer to "what is open": a queue that never
 * emptied, on areas nobody has opened since spring. So `Last touched` is not a
 * decorative column here — it is the one that explains why the open counts are
 * what they are, and stale rows are marked.
 */

/** An area untouched for longer than this reads as stopped. */
const STALE_DAYS = 30
/** Rows on the phone's list — every area, because there are only six. */
const PHONE_ROWS = 6

export interface OperationsHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface OperationsWork {
  items: QueueItem[]
  meta: string
}

export interface OperationsAreas {
  rows: Row[]
  phoneRows: MListRow[]
  meta: string
  note: string
}

export interface OperationsSections {
  headline: SectionData<OperationsHeadline>
  work: SectionData<OperationsWork>
  areas: SectionData<OperationsAreas>
}

export interface OperationsInput {
  storeId: string | null
  accountId: string
  range: DateRange
  today: Date
}

/* -- loading ---------------------------------------------------------- */

interface Area {
  key: string
  name: string
  href: string
  /** What is open in it, already counted. */
  open: number
  /** The word for what `open` counts — "in review", "unconfirmed". */
  openUnit: string
  /** Money the area is responsible for over the range, or null when none. */
  worth: number | null
  lastTouched: Date | null
}

interface OperationsData {
  areas: Area[]
  countsTotal: number
  countsCompleted: number
  countsOpen: number
  countLines: number
  packagingSpend: number
  invoiceSpend: number
  rangeLabel: string
  today: Date
}

async function loadOperations(input: OperationsInput): Promise<OperationsData> {
  const { accountId, storeId, range, today } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  const storeIds = stores.map((s) => s.id)

  const [
    invoicesInReview,
    invoiceSpend,
    lastInvoice,
    unmatchedLines,
    ingredientSpend,
    lastIngredient,
    recipesUnconfirmed,
    lastRecipe,
    counts,
    countLines,
    packagingSpend,
    vendorNames,
  ] = await Promise.all([
    // Invoices page's own filter.
    prisma.invoice.count({ where: { accountId, status: "REVIEW" } }),
    prisma.invoice.aggregate({
      where: { accountId, invoiceDate: { gte: startDate, lte: endDate } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.findFirst({
      where: { accountId },
      select: { invoiceDate: true },
      orderBy: { invoiceDate: "desc" },
    }),
    // Ingredients page's own filter.
    prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
      WHERE i."accountId" = ${accountId} AND li."canonicalIngredientId" IS NULL`,
    prisma.$queryRaw<Array<{ spend: number }>>`
      SELECT COALESCE(SUM(li."extendedPrice"), 0)::float AS spend
      FROM "InvoiceLineItem" li JOIN "Invoice" i ON i.id = li."invoiceId"
      WHERE i."accountId" = ${accountId}
        AND i."invoiceDate" >= ${startDate} AND i."invoiceDate" <= ${endDate}`,
    prisma.canonicalIngredient.findFirst({
      where: { accountId },
      select: { updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    // Recipes page's own filter.
    prisma.recipe.count({ where: { accountId, isConfirmed: false } }),
    prisma.recipe.findFirst({
      where: { accountId },
      select: { updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    storeIds.length === 0
      ? Promise.resolve([])
      : prisma.stockCount.findMany({
          where: { storeId: { in: storeIds } },
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        }),
    storeIds.length === 0
      ? Promise.resolve(0)
      : prisma.stockCountLine.count({ where: { stockCount: { storeId: { in: storeIds } } } }),
    // Packaging is NOT its own model — no table matches `%packag%`. It is the
    // Paper/Supplies and Cleaning categories of the ingredient catalogue, which
    // is the same definition `ingredient-reach.ts` treats as "not food".
    prisma.$queryRaw<Array<{ spend: number }>>`
      SELECT COALESCE(SUM(li."extendedPrice"), 0)::float AS spend
      FROM "InvoiceLineItem" li
      JOIN "Invoice" i ON i.id = li."invoiceId"
      JOIN "CanonicalIngredient" ci ON ci.id = li."canonicalIngredientId"
      WHERE i."accountId" = ${accountId}
        AND ci.category IN ('Paper/Supplies', 'Cleaning')
        AND i."invoiceDate" >= ${startDate} AND i."invoiceDate" <= ${endDate}`,
    prisma.invoice.findMany({
      where: { accountId },
      select: { vendorName: true },
      distinct: ["vendorName"],
    }),
  ])

  // Folded, the way the Vendors page folds them — ten spellings, six
  // suppliers. An unfolded count would say ten and disagree with that page.
  const vendorCount = new Set(vendorNames.map((v) => normalizeVendorName(v.vendorName))).size

  const countsOpen = counts.filter((c) => c.status === "IN_PROGRESS").length
  const countsCompleted = counts.filter((c) => c.status === "COMPLETED").length

  const areas: Area[] = [
    {
      key: "invoices",
      name: "Invoices",
      href: "/dashboard/invoices",
      open: invoicesInReview,
      openUnit: "in review",
      worth: invoiceSpend._sum.totalAmount ?? 0,
      lastTouched: lastInvoice?.invoiceDate ?? null,
    },
    {
      key: "ingredients",
      name: "Ingredients",
      href: "/dashboard/ingredients",
      open: unmatchedLines[0]?.n ?? 0,
      openUnit: "lines unmatched",
      worth: ingredientSpend[0]?.spend ?? 0,
      lastTouched: lastIngredient?.updatedAt ?? null,
    },
    {
      key: "recipes",
      name: "Recipes",
      href: "/dashboard/recipes",
      open: recipesUnconfirmed,
      openUnit: "unconfirmed",
      // A recipe is not worth money; it decides what money buys. An invented
      // figure here would be the only made-up number on the page.
      worth: null,
      lastTouched: lastRecipe?.updatedAt ?? null,
    },
    {
      key: "counts",
      name: "Stock counts",
      href: "/dashboard/operations/inventory/counts",
      open: countsOpen,
      openUnit: "in progress",
      worth: null,
      lastTouched: counts[0]?.createdAt ?? null,
    },
    {
      key: "inventory",
      name: "Inventory",
      href: "/dashboard/operations/inventory",
      open: countLines,
      openUnit: "lines counted, ever",
      worth: null,
      lastTouched: counts[0]?.createdAt ?? null,
    },
    {
      key: "vendors",
      name: "Vendors",
      href: "/dashboard/operations/vendors",
      open: 0,
      openUnit: `${vendorCount} suppliers`,
      // NOT the invoice spend again. Vendors and Invoices are the same money
      // seen from two ends — one row per supplier, one row per document — and
      // printing $181,417 twice in a column headed "Worth" invites a reader to
      // add them. The vendors page owns the per-supplier split; this row is a
      // door to it, not a second total.
      worth: null,
      lastTouched: lastInvoice?.invoiceDate ?? null,
    },
  ]

  return {
    areas,
    countsTotal: counts.length,
    countsCompleted,
    countsOpen,
    countLines,
    packagingSpend: packagingSpend[0]?.spend ?? 0,
    invoiceSpend: invoiceSpend._sum.totalAmount ?? 0,
    rangeLabel: rangeLabel(range, "custom"),
    today,
  }
}

/* -- helpers ---------------------------------------------------------- */

const D = (d: Date | null) =>
  d === null
    ? "never"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })

const daysSince = (d: Date | null, today: Date): number | null =>
  d === null ? null : Math.floor((today.getTime() - d.getTime()) / 86_400_000)

const isStale = (a: Area, today: Date): boolean => {
  const days = daysSince(a.lastTouched, today)
  return days === null || days > STALE_DAYS
}

/**
 * An area that has NEVER been touched, as opposed to one that stopped.
 *
 * `isStale` folds the two together, which is right for marking a row and wrong
 * for every sentence this page writes about it. Measured on 2026-09-04 against
 * an account with two pre-open stores and no invoice, no recipe and no count
 * ever recorded: the strip read "invoices, ingredients and 4 more stopped" and
 * the note under the table read "the open counts beside them stopped changing
 * when the areas did, so they are a backlog from spring rather than this
 * week's work." Nothing had stopped, there was no backlog, and there was no
 * spring — every one of those areas was at zero because nothing had ever
 * happened in it. The page had been given one account's history as a constant.
 *
 * The `Last touched` column already prints "never" for these. The prose has to
 * agree with the column beside it.
 */
const neverTouched = (a: Area): boolean => a.lastTouched === null

/* -- sections --------------------------------------------------------- */

/**
 * "recipes and stock counts" · "recipes, stock counts and inventory" ·
 * "recipes, stock counts and 2 more".
 *
 * The old form printed two names and then " and more" from three onwards, so
 * on this account — which has exactly three stale areas — a strip cell read
 * "recipes, stock counts and more" while the note under the table beside it
 * listed all three by name. "and more" is eight characters spent hiding one
 * word: "inventory" is shorter than the phrase concealing it.
 *
 * Past three it does abbreviate, but says HOW MANY, because "and more" does
 * not distinguish one from nine.
 */
function staleWords(names: string[]): string {
  if (names.length <= 2) return names.join(" and ")
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

/**
 * The strip, and the two cells the prototype cannot fill here.
 *
 * `On-hand value · $9,840 · 34 items` and `Theoretical vs actual · 7.6% over`
 * both need a stock count that finished. **This account has four counts and
 * none of them was ever completed** — two are `IN_PROGRESS` and two
 * `ABANDONED`, all four from May — so there is no on-hand value and no
 * theoretical-versus-actual to state. `2026-08-28-inventory.md` reached the
 * same wall from the other side.
 *
 * `Packaging per order · $0.42` is computable but not as its own thing:
 * packaging has no model, and no table in this schema matches `%packag%`. It
 * is the Paper/Supplies and Cleaning categories of the ingredient catalogue —
 * the same definition `ingredient-reach.ts` uses for "not food" — so the cell
 * reports that spend and says what it is drawn from.
 */
function headlineOf(d: OperationsData): OperationsHeadline {
  const open = d.areas.reduce((t, a) => t + a.open, 0)
  const stale = d.areas.filter((a) => isStale(a, d.today))
  const live = d.areas.length - stale.length

  const openCell: FigureProps = {
    label: "Open across operations",
    value: count(open),
    delta: `across ${count(d.areas.filter((a) => a.open > 0).length)} of ${count(d.areas.length)} areas`,
    deltaTone: open > 0 ? "is-down" : "is-flat",
  }
  // The verb has to match what actually happened. "Stopped" is a claim that
  // something once ran; on an area with no history at all it is false, and it
  // contradicts the "never" this page prints in that area's own Last touched
  // cell. Where the two are mixed, "not moving" is the one verb true of both.
  const never = stale.filter(neverTouched)
  const staleNames = staleWords(stale.map((a) => a.name.toLowerCase()))
  const staleCell: FigureProps = {
    label: "Areas still moving",
    value: `${count(live)} of ${count(d.areas.length)}`,
    delta:
      stale.length === 0
        ? `every area touched in ${count(STALE_DAYS)} days`
        : never.length === stale.length
          ? `${staleNames} never started`
          : never.length === 0
            ? `${staleNames} stopped`
            : `${staleNames} not moving`,
    deltaTone: stale.length > 0 ? "is-down" : "is-flat",
  }

  return {
    cells: [
      openCell,
      staleCell,
      {
        label: "Stock counts",
        value: count(d.countsTotal),
        // The whole inventory story in one delta: not "none started" but
        // "none finished", which is a different and worse thing.
        delta:
          d.countsTotal === 0
            ? "none ever started"
            : d.countsCompleted === 0
              ? `none ever completed · ${count(d.countLines)} lines in all`
              : `${count(d.countsCompleted)} completed`,
        deltaTone: d.countsCompleted === 0 ? "is-down" : "is-flat",
      },
      {
        label: "Packaging",
        value: money(d.packagingSpend),
        delta:
          d.invoiceSpend > 0
            ? `${pct((d.packagingSpend / d.invoiceSpend) * 100, { scaled: true })} of ${d.rangeLabel} spend`
            : d.rangeLabel,
        deltaTone: "is-flat",
      },
    ],
    phoneCells: [openCell, staleCell],
  }
}

/**
 * Needs you across operations — the same items the area pages lead with, not
 * a second opinion about them.
 *
 * The prototype's fourth item is "A count is in progress · Marisol is 12 of 34
 * lines in". Two counts ARE in progress here, and both have been since **12
 * May**. "In progress" after fifteen weeks is not progress, so the item says
 * what it is: started and left.
 */
function workOf(d: OperationsData): OperationsWork {
  const items: QueueItem[] = []
  const at = (key: string) => d.areas.find((a) => a.key === key)

  const invoices = at("invoices")
  if (invoices && invoices.open > 0) {
    items.push({
      key: "invoices",
      tone: "bad",
      lead: count(invoices.open),
      unit: "invoices",
      title: "Invoices waiting on review",
      body:
        `${count(invoices.open)} are in review and none of them has posted. Until they do, the ` +
        `food line is short by whatever they carry — and the reasons are on the invoices ` +
        `themselves rather than in a status.`,
      act: "Open invoices",
      href: "/dashboard/invoices",
    })
  }

  const recipes = at("recipes")
  if (recipes && recipes.open > 0) {
    items.push({
      key: "recipes",
      tone: "warn",
      lead: count(recipes.open),
      unit: "recipes",
      title: "Recipes nobody has confirmed",
      body:
        `${count(recipes.open)} recipes cost real plates and no one has checked the quantities. ` +
        `They feed COGS, the menu margins and the P&L food line, so confirming is whether those ` +
        `three are reading a number somebody stands behind.`,
      act: "Open recipes",
      href: "/dashboard/recipes",
    })
  }

  const ingredients = at("ingredients")
  if (ingredients && ingredients.open > 0) {
    items.push({
      key: "ingredients",
      tone: "warn",
      lead: count(ingredients.open),
      unit: "lines",
      title: "Invoice lines matching nothing",
      body:
        `${count(ingredients.open)} lines reach no ingredient, so their spend sits in an invoice ` +
        `total and in no plate cost. They are fewer products than lines — the catalogue page ` +
        `groups them by the vendor's own part number.`,
      act: "Open ingredients",
      href: "/dashboard/ingredients",
    })
  }

  if (d.countsTotal > 0 && d.countsCompleted === 0) {
    items.push({
      key: "counts",
      tone: "bad",
      lead: count(d.countsTotal),
      unit: "counts",
      title: "Counts started and left",
      body:
        `${count(d.countsTotal)} stock counts exist and not one was ever completed — ` +
        `${count(d.countsOpen)} still say in progress, the rest were abandoned, and the newest is ` +
        `from ${D(at("counts")?.lastTouched ?? null)}. That is why there is no on-hand value and ` +
        `no theoretical-versus-actual anywhere in this product.`,
      act: "Open stock counts",
      href: "/dashboard/operations/inventory/counts",
    })
  }

  return { items, meta: `${plural(items.length, "thing")} to do` }
}

/** The areas, and the column that explains the rest of the table. */
function areasOf(d: OperationsData): OperationsAreas {
  const stale = d.areas.filter((a) => isStale(a, d.today))

  return {
    rows: d.areas.map((a) => {
      const days = daysSince(a.lastTouched, d.today)
      return {
        key: a.key,
        href: a.href,
        cells: {
          area: a.name,
          open: a.open === 0 ? "—" : { v: count(a.open), cls: "hot" },
          what: a.openUnit,
          worth: a.worth === null ? "—" : money(a.worth),
          touched: isStale(a, d.today)
            ? { v: `${D(a.lastTouched)}${days === null ? "" : ` · ${count(days)}d`}`, cls: "hot" }
            : D(a.lastTouched),
        },
      }
    }),
    phoneRows: d.areas.slice(0, PHONE_ROWS).map((a) => ({
      key: a.key,
      href: a.href,
      title: a.name,
      detail: a.open === 0 ? a.openUnit : `${count(a.open)} ${a.openUnit}`,
      value: a.worth === null ? "—" : money(a.worth),
      // `D(null)` is "never", and "last never" is not English. An area with no
      // history says so; one that stopped says when.
      note: neverTouched(a) ? "never" : isStale(a, d.today) ? `last ${D(a.lastTouched)}` : "current",
      noteTone: isStale(a, d.today) ? "down" : "up",
    })),
    meta: `${count(d.areas.length)} areas · ${d.rangeLabel}`,
    note: areasNote(d, stale),
  }
}

/**
 * What the table says about itself, in the tense the data supports.
 *
 * Three states, because there are three: nothing has ever happened here, some
 * of it stopped, or all of it is current. The middle sentence used to be the
 * only one for the last two, and it carried "a backlog from spring" — a season
 * read off the account this page was built against and then printed for
 * everyone. An account with no invoice, no recipe and no count on record was
 * told its zeroes were a backlog, which is both false and the opposite of
 * reassuring: a queue you never joined is not work you are behind on.
 *
 * The closing clause about `Worth` is unconditional because it explains a
 * COLUMN, which is on the table in every one of the three states.
 */
function areasNote(d: OperationsData, stale: Area[]): string {
  const worth =
    `Worth is what the area is responsible for over ${d.rangeLabel}; a recipe and a count ` +
    `are not worth money and say so rather than showing a zero.`

  if (stale.length === 0) {
    return `Every area has been touched in the last ${count(STALE_DAYS)} days. ${worth}`
  }

  const names = stale.map((a) => a.name.toLowerCase()).join(", ")

  // Nothing to be behind on. The open counts are zero because there is nothing
  // to open, and saying so is the difference between a page that reads as a
  // backlog and one that reads as a beginning.
  if (stale.every(neverTouched)) {
    return (
      `Nothing has been recorded in ${stale.length === d.areas.length ? "any of these areas" : names} ` +
      `yet, so the counts beside them are zero rather than done. ${worth}`
    )
  }

  return (
    `${count(stale.length)} of ${count(d.areas.length)} areas have not been touched in ` +
    `${count(STALE_DAYS)} days — ${names}. That is not a tidy-up: the open counts beside them ` +
    `stopped changing when the areas did, so what is open there is old work rather than this ` +
    `week's. ${worth}`
  )
}

/* -- assembly --------------------------------------------------------- */

export function getOperationsSectionPromises(
  input: OperationsInput,
): StreamedSections<OperationsSections> {
  const dataP = classify(() => loadOperations(input), {
    retryAction: "retryOperations",
    isEmpty: (d) => d.areas.length === 0,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: OperationsData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryOperations")

  return {
    headline: s(headlineOf),
    work: s(workOf),
    areas: s(areasOf),
  }
}

export async function getOperationsSections(
  input: OperationsInput,
): Promise<OperationsSections> {
  return awaitSections(getOperationsSectionPromises(input))
}
