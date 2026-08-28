import { prisma } from "@/lib/prisma"
import { batchRecipeCosts, type RecipeCostLine } from "@/lib/recipe-cost"
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
import type { CostBand, FigureProps, MoneyLine, Row } from "@/components/counter"

/**
 * One recipe — `P.recipe` (`docs/counter/counter-prototype.html:6151`).
 *
 * "The builder: ingredients on the left, the cost it produces on the right,
 * live."
 *
 * Measured before it was written; the numbers are in
 * `docs/counter/measurements/2026-08-28-recipes.md` §7 and the probe recorded
 * in this file's own sections. Three of the prototype's landmarks change
 * subject, and one of them is the same fact the Ingredients page reports from
 * the other end.
 *
 * ## The prototype's own Double Slider carries packaging. This one does not.
 *
 * `RLINES` lists eight lines for a slider: bun, beef, cheese, house sauce,
 * grilled onion, pickle chips, **`Tray food paper #50`** and **`Chrsned bag
 * plas t-shirt logo`**. The real Double Slider has three — bun, cheese, beef —
 * and its own `notes` field says why: *"Sauce/butter/toppings all come via
 * modifiers."*
 *
 * The tray paper and the bag are not missing from the data. They are in the
 * **$21,817 of purchases that reach no recipe** (`ingredient-reach.ts`), which
 * is the same fact the Ingredients page reports as a gap. Whether that is a
 * defect depends on a decision nobody has written down: if packaging belongs
 * in plate cost, 23 ingredients are missing from these recipes; if it does
 * not, the Ingredients page is right to file it as correctly excluded and this
 * page is right to show three lines. **The page states the choice rather than
 * assuming it** — see `costOf`.
 *
 * ## The cost bar is drawn from real categories, not the prototype's four
 *
 * `P.recipe` hard-codes `Protein / Bread / Dairy / Sauce, produce, packaging`.
 * Those are a slider's four buckets and nothing else's — this account's recipe
 * lines span eleven `CanonicalIngredient.category` values, led by Beverages
 * (10 ingredients) and Paper/Supplies (7). A shake has no Bread band. So the
 * bands are the categories the recipe's own lines actually carry.
 */

/** Bands drawn before the rest is folded into one. */
const MAX_BANDS = 4
/** Days of cost history the trend reads. */
const TREND_DAYS = 21
/** `ct-` token names, in the prototype's own order for its four bands. */
const BAND_TONES = ["bad", "signal", "good", "ink-3"]

export interface RecipeHead {
  title: string
  sub: string
  cells: FigureProps[]
  phoneCells: FigureProps[]
}

export interface RecipeBuilder {
  /** The four editable header fields, in the prototype's order. */
  fields: Array<{ key: string; label: string; value: string; placeholder?: boolean }>
  lines: BuilderLine[]
  notes: string | null
  meta: string
  /** Every canonical the picker can offer, already sorted by name. */
  pantry: PantryOption[]
  /** Sub-recipes this recipe may reference without making a cycle. */
  components: PantryOption[]
  recipeId: string
  isConfirmed: boolean
}

export interface BuilderLine {
  key: string
  kind: "ingredient" | "component"
  refId: string
  name: string
  /** "Sysco · 3589484 · $0.33 / each" — already written. */
  sub: string
  quantity: number
  unit: string
  /** "$0.33", or "—" when the line could not be priced. */
  ext: string
  missing: boolean
}

export interface PantryOption {
  id: string
  name: string
  /** "$4.39 / lb", or "no price". */
  price: string
  unit: string
  kind: "ingredient" | "component"
}

export interface RecipeCost {
  perServing: string
  bands: CostBand[]
  money: MoneyLine[]
  foot: string
  /** Null when nothing is missing — the section is dropped entirely. */
  gap: { lead: string; body: string } | null
  /** The packaging question, always stated. */
  note: string
}

export interface RecipeSellsAs {
  rows: Row[]
  meta: string
  note: string
}

