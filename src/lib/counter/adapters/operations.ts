import { prisma } from "@/lib/prisma"
import { normalizeVendorName } from "@/lib/vendor-normalize"
import { count, money, pct } from "@/lib/counter/format"
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

  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true },
  })
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

/* -- sections --------------------------------------------------------- */

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
  const staleCell: FigureProps = {
    label: "Areas still moving",
    value: `${count(live)} of ${count(d.areas.length)}`,
    delta:
      stale.length === 0
        ? `every area touched in ${count(STALE_DAYS)} days`
        : `${stale.map((a) => a.name.toLowerCase()).slice(0, 2).join(", ")}${stale.length > 2 ? " and more" : ""} stopped`,
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

  return { items, meta: `${count(items.length)} things to do` }
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
      note: isStale(a, d.today) ? `last ${D(a.lastTouched)}` : "current",
      noteTone: isStale(a, d.today) ? "down" : "up",
    })),
    meta: `${count(d.areas.length)} areas · ${d.rangeLabel}`,
    note:
      stale.length === 0
        ? `Every area has been touched in the last ${count(STALE_DAYS)} days.`
        : `${count(stale.length)} of ${count(d.areas.length)} areas have not been touched in ` +
          `${count(STALE_DAYS)} days — ${stale.map((a) => a.name.toLowerCase()).join(", ")}. ` +
          `That is not a tidy-up: the open counts beside them stopped changing when the areas ` +
          `did, so they are a backlog from spring rather than this week's work. Worth is what ` +
          `the area is responsible for over ${d.rangeLabel}; a recipe and a count are not worth ` +
          `money and say so rather than showing a zero.`,
  }
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
