import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { count, money, pct, plural, unitCost } from "@/lib/counter/format"
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
 * Recipes — `P.recipes` (`docs/counter/counter-prototype.html:6107`).
 *
 * "Every recipe carries a yield, a cost per serving and a confirmation state."
 *
 * Measured before it was written; the queries and the numbers are in
 * `docs/counter/measurements/2026-08-28-recipes.md`. **Four of the prototype's
 * landmarks have no data behind them on this account**, and the two things
 * that are actually wrong with these recipes are not among the things it looks
 * for. Each departure is restated at the function that makes it.
 *
 * ## The two windows
 *
 * A recipe's COST is current — it is whatever its ingredients cost on the
 * latest invoice — and its confirmation state has no date at all. Neither is a
 * question the date control can ask. What the control does govern is the
 * PRICE side: what a plate sold for and how many went out, which is why the
 * catalogue's `Sells at`, `Margin` and the unconfirmed-revenue cell move with
 * the range and nothing else on the page does.
 *
 * That split is the Invoices page's, for the same reason: a worklist that
 * emptied itself at every date change would be a worklist you could not work.
 */

/** Rows the catalogue prints before it stops. */
const CATALOGUE_ROWS = 10
/** Component recipes shown. */
const COMPONENT_ROWS = 6
/** Rows on the phone's list. */
const PHONE_ROWS = 4
/** A recipe costing less than this per serving is treated as costing nothing. */
const ZERO_COST = 0.005