export interface RecipeTrend {
  chart: ChartSpec
  meta: string
  note: string
}

export interface RecipeSections {
  head: SectionData<RecipeHead>
  builder: SectionData<RecipeBuilder>
  cost: SectionData<RecipeCost>
  sellsAs: SectionData<RecipeSellsAs>
  trend: SectionData<RecipeTrend>
}

export interface RecipeInput {
  recipeId: string
  storeId: string | null
  accountId: string
  range: DateRange
  today: Date
}

/* -- loading ---------------------------------------------------------- */

interface Loaded {
  id: string
  name: string
  category: string
  servingSize: number
  notes: string | null
  isSellable: boolean
  isConfirmed: boolean
  override: number | null
  lines: RecipeCostLine[]
  totalCost: number
  partial: boolean
  emptyWalk: boolean
  categoryOf: Map<string, string | null>
  pantry: PantryOption[]
  components: PantryOption[]
  posNames: Array<{ kind: string; name: string; stores: number }>
  trend: Array<{ date: string; cost: number | null; qty: number; partial: boolean }>
  soldQty: number
  revenue: number
  price: number | null
  rangeLabel: string
  /** Ingredients bought that reach no recipe, split food vs supplies. */
  packaging: { n: number; spend: number }
}

async function loadRecipe(input: RecipeInput): Promise<Loaded | null> {
  const { recipeId, accountId, storeId, range } = input
  const { startDate, endDate } = toQueryBounds(range)

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, accountId },
    select: {
      id: true, itemName: true, category: true, servingSize: true, notes: true,
      isSellable: true, isConfirmed: true, foodCostOverride: true,
    },
  })
  if (!recipe) return null

  const stores = await prisma.store.findMany({
    where: { accountId, isActive: true, ...(storeId ? { id: storeId } : {}) },
    select: { id: true },
  })
  const storeIds = stores.map((s) => s.id)

  const [costs, canonicals, allRecipes, posItems, posSubItems, trend, sold, orphanSupplies] =
    await Promise.all([
      batchRecipeCosts(accountId),
      prisma.canonicalIngredient.findMany({
        where: { accountId },
        select: { id: true, name: true, category: true, recipeUnit: true, costPerRecipeUnit: true },
        orderBy: { name: "asc" },
      }),
      prisma.recipe.findMany({
        where: { accountId, id: { not: recipeId } },
        select: { id: true, itemName: true },
        orderBy: { itemName: "asc" },
      }),
      prisma.$queryRaw<Array<{ name: string; stores: number }>>`
        SELECT "otterItemName" AS name, COUNT(DISTINCT "storeId")::int AS stores
        FROM "OtterItemMapping" WHERE "recipeId" = ${recipeId} GROUP BY 1 ORDER BY 2 DESC, 1`,
      prisma.$queryRaw<Array<{ name: string; stores: number }>>`
        SELECT "otterSubItemName" AS name, COUNT(DISTINCT "storeId")::int AS stores
        FROM "OtterSubItemMapping" WHERE "recipeId" = ${recipeId} GROUP BY 1 ORDER BY 2 DESC, 1`,
      prisma.$queryRaw<
        Array<{ d: Date; unit_cost: number | null; qty: number; partial: boolean }>
      >`
        SELECT date AS d, AVG("unitCost")::float AS unit_cost,
               SUM("qtySold")::int AS qty, BOOL_OR("partialCost") AS partial
        FROM "DailyCogsItem"
        WHERE "recipeId" = ${recipeId}
          AND date >= (${endDate}::date - MAKE_INTERVAL(days => ${TREND_DAYS - 1}))
          AND date <= ${endDate}::date
        GROUP BY 1 ORDER BY 1`,
      storeIds.length === 0
        ? Promise.resolve([] as Array<{ qty: number; revenue: number; price: number | null }>)
        : prisma.$queryRaw<Array<{ qty: number; revenue: number; price: number | null }>>`
            SELECT SUM(oi.quantity)::int AS qty,
                   SUM(oi.quantity * oi.price)::float AS revenue,
                   AVG(NULLIF(oi.price, 0))::float AS price
            FROM "OtterItemMapping" m
            JOIN "OtterOrderItem" oi ON oi.name = m."otterItemName"
            JOIN "OtterOrder" o ON o.id = oi."orderId"
            WHERE m."recipeId" = ${recipeId}
              AND o."storeId" = ANY(${storeIds})
              AND o."referenceTimeLocal" >= ${startDate}
              AND o."referenceTimeLocal" <= ${endDate}`,
      prisma.$queryRaw<Array<{ id: string; name: string; category: string | null; spend: number }>>`
        SELECT ci.id, ci.name, ci.category, COALESCE(SUM(li."extendedPrice"), 0)::float AS spend
        FROM "CanonicalIngredient" ci
        LEFT JOIN "InvoiceLineItem" li ON li."canonicalIngredientId" = ci.id
        WHERE ci."accountId" = ${accountId}
          AND NOT EXISTS (
            SELECT 1 FROM "RecipeIngredient" ri WHERE ri."canonicalIngredientId" = ci.id
          )
        GROUP BY ci.id`,
    ])

  const walked = costs.get(recipeId)
  const { splitReach } = await import("@/lib/counter/ingredient-reach")
  const reach = splitReach(orphanSupplies)

  // Sub-recipes that would NOT make a cycle. A recipe already reachable from
  // this one cannot also contain it, and `upsertRecipe` would reject the save
  // — better to leave it out of the picker than to offer a choice that throws.
  const reachable = new Set<string>()
  const mark = (id: string) => {
    if (reachable.has(id)) return
    reachable.add(id)
    for (const l of costs.get(id)?.lines ?? []) if (l.kind === "component") mark(l.refId)
  }
  mark(recipeId)

  return {
    id: recipe.id,
    name: recipe.itemName,
    category: recipe.category,
    servingSize: recipe.servingSize,
    notes: recipe.notes,
    isSellable: recipe.isSellable,
    isConfirmed: recipe.isConfirmed,
    override: recipe.foodCostOverride,
    lines: walked?.lines ?? [],
    totalCost: walked?.totalCost ?? 0,
    partial: walked?.partial ?? false,
    emptyWalk: walked?.emptyWalk ?? true,
    categoryOf: new Map(canonicals.map((c) => [c.id, c.category])),
    pantry: canonicals.map((c) => ({
      id: c.id,
      name: titleCase(c.name),
      price:
        c.costPerRecipeUnit === null
          ? "no price"
          : `${unitCost(c.costPerRecipeUnit)} / ${(c.recipeUnit ?? "unit").toLowerCase()}`,
      unit: c.recipeUnit ?? "each",
      kind: "ingredient" as const,
    })),
    components: allRecipes
      .filter((r) => !reachable.has(r.id))
      .map((r) => ({
        id: r.id,
        name: r.itemName,
        price: costs.has(r.id) ? `${unitCost(costs.get(r.id)!.totalCost)} / serving` : "no cost",
        unit: "serving",
        kind: "component" as const,
      })),
    posNames: [
      ...posItems.map((p) => ({ kind: "item", name: p.name, stores: p.stores })),
      ...posSubItems.map((p) => ({ kind: "modifier", name: p.name, stores: p.stores })),
    ],
    trend: trend.map((t) => ({
      date: t.d.toISOString().slice(0, 10),
      cost: t.unit_cost,
      qty: t.qty,
      partial: t.partial,
    })),
    soldQty: sold[0]?.qty ?? 0,
    revenue: sold[0]?.revenue ?? 0,
    price: sold[0]?.price ?? null,
    rangeLabel: rangeLabel(range, "custom"),
    packaging: { n: reach.supplies.n, spend: reach.supplies.spend },
  }
}

/* -- sections --------------------------------------------------------- */

const marginOf = (d: Loaded): number | null =>
  d.price === null || d.price <= 0 ? null : ((d.price - d.totalCost) / d.price) * 100

function headOf(d: Loaded): RecipeHead {
  const margin = marginOf(d)
  const zero = d.emptyWalk && Math.abs(d.totalCost) < 0.005

  const costCell: FigureProps = {
    label: "Cost per serving",
    value: zero ? "$0.00" : unitCost(d.totalCost),
    // The prototype's delta is "▲ $0.19 in 3 weeks". What matters more here is
    // whether the number was computed at all.
    delta: zero
      ? "nothing was costed"
      : d.partial
        ? "at least — one line unpriced"
        : `${count(d.lines.length)} ${d.lines.length === 1 ? "line" : "lines"}, all priced`,
    deltaTone: zero || d.partial ? "is-down" : "is-flat",
  }
  const marginCell: FigureProps = {
    label: "Margin",
    value: margin === null ? "—" : pct(margin, { scaled: true }),
    delta: margin === null ? `no sale in ${d.rangeLabel}` : `on ${unitCost(d.price)}`,
    deltaTone: zero ? "is-down" : "is-flat",
  }

  return {
    title: d.name,
    sub:
      `${d.category} · yields ${count(d.servingSize)} · ` +
      (d.isConfirmed ? "confirmed" : "not confirmed"),
    cells: [
      costCell,
      {
        label: "Sells at",
        value: d.price === null ? "—" : unitCost(d.price),
        delta: d.price === null ? "no observed price" : `mean over ${d.rangeLabel}`,
        deltaTone: "is-flat",
      },
      marginCell,
      {
        label: "Sold in range",
        value: count(d.soldQty),
        delta: d.soldQty === 0 ? d.rangeLabel : `${money(d.revenue)} of revenue`,
        deltaTone: "is-flat",
      },
    ],
    phoneCells: [costCell, marginCell],
  }
}