export interface RecipeHeadline {
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface RecipeCatalogue {
  rows: Row[]
  meta: string
  note: string
}

export interface RecipeWork {
  items: QueueItem[]
  meta: string
}

export interface RecipeComponents {
  rows: Row[]
  meta: string
  note: string
}

export interface RecipeRecent {
  rows: MListRow[]
  meta: string
}

export interface RecipesSections {
  headline: SectionData<RecipeHeadline>
  catalogue: SectionData<RecipeCatalogue>
  work: SectionData<RecipeWork>
  components: SectionData<RecipeComponents>
  recent: SectionData<RecipeRecent>
}

export interface RecipesInput {
  storeId: string | null
  accountId: string
  range: DateRange
  today: Date
}

/* -- loading ---------------------------------------------------------- */

interface RecipeRow {
  id: string
  name: string
  category: string
  sellable: boolean
  confirmed: boolean
  /** Lines on the recipe itself, component lines included. */
  lines: number
  /** How many OTHER recipes use this one as a component. */
  usedIn: number
  /** Cost per serving, from the batched walk. Null when it could not cost. */
  cost: number | null
  /** At least one line could not be priced. */
  partial: boolean
  /** No line produced any cost — see `RecipeCostResult.emptyWalk`. */
  emptyWalk: boolean
  /** Mean observed POS price in the range. Null when nothing sold. */
  price: number | null
  soldQty: number
  revenue: number
  /** Days in `DailyCogsItem` the cost walk flagged as an understatement. */
  partialDays: number
}

interface RecipeData {
  rows: RecipeRow[]
  addedRecently: number
  rangeLabel: string
  today: Date
}

async function loadRecipes(input: RecipesInput): Promise<RecipeData> {
  const { accountId, storeId, range, today } = input
  const { startDate, endDate } = toQueryBounds(range)

  const stores = await getScopedStores(accountId, storeId ?? null)
  const storeIds = stores.map((s) => s.id)

  const d30 = new Date(today)
  d30.setDate(d30.getDate() - 30)

  const [recipes, costs, addedRecently, sold, partialDays] = await Promise.all([
    prisma.recipe.findMany({
      where: { accountId },
      select: {
        id: true,
        itemName: true,
        category: true,
        isSellable: true,
        isConfirmed: true,
        _count: { select: { ingredients: true } },
      },
      orderBy: { itemName: "asc" },
    }),
    // ONE walk for the whole account. Sixty separate `computeRecipeCost` calls
    // take 6.1 seconds because each opens its own memo and re-prices every
    // shared component; this takes 0.8 and returns the same numbers.
    batchRecipeCosts(accountId),
    prisma.recipe.count({ where: { accountId, createdAt: { gte: d30 } } }),
    storeIds.length === 0
      ? Promise.resolve([] as Array<{ recipe_id: string; qty: number; revenue: number; price: number | null }>)
      : prisma.$queryRaw<
          Array<{ recipe_id: string; qty: number; revenue: number; price: number | null }>
        >`
          SELECT m."recipeId" AS recipe_id,
                 SUM(oi.quantity)::int AS qty,
                 SUM(oi.quantity * oi.price)::float AS revenue,
                 AVG(NULLIF(oi.price, 0))::float AS price
          FROM "OtterItemMapping" m
          JOIN "OtterOrderItem" oi ON oi.name = m."otterItemName"
          JOIN "OtterOrder" o ON o.id = oi."orderId"
          WHERE o."storeId" = ANY(${storeIds})
            AND o."referenceTimeLocal" >= ${startDate}
            AND o."referenceTimeLocal" <= ${endDate}
          GROUP BY 1`,
    // Not range-bound: "how long has this been wrong" is the question, and a
    // day inside the reader's range does not answer it.
    prisma.$queryRaw<Array<{ recipe_id: string; days: number }>>`
      SELECT "recipeId" AS recipe_id, COUNT(*)::int AS days
      FROM "DailyCogsItem"
      WHERE "recipeId" IS NOT NULL AND "partialCost"
      GROUP BY 1`,
  ])

  const soldById = new Map(sold.map((s) => [s.recipe_id, s]))
  const partialById = new Map(partialDays.map((p) => [p.recipe_id, p.days]))

  // How many OTHER recipes use each one as a component, counted from the
  // walked lines rather than a second query — the walk already holds them.
  const usedIn = new Map<string, number>()
  for (const result of costs.values()) {
    for (const line of result.lines) {
      if (line.kind !== "component") continue
      usedIn.set(line.refId, (usedIn.get(line.refId) ?? 0) + 1)
    }
  }

  return {
    rows: recipes.map((r) => {
      const cost = costs.get(r.id)
      const s = soldById.get(r.id)
      return {
        id: r.id,
        name: r.itemName,
        category: r.category,
        sellable: r.isSellable,
        confirmed: r.isConfirmed,
        lines: r._count.ingredients,
        usedIn: usedIn.get(r.id) ?? 0,
        cost: cost ? cost.totalCost : null,
        partial: cost?.partial ?? false,
        emptyWalk: cost?.emptyWalk ?? false,
        price: s?.price ?? null,
        soldQty: s?.qty ?? 0,
        revenue: s?.revenue ?? 0,
        partialDays: partialById.get(r.id) ?? 0,
      }
    }),
    addedRecently,
    // "custom" forces the concrete dates rather than a preset name, which is
    // what the other six adapters do and what a sentence can carry: "sold over
    // Aug 20 – Aug 27" reads; "sold over Yesterday" does not.
    rangeLabel: rangeLabel(range, "custom"),
    today,
  }
}

/* -- helpers ---------------------------------------------------------- */

/**
 * A recipe that reports a cost nobody computed.
 *
 * `emptyWalk` means no line produced any cost. Combined with `sellable` it is
 * a PLATE that declares a food cost of zero — the walk fell through to
 * `foodCostOverride`, and an override of $0.00 is stored identically to an
 * override somebody meant. See `RecipeCostResult.emptyWalk`.
 */
const costsNothing = (r: RecipeRow) =>
  r.emptyWalk && (r.cost === null || Math.abs(r.cost) < ZERO_COST)

const marginOf = (r: RecipeRow): number | null => {
  if (r.price === null || r.price <= 0 || r.cost === null) return null
  return ((r.price - r.cost) / r.price) * 100
}

/* -- sections --------------------------------------------------------- */

/**
 * The strip, and the cell the prototype gives to AI.
 *
 * `P.recipes` reads `Recipes 128 · +6 this month` / `Confirmed 114 · 89.1%` /
 * `AI-generated, unconfirmed 9 · waiting on you` / `Uncosted 5 · missing an
 * ingredient price`. Two of those four have no data at all here:
 *
 *   - **`Recipe.isAiGenerated` is false on all 60 rows.** There is not one
 *     AI-generated recipe in the account, so the third cell would count a
 *     population of size zero. What is genuinely unconfirmed is 34 recipes a
 *     person typed, and the cell that matters about them is not how many they
 *     are but what rides on them — §2 of the measurement: 21 are sellable and
 *     carry 21.4% of ninety days' revenue.
 *
 *   - **Nothing is uncosted.** All 129 lines price; zero partial, zero
 *     unmatched, zero matched-without-a-price. The fourth cell would read
 *     zero. What IS wrong sits one layer up and gets the cell instead: plates
 *     whose cost was never computed at all.
 */
function headlineOf(d: RecipeData): RecipeHeadline {
  const total = d.rows.length
  const confirmed = d.rows.filter((r) => r.confirmed).length
  const sellable = d.rows.filter((r) => r.sellable)
  const unconfirmedRevenue = sellable
    .filter((r) => !r.confirmed)
    .reduce((t, r) => t + r.revenue, 0)
  const totalRevenue = sellable.reduce((t, r) => t + r.revenue, 0)
  const share = totalRevenue > 0 ? (unconfirmedRevenue / totalRevenue) * 100 : null
  const zeroCost = sellable.filter(costsNothing)

  const unconfirmedCell: FigureProps = {
    label: "On unconfirmed recipes",
    value: money(unconfirmedRevenue),
    delta: share === null ? d.rangeLabel : `${pct(share, { scaled: true })} of ${d.rangeLabel}`,
    deltaTone: unconfirmedRevenue > 0 ? "is-down" : "is-flat",
  }
  const zeroCell: FigureProps = {
    label: "Plates costing nothing",
    value: count(zeroCost.length),
    delta:
      zeroCost.length === 0
        ? "every plate is costed"
        : /*
           * NOT "at 100% margin". The catalogue below deliberately prints an
           * em dash in the margin column for exactly these plates, and its own
           * note says why: the $0.00 is a recipe-level override standing in for
           * a cost nobody computed, so a margin against it is arithmetic on a
           * placeholder. This cell was stating as fact the one number the table
           * four inches under it refuses to state.
           */
          `${money(zeroCost.reduce((t, r) => t + r.revenue, 0))} sold with no cost behind it`,
    deltaTone: zeroCost.length > 0 ? "is-down" : "is-flat",
  }

  return {
    cells: [
      {
        label: "Recipes",
        value: count(total),
        // The prototype's own delta is "+6 this month". Nothing has been added
        // in thirty days — the same sentence the Ingredients page prints, for
        // the same reason and about the same fortnight in early May.
        delta:
          d.addedRecently === 0 ? "none added in 30 days" : `${d.addedRecently} added in 30 days`,
        // Flat either way, and for the reason the Ingredients strip carries in
        // full: nothing adds recipes on its own, so a book that did not grow
        // is the state this product is built to be in, not a fault. The two
        // cells that follow — unconfirmed revenue and plates costing nothing —
        // are the ones on this strip that earned the accent.
        deltaTone: "is-flat",
      },
      {
        label: "Confirmed",
        value: count(confirmed),
        delta: total > 0 ? pct((confirmed / total) * 100, { scaled: true }) : "—",
        deltaTone: confirmed < total ? "is-down" : "is-flat",
      },
      unconfirmedCell,
      zeroCell,
    ],
    phoneCells: [zeroCell, unconfirmedCell],
  }
}

/**
 * The catalogue, WITHOUT the prototype's `Yield` column.
 *
 * `Recipe.servingSize` is 1 on all 60 rows. A yield column would be sixty
 * ones — it costs a reader a glance and returns nothing, and the per-serving
 * cost beside it is already per one. The prototype's component section is
 * built on the same missing shape (`House sauce · 96 oz · $0.22 / oz`); see
 * `componentsOf`.
 *
 * Sellable recipes only. Nineteen of the sixty are modifiers that never sell
 * on their own, and a `Margin` column against a null price is a column of
 * noise; they get the component table instead, where they belong.
 */
function catalogueOf(d: RecipeData): RecipeCatalogue {
  const sellable = d.rows.filter((r) => r.sellable)
  // Worst first: a plate with no cost, then by what it sold. A catalogue
  // sorted alphabetically buries the two rows the page exists to show.
  const ordered = [...sellable].sort((a, b) => {
    const aBad = costsNothing(a) ? 1 : 0
    const bBad = costsNothing(b) ? 1 : 0
    if (aBad !== bBad) return bBad - aBad
    return b.revenue - a.revenue
  })
  const shown = ordered.slice(0, CATALOGUE_ROWS)
  const priced = sellable.filter((r) => r.price !== null).length

  return {
    rows: shown.map((r) => {
      const margin = marginOf(r)
      const zero = costsNothing(r)
      return {
        key: r.id,
        href: `/dashboard/recipes/${r.id}`,
        cells: {
          recipe: r.name,
          category: r.category,
          cost: zero ? { v: "$0.00", cls: "hot" } : unitCost(r.cost ?? 0),
          // An em-dash, never a zero. A recipe with no observed sale in the
          // range has no price — printing $0.00 would read as "given away".
          price: r.price === null ? "—" : unitCost(r.price),
          /*
           * A COST NOBODY COMPUTED YIELDS NO MARGIN.
           *
           * `costsNothing` means the recipe has no ingredient lines at all, so
           * the $0.00 in the cost cell beside this one is a recipe-level
           * OVERRIDE standing in for a figure that was never worked out. A
           * margin taken against it is arithmetic on a placeholder: "The
           * Reverse Bun" sold three plates for $24 and this column called that
           * 100.0%, at the top of the table, in the same type as the eighty-two
           * per cent beside it that is measured.
           *
           * The recipe's own page already refuses to do this and says why —
           * "not a plate cost that happens to be low" — and the note under
           * this very table states the principle for the price column: "a
           * plate nobody bought has no margin rather than a margin of
           * nothing". Same rule, the other column.
           *
           * Nothing is hidden by the em dash: the cost cell still shows $0.00
           * in the accent, the State column still reads "No lines", and the
           * strip above still counts the plate. What goes is only the figure
           * that cannot be derived.
           */
          margin:
            margin === null || zero
              ? "—"
              : pct(margin, { scaled: true }),
          state: zero
            ? { v: "No lines", cls: "hot" }
            : r.confirmed
              ? "Confirmed"
              : { v: "Unconfirmed", cls: "hot" },
        },
      }
    }),
    meta: `${count(sellable.length)} sellable · ${count(shown.length)} shown`,
    note:
      `Sorted by what is wrong with it, then by what it sold. ` +
      `${count(priced)} of ${count(sellable.length)} carry an observed price over ${d.rangeLabel}; ` +
      `the rest show an em-dash rather than a zero, because a plate nobody bought has no margin ` +
      `rather than a margin of nothing. A plate with no lines shows one too: its $0.00 is an ` +
      `override standing in for a cost nobody computed, and a margin against that is arithmetic ` +
      `on a placeholder. No yield column: every recipe in this account yields 1.`,
  }
}

/**
 * The queue, which leads with one plate rather than a tally.
 *
 * The prototype leads with *"Nine AI-generated recipes are unconfirmed"* and
 * follows with *"Five recipes cannot be costed"*. Nothing is AI-generated here
 * and nothing is uncosted in that sense, so both items are about empty sets.
 *
 * What replaces them is the finding the measurement turned up: **a sellable
 * slider that declares a food cost of $0.00, is marked confirmed, and has been
 * flagged `partialCost` on every day it has ever appeared in COGS.** One plate,
 * named, beats a count — and it is worth more than the unconfirmed tally
 * underneath it because nobody is looking for it.
 */
function workOf(d: RecipeData): RecipeWork {
  const items: QueueItem[] = []
  const sellable = d.rows.filter((r) => r.sellable)
  const zeroCost = sellable.filter(costsNothing).sort((a, b) => b.revenue - a.revenue)

  if (zeroCost.length > 0) {
    const worst = zeroCost[0]
    items.push({
      key: "zero-cost",
      tone: "bad",
      lead: count(zeroCost.length),
      unit: zeroCost.length === 1 ? "plate" : "plates",
      title: "Sold, and costing nothing",
      body:
        `"${worst.name}" has no ingredient lines at all, so nothing was ever costed and its ` +
        `recipe-level override stands in as the answer: ${unitCost(worst.cost ?? 0)} a serving. ` +
        (worst.soldQty > 0
          ? `It sold ${count(worst.soldQty)} for ${money(worst.revenue)} over ${d.rangeLabel}, ` +
            `against a cost nobody computed — which is why the margin column shows an em dash ` +
            `rather than the 100% that arithmetic would give. `
          : "") +
        (worst.partialDays > 0
          ? `The cost walk has flagged it as an understatement on ${count(worst.partialDays)} ` +
            `separate days and no rule has ever surfaced it.`
          : "") +
        (zeroCost.length > 1
          ? ` ${count(zeroCost.length - 1)} more ${zeroCost.length === 2 ? "plate does" : "plates do"} the same.`
          : ""),
      act: "Give it lines",
      href: `/dashboard/recipes/${worst.id}`,
    })
  }

  const unconfirmed = sellable.filter((r) => !r.confirmed)
  const unconfirmedRevenue = unconfirmed.reduce((t, r) => t + r.revenue, 0)
  if (unconfirmed.length > 0) {
    const biggest = [...unconfirmed].sort((a, b) => b.revenue - a.revenue).slice(0, 3)
    items.push({
      key: "unconfirmed",
      tone: "warn",
      lead: count(unconfirmed.length),
      unit: "recipes",
      title: "Costing real plates, unconfirmed",
      body:
        `${money(unconfirmedRevenue)} sold over ${d.rangeLabel} on recipes nobody has checked — ` +
        `${biggest.map((r) => r.name).join(", ")} lead them. ` +
        `These feed the COGS page, the menu margins and the P&L food line, so confirming is not ` +
        `bookkeeping: it is whether those three are reading a quantity somebody stands behind. ` +
        `None of them is AI-generated — every recipe in this account was typed by hand.`,
      act: "Open the catalogue",
      href: "/dashboard/recipes",
    })
  }

  return { items, meta: `${plural(items.length, "thing")} to do` }
}

/**
 * Component recipes — the one section of the prototype that lands as drawn,
 * with two corrections.
 *
 * There are 15 rather than 3, and the prototype's per-unit shape (`House sauce
 * · 96 oz · $0.22 / oz`) has no data: `servingSize` is 1 everywhere, so there
 * is no batch yield to divide a cost by. The column is the component's own
 * cost per serving instead.
 *
 * The second correction is the one worth a marker. `Double Slider` is a
 * component of four recipes AND the top-selling plate in the account at
 * 242,865 sold. Listing it next to `Straight Cut Fries` without saying so
 * invites the reader to file it as a prep item, and a reader who "tidies up"
 * a prep item that is actually the best-selling burger has been misled by the
 * table.
 */
function componentsOf(d: RecipeData): RecipeComponents {
  const used = d.rows.filter((r) => r.usedIn > 0).sort((a, b) => b.usedIn - a.usedIn)
  const shown = used.slice(0, COMPONENT_ROWS)
  const alsoSold = used.filter((r) => r.sellable && r.soldQty > 0)

  return {
    rows: shown.map((r) => ({
      key: r.id,
      href: `/dashboard/recipes/${r.id}`,
      cells: {
        component: r.name,
        cost: r.cost === null ? "—" : unitCost(r.cost),
        usedIn: count(r.usedIn),
        // The marker. A component that is also on the menu is not a prep item.
        also:
          r.sellable && r.soldQty > 0
            ? { v: `sold ${count(r.soldQty)}`, cls: "hot" }
            : "prep only",
      },
    })),
    meta: `${count(used.length)} used inside others · ${count(shown.length)} shown`,
    note: (() => {
      const yieldNote =
        `No yield column: every recipe in this account yields 1, so there is no batch to ` +
        `divide a cost across.`
      if (alsoSold.length === 0) return `Every component here is prep only. ${yieldNote}`
      // Three names, then a count. The full list runs to nine here and takes
      // five lines under a six-row table — a note longer than the thing it
      // annotates is not a note.
      const named = alsoSold.slice(0, 3).map((r) => r.name).join(", ")
      const rest = alsoSold.length - 3
      return (
        `${alsoSold.length === 1 ? "One of these is" : `${count(alsoSold.length)} of these are`} ` +
        `also sold on ${alsoSold.length === 1 ? "its" : "their"} own — ${named}` +
        (rest > 0 ? ` and ${count(rest)} more` : "") +
        ` — so ${alsoSold.length === 1 ? "it is" : "they are"} both a line inside other recipes ` +
        `and a plate over ${d.rangeLabel}. ${yieldNote}`
      )
    })(),
  }
}

/** The phone's list: what is wrong first, then what sells. */
function recentOf(d: RecipeData): RecipeRecent {
  const sellable = d.rows.filter((r) => r.sellable)
  const ordered = [...sellable].sort((a, b) => {
    const aBad = costsNothing(a) ? 1 : 0
    const bBad = costsNothing(b) ? 1 : 0
    if (aBad !== bBad) return bBad - aBad
    return b.revenue - a.revenue
  })

  return {
    rows: ordered.slice(0, PHONE_ROWS).map((r) => {
      const margin = marginOf(r)
      const zero = costsNothing(r)
      return {
        key: r.id,
        href: `/dashboard/recipes/${r.id}`,
        title: r.name,
        detail: zero
          ? "no lines · costed at nothing"
          : `${r.category} · ${r.confirmed ? "confirmed" : "unconfirmed"}`,
        value: zero ? "$0.00" : unitCost(r.cost ?? 0),
        note: margin === null ? "no sale in range" : `${pct(margin, { scaled: true })} margin`,
        noteTone: zero ? "down" : "up",
      }
    }),
    meta: `${count(sellable.length)} sellable`,
  }
}

/* -- assembly --------------------------------------------------------- */

export function getRecipesSectionPromises(
  input: RecipesInput,
): StreamedSections<RecipesSections> {
  const dataP = classify(() => loadRecipes(input), {
    retryAction: "retryRecipes",
    isEmpty: (d) => d.rows.length === 0,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: RecipeData) => T) =>
    guardSection(dataP.then((sd) => mapReady(sd, f)), "retryRecipes")

  return {
    headline: s(headlineOf),
    catalogue: s(catalogueOf),
    work: s(workOf),
    components: s(componentsOf),
    recent: s(recentOf),
  }
}

export async function getRecipesSections(input: RecipesInput): Promise<RecipesSections> {
  return awaitSections(getRecipesSectionPromises(input))
}