function builderOf(d: Loaded): RecipeBuilder {
  return {
    fields: [
      { key: "itemName", label: "Recipe name", value: d.name },
      { key: "category", label: "Category", value: d.category },
      { key: "servingSize", label: "Serves", value: String(d.servingSize) },
      {
        key: "foodCostOverride",
        label: "Cost override",
        value: d.override === null ? "None" : unitCost(d.override),
        placeholder: d.override === null,
      },
    ],
    lines: d.lines.map((l, i) => ({
      key: `${l.kind}:${l.refId}:${i}`,
      kind: l.kind,
      refId: l.refId,
      name: titleCase(l.name),
      sub:
        l.kind === "component"
          ? `sub-recipe · ${unitCost(l.unitCost)} / serving`
          : [
              l.sourceVendor ?? null,
              l.sourceSku ? `part ${l.sourceSku}` : null,
              l.unitCost === null
                ? "no price"
                : `${unitCost(l.unitCost)} / ${(l.costUnit ?? "unit").toLowerCase()}`,
            ]
              .filter(Boolean)
              .join(" · "),
      quantity: l.quantity,
      unit: l.unit,
      ext: l.missingCost ? "—" : unitCost(l.lineCost),
      missing: l.missingCost,
    })),
    notes: d.notes,
    meta:
      d.lines.length === 0
        ? "no lines"
        : `${count(d.lines.length)} ${d.lines.length === 1 ? "line" : "lines"}` +
          (d.lines.some((l) => l.kind === "component")
            ? ` · ${count(d.lines.filter((l) => l.kind === "component").length)} sub-recipe`
            : ""),
    pantry: d.pantry,
    components: d.components,
    recipeId: d.id,
    isConfirmed: d.isConfirmed,
  }
}

/**
 * The cost panel — and the one sentence this page owes the reader.
 *
 * `P.recipe` bands its cost bar Protein / Bread / Dairy / "Sauce, produce,
 * packaging" and its Double Slider includes a food tray and a carrier bag.
 * This account's Double Slider has three lines and no packaging at all, by a
 * decision recorded only in the recipe's own notes field.
 *
 * That decision is worth stating on every recipe, because it is the SAME
 * number the Ingredients page reports as a gap: the tray paper and the bag sit
 * in the supplies that reach no recipe. One of those two pages is describing a
 * deliberate exclusion and the other is describing a hole, and nothing in the
 * data says which. So this note says exactly that, with the figure attached,
 * and leaves the call to a person.
 */
function costOf(d: Loaded): RecipeCost {
  const priced = d.lines.filter((l) => !l.missingCost)
  const byCategory = new Map<string, number>()
  for (const l of priced) {
    const cat =
      l.kind === "component" ? "Sub-recipes" : (d.categoryOf.get(l.refId) ?? "Uncategorised")
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + l.lineCost)
  }
  const ordered = [...byCategory].sort((a, b) => b[1] - a[1])
  const head = ordered.slice(0, MAX_BANDS - 1)
  const tail = ordered.slice(MAX_BANDS - 1)
  const bands: CostBand[] = [
    ...head.map(([label, weight], i) => ({
      key: label,
      label,
      value: unitCost(weight),
      weight,
      tone: BAND_TONES[i % BAND_TONES.length],
    })),
    ...(tail.length > 0
      ? [
          {
            key: "rest",
            label: tail.length === 1 ? tail[0][0] : `${count(tail.length)} more`,
            value: unitCost(tail.reduce((t, [, w]) => t + w, 0)),
            weight: tail.reduce((t, [, w]) => t + w, 0),
            tone: BAND_TONES[BAND_TONES.length - 1],
          },
        ]
      : []),
  ]

  const margin = marginOf(d)
  const lines: MoneyLine[] = [
    { label: "Sells at", value: d.price === null ? "—" : unitCost(d.price) },
    { label: "Plate cost", value: `−${unitCost(d.totalCost)}` },
    {
      label: "Gross margin",
      value: d.price === null ? "—" : unitCost(d.price - d.totalCost),
      total: true,
    },
  ]

  const missing = d.lines.filter((l) => l.missingCost)

  return {
    perServing: unitCost(d.totalCost),
    bands,
    money: lines,
    foot:
      margin === null
        ? `No observed price in ${d.rangeLabel}, so there is no margin to state.`
        : `${pct(margin, { scaled: true })} margin · ${pct(100 - margin, { scaled: true })} food cost`,
    gap:
      d.emptyWalk && d.lines.length === 0
        ? {
            lead: "no lines",
            body:
              `Nothing was costed. This recipe has no ingredient lines at all, so the ` +
              `${unitCost(d.totalCost)} above is its recipe-level override standing in for a cost ` +
              `nobody computed — not a plate cost that happens to be low.`,
          }
        : missing.length > 0
          ? {
              lead: `${count(missing.length)} of ${count(d.lines.length)}`,
              body:
                `${missing.map((l) => titleCase(l.name)).join(", ")} could not be priced, so this ` +
                `plate costs AT LEAST ${unitCost(d.totalCost)} rather than exactly. It does not ` +
                `block the recipe from saving.`,
            }
          : null,
    // Stated on every recipe, priced or not — see the function's own comment.
    note:
      `Packaging is not in this cost. Across the account ${money(d.packaging.spend)} of ` +
      `containers, liners and gloves is bought and appears in no recipe. Whether that is a ` +
      `deliberate exclusion or ${count(d.packaging.n)} missing lines is a decision nobody has ` +
      `written down, and the Ingredients page reports the same figure as a gap.`,
  }
}

function sellsAsOf(d: Loaded): RecipeSellsAs {
  return {
    rows: d.posNames.map((p) => ({
      key: `${p.kind}:${p.name}`,
      cells: {
        name: p.name,
        kind: p.kind === "item" ? "menu item" : { v: "modifier", cls: "hot" },
        stores: count(p.stores),
      },
    })),
    meta:
      d.posNames.length === 0
        ? "nothing linked"
        : `${count(d.posNames.length)} POS ${d.posNames.length === 1 ? "name" : "names"}`,
    note:
      d.posNames.length === 0
        ? `No POS item maps to this recipe, so nothing it sells is costed against it — it ` +
          `contributes to no food-cost line and shows no margin anywhere in the product.`
        : d.posNames.length === 1
          ? `One POS name maps here, so this recipe's lines are the only thing costing it.`
          : `One recipe, ${count(d.posNames.length)} spellings on the menu. Every one of them ` +
            `costs against these lines, so an error here is an error on all ` +
            `${count(d.posNames.length)}.`,
  }
}

/**
 * Cost per serving over the last 21 days.
 *
 * **A day flagged `partialCost` is drawn as a gap, not as a point.** The
 * exemplar's most recent day reads $2.61 against a 21-day run of about $1.65 —
 * a 63% jump that is not a price move, it is an incomplete walk, and
 * `DailyCogsItem.partialCost` already says so. Plotting it produces the single
 * most alarming shape on the page out of a row the data itself labels
 * unreliable.
 */
function trendOf(d: Loaded): RecipeTrend {
  const points = d.trend
  const usable = points.filter((p) => !p.partial && p.cost !== null)
  const dropped = points.length - usable.length

  return {
    chart: {
      type: "line",
      h: 132,
      ticks: true,
      labels: points.map((p) => D(p.date)),
      series: [
        {
          name: "Cost / serving",
          color: "var(--bad)",
          data: points.map((p) => (p.partial || p.cost === null ? null : p.cost)),
          fill: true,
        },
      ],
      alt: "Cost per serving by day",
    },
    meta:
      usable.length === 0
        ? "no costed day in the window"
        : `${count(usable.length)} of ${count(points.length)} days`,
    note:
      dropped === 0
        ? `Every day in the window costed in full.`
        : `${count(dropped)} ${dropped === 1 ? "day is" : "days are"} left as a gap rather than a ` +
          `point: the cost walk flagged ${dropped === 1 ? "it" : "them"} as incomplete, and an ` +
          `incomplete walk plots as a price spike that never happened.`,
  }
}

const D = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

/**
 * The recipe's name and category, and nothing else.
 *
 * The masthead and the breadcrumb need the RECORD's name — "Recipes / Double
 * Slider" is `Topbar`'s contract for a detail route — and the page cannot get
 * it from `sections.head` without awaiting the sections, which is exactly what
 * `no-awaited-loader` forbids outside the two order-detail routes it exempts
 * by name. Widening that exemption to keep a breadcrumb honest would trade the
 * streaming standard for a string.
 *
 * So the page awaits this instead: one indexed lookup on the primary key,
 * returning null when the recipe is not this account's, which is also how the
 * route decides to 404. The sections still stream.
 */
export async function getRecipeName(
  recipeId: string,
  accountId: string,
): Promise<{ name: string; category: string } | null> {
  const row = await prisma.recipe.findFirst({
    where: { id: recipeId, accountId },
    select: { itemName: true, category: true },
  })
  return row ? { name: row.itemName, category: row.category } : null
}

/* -- assembly --------------------------------------------------------- */

export function getRecipeSectionPromises(input: RecipeInput): StreamedSections<RecipeSections> {
  const dataP = classify(() => loadRecipe(input), {
    retryAction: "retryRecipe",
    isEmpty: (d) => d === null,
    emptyReason: "no_match",
  })

  const s = <T,>(f: (d: Loaded) => T) =>
    guardSection(
      dataP.then((sd) => mapReady(sd, (d) => f(d as Loaded))),
      "retryRecipe",
    )

  return {
    head: s(headOf),
    builder: s(builderOf),
    cost: s(costOf),
    sellsAs: s(sellsAsOf),
    trend: s(trendOf),
  }
}

export async function getRecipeSections(input: RecipeInput): Promise<RecipeSections> {
  return awaitSections(getRecipeSectionPromises(input))
}
