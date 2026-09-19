import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
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
import { PORTION_UNIT_LABEL, unitsCompatibleWith } from "@/lib/unit-conversion"
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

/**
 * The units a line may be measured in, given what the thing it points at is
 * priced or made in.
 *
 * An unrecognised unit yields the unit itself and nothing else: we cannot say
 * what converts into "sleeve", so the only safe offer is the one that is
 * already there. An empty list would leave the owner with no way to keep a
 * line they cannot currently fix.
 */
function unitChoices(unit: string | null | undefined): string[] {
  const options = unitsCompatibleWith(unit)
  if (options.length > 0) return [...options]
  return unit?.trim() ? [unit.trim()] : [PORTION_UNIT_LABEL]
}

/**
 * The units a batch may be measured in, biggest first per family.
 *
 * A kitchen makes sauce by the gallon and chili by the quart; it does not make
 * anything by the gram. The list is deliberately the everyday half of what
 * `unit-conversion` understands — anything here converts into anything else in
 * its family, so a line can always be written in whatever the cook reaches for.
 */
const YIELD_UNIT_CHOICES = ["gal", "qt", "pt", "cup", "fl oz", "l", "ml", "lb", "oz", "kg", "g", "each"]

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

/**
 * One header field, as a CONTROL rather than a sentence.
 *
 * These were rendered as `<span>`s. Four of a recipe's five header fields —
 * name, category, yield and cost override — were read-only text, the unit on
 * every line was read-only text, and notes rendered as a caption. An owner
 * could change a quantity and delete a row; that was the entire editable
 * surface of a recipe, and it is why `servingSize` reads 1 on all sixty rows.
 *
 * `saveRecipeLines` has always accepted every one of these and `upsertRecipe`
 * has always written them. The gap was only ever the input.
 */
export interface BuilderField {
  key: "itemName" | "category" | "servingSize" | "yieldUnit" | "foodCostOverride" | "notes"
  label: string
  kind: "text" | "number" | "money" | "select" | "textarea"
  /** The raw value for the control — a number field gets a number. */
  value: string
  /** For `select`: the options, first one being the current value's own. */
  options?: Array<{ value: string; label: string }>
  /** Shown when the field is empty. */
  placeholder?: string
  /** One line under the control, when the field needs explaining. */
  hint?: string
}

export interface RecipeBuilder {
  fields: BuilderField[]
  lines: BuilderLine[]
  notes: string | null
  meta: string
  /** Every canonical the picker can offer, already sorted by name. */
  pantry: PantryOption[]
  /** Sub-recipes this recipe may reference without making a cycle. */
  components: PantryOption[]
  recipeId: string
  isConfirmed: boolean
  /**
   * Null when the recipe can be deleted; the reason when it cannot. A recipe
   * used as somebody's sub-recipe is refused by `deleteRecipe`, and a button
   * that always throws is worse than a button that explains itself.
   */
  deleteBlockedBy: string | null
}

export interface BuilderLine {
  key: string
  kind: "ingredient" | "component"
  refId: string
  name: string
  /** "Sysco · 3589484 · $0.33 / each · 6 days ago" — already written. */
  sub: string
  quantity: number
  unit: string
  /**
   * The units this line may use — every unit that converts into what the
   * ingredient is PRICED in, or into the sub-recipe's own batch unit. This is
   * what makes an uncostable line unreachable rather than merely discouraged:
   * an owner cannot pick `cup` against a price per `lb` and get a line that
   * silently costs $0.00 forever.
   */
  unitOptions: string[]
  /** "$0.33", or "—" when the line could not be priced. */
  ext: string
  missing: boolean
  /** One short phrase naming what is wrong, when something is. */
  missingWhy: string | null
  /** Days since the invoice this line's price came from. Null when unknown. */
  priceAgeDays: number | null
}

export interface PantryOption {
  id: string
  name: string
  /** "$4.39 / lb", or "no price". */
  price: string
  unit: string
  kind: "ingredient" | "component"
  /** The units a line drawing on this option may use. */
  unitOptions: string[]
}

export interface RecipeCost {
  perServing: string
  /**
   * "Batch $48.20 ÷ 24 portions" — shown only when the recipe is a batch, so
   * a reader can see where the per-serving figure above came from. Null on the
   * ordinary one-plate recipe, which is every recipe in this account today.
   */
  batch: string | null
  bands: CostBand[]
  money: MoneyLine[]
  foot: string
  /**
   * Null when nothing is missing — the section says so instead.
   *
   * `href` is `P.recipe`'s "Match it now" and is set only on the branch that
   * has somewhere to go: a line with no matched SKU points at that
   * ingredient's own page, where the matching happens. The other branch — a
   * recipe with no lines at all — has no ingredient to match, so it gets the
   * sentence without the button rather than a button that opens nothing.
   */
  gap: { lead: string; body: string; href?: string } | null
  /** The packaging question, always stated. */
  note: string
}

/**
 * `P.recipe`'s "Sells as · linked POS items".
 *
 * `.linkpop` chips, not a table. The design draws one chip per POS name with a
 * tag beside it, and three columns of two-word cells is a table pretending to
 * be a list — a `.tbl` where the design has none, which the structure pass
 * reads as an extra and is right to.
 */
export interface RecipeSellsAs {
  links: Array<{ key: string; name: string; kind: "item" | "modifier"; stores: number }>
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

export interface Loaded {
  id: string
  name: string
  category: string
  servingSize: number
  yieldUnit: string | null
  notes: string | null
  isSellable: boolean
  isConfirmed: boolean
  override: number | null
  lines: RecipeCostLine[]
  totalCost: number
  batchCost: number
  partial: boolean
  emptyWalk: boolean
  hasLines: boolean
  overrideApplied: boolean
  categoryOf: Map<string, string | null>
  /** Categories already in use on this account, for the category picker. */
  categories: string[]
  /** How many other recipes use this one as a component, and one of their names. */
  usedInCount: number
  usedInName: string | null
  /** canonicalIngredientId → the unit it is priced in, for the line's unit box. */
  costUnitOf: Map<string, string | null>
  /** componentRecipeId → the units a line drawing on it may use. */
  componentUnits: Map<string, string[]>
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
      isSellable: true, isConfirmed: true, foodCostOverride: true, yieldUnit: true,
    },
  })
  if (!recipe) return null

  const stores = await getScopedStores(accountId, storeId ?? null)
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
        select: { id: true, itemName: true, yieldUnit: true, category: true },
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

  // Who would break if this recipe were deleted. `deleteRecipe` refuses when
  // anything uses it as a component, so the page says so up front instead of
  // offering a button that always throws.
  const usedIn: Array<{ id: string; name: string }> = []
  for (const [id, result] of costs) {
    if (id === recipeId) continue
    if (result.lines.some((l) => l.kind === "component" && l.refId === recipeId)) {
      usedIn.push({ id, name: result.itemName })
    }
  }

  return {
    id: recipe.id,
    name: recipe.itemName,
    category: recipe.category,
    servingSize: recipe.servingSize,
    yieldUnit: recipe.yieldUnit,
    notes: recipe.notes,
    isSellable: recipe.isSellable,
    isConfirmed: recipe.isConfirmed,
    override: recipe.foodCostOverride,
    lines: walked?.lines ?? [],
    totalCost: walked?.totalCost ?? 0,
    batchCost: walked?.batchCost ?? 0,
    partial: walked?.partial ?? false,
    emptyWalk: walked?.emptyWalk ?? true,
    hasLines: walked?.hasLines ?? false,
    overrideApplied: walked?.overrideApplied ?? false,
    categoryOf: new Map(canonicals.map((c) => [c.id, c.category])),
    costUnitOf: new Map(canonicals.map((c) => [c.id, c.recipeUnit])),
    componentUnits: new Map(
      allRecipes.map((r) => [
        r.id,
        r.yieldUnit ? unitChoices(r.yieldUnit) : [PORTION_UNIT_LABEL],
      ]),
    ),
    categories: [
      ...new Set([recipe.category, ...allRecipes.map((r) => r.category)].filter(Boolean)),
    ].sort(),
    usedInCount: usedIn.length,
    usedInName: usedIn[0]?.name ?? null,
    pantry: canonicals.map((c) => ({
      id: c.id,
      name: titleCase(c.name),
      price:
        c.costPerRecipeUnit === null
          ? "no price"
          : `${unitCost(c.costPerRecipeUnit)} / ${(c.recipeUnit ?? "unit").toLowerCase()}`,
      unit: c.recipeUnit ?? "each",
      kind: "ingredient" as const,
      unitOptions: unitChoices(c.recipeUnit),
    })),
    components: allRecipes
      .filter((r) => !reachable.has(r.id))
      .map((r) => {
        const walkedSub = costs.get(r.id)
        const per = r.yieldUnit ?? PORTION_UNIT_LABEL
        return {
          id: r.id,
          name: r.itemName,
          price: walkedSub ? `${unitCost(walkedSub.totalCost)} / ${per}` : "no cost",
          unit: per,
          kind: "component" as const,
          unitOptions: r.yieldUnit ? unitChoices(r.yieldUnit) : [PORTION_UNIT_LABEL],
        }
      }),
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
    // "yields 24" said nothing: 24 of what, and is a line drawing on this
    // recipe taking one of twenty-four or the whole batch? The unit is the
    // answer and it is the difference between a sub-recipe line costing
    // cents and costing sixty dollars.
    sub:
      `${d.category} · yields ${count(d.servingSize)} ` +
      `${d.yieldUnit ?? (d.servingSize === 1 ? "portion" : "portions")} · ` +
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

/** Plain-English age of a price, for the line it sits under. */
function ageOf(date: Date | null | undefined, today: Date): { days: number; label: string } | null {
  if (!date) return null
  const days = Math.max(0, Math.round((today.getTime() - date.getTime()) / 86_400_000))
  return {
    days,
    label: days === 0 ? "today" : days === 1 ? "yesterday" : `${count(days)} days ago`,
  }
}

/**
 * A price older than this is called out on the line.
 *
 * Not a hard error and not a threshold anybody can act on directly — it is the
 * point past which "$6.20 / gal" stops being a fact about this week. Recipes
 * showed a vendor, a part number and a price with no date at all, so an owner
 * had no way to tell a figure invoiced on Tuesday from one invoiced in March.
 */
const STALE_PRICE_DAYS = 45

/** One short phrase naming what is wrong with a line, for the row itself. */
function whyMissing(l: RecipeCostLine): string | null {
  switch (l.missingReason) {
    case "no-price":
      return "no price"
    case "unit-mismatch":
      return `cannot measure ${l.unit} against ${l.costUnit ?? "its price"}`
    case "yield-mismatch":
      return l.costUnit
        ? `this batch is measured in ${l.costUnit}`
        : "this recipe is counted in servings"
    case "unresolved":
      return "nothing to cost"
    default:
      return l.missingCost ? "no price" : null
  }
}

/**
 * The builder, with every header field a CONTROL.
 *
 * All four of these used to render as `<span>`s, which is why `servingSize`
 * reads 1 on all sixty recipes: the product has never had a box to type it in.
 * `saveRecipeLines` accepts all of them and `upsertRecipe` writes all of them;
 * only the input was missing.
 *
 * The yield pair is the load-bearing one. `servingSize` with no `yieldUnit`
 * means portions; with one it means a measured batch, and a recipe that draws
 * on it takes a share rather than the whole thing. That is the difference
 * between two ounces of house sauce costing $0.47 and costing $60.
 */
export function builderOf(d: Loaded, today: Date): RecipeBuilder {
  const unitFor = (l: RecipeCostLine): string[] =>
    l.kind === "component"
      ? (d.componentUnits.get(l.refId) ?? [PORTION_UNIT_LABEL])
      : unitChoices(d.costUnitOf.get(l.refId) ?? l.costUnit ?? l.unit)

  return {
    fields: [
      { key: "itemName", label: "Recipe name", kind: "text", value: d.name },
      {
        key: "category",
        label: "Category",
        kind: "select",
        value: d.category,
        options: d.categories.map((c) => ({ value: c, label: c })),
      },
      {
        key: "servingSize",
        label: "One batch makes",
        kind: "number",
        value: String(d.servingSize),
        hint:
          d.yieldUnit
            ? `Recipes that use this one will measure it in ${d.yieldUnit}.`
            : `Portions. Recipes that use this one will count servings.`,
      },
      {
        key: "yieldUnit",
        label: "Measured in",
        kind: "select",
        value: d.yieldUnit ?? "",
        options: [
          { value: "", label: "portions" },
          ...YIELD_UNIT_CHOICES.map((u) => ({ value: u, label: u })),
        ],
      },
      {
        key: "foodCostOverride",
        label: "Cost override",
        kind: "money",
        value: d.override === null ? "" : String(d.override),
        placeholder: "None",
        // WHICH cost it overrides, which the label alone never said. The walk
        // treats it as the BATCH — everything in a recipe's body is one batch
        // and `totalCost` is what comes out after the yield divides it — so
        // on a recipe that makes 24, an override of $48 is $2.00 a serving.
        // With every recipe in this account yielding 1 the two readings are
        // the same number today, which is exactly why it has to be written
        // down before the first batch recipe is entered.
        hint:
          d.servingSize > 1 || d.yieldUnit
            ? `Used only when none of the lines below can be priced. It is the cost of the ` +
              `whole batch, so it is divided by the yield above.`
            : "Used only when none of the lines below can be priced.",
      },
      {
        key: "notes",
        label: "Notes",
        kind: "textarea",
        value: d.notes ?? "",
        placeholder: "Anything the next person should know",
      },
    ],
    lines: d.lines.map((l, i) => {
      const age = ageOf(l.sourceInvoiceDate, today)
      return {
        key: `${l.kind}:${l.refId}:${i}`,
        kind: l.kind,
        refId: l.refId,
        name: titleCase(l.name),
        sub:
          l.kind === "component"
            ? `sub-recipe · ${unitCost(l.unitCost)} / ${(l.costUnit ?? PORTION_UNIT_LABEL).toLowerCase()}`
            : [
                // A HAND-TYPED PRICE IS NOT THE VENDOR'S.
                //
                // `getCanonicalIngredientCost` pulls vendor, SKU and invoice
                // date from the most recent matched line even when the price
                // itself was typed in, and says why: for an invoice-sourced
                // canonical whose `costUpdatedAt` lags an arrival, the latest
                // invoice IS the right label. For a manual price it is not —
                // the row read "Sysco · part 3589484 · $0.33 / each · 6 days
                // ago" over a figure somebody entered by hand that has no
                // invoice behind it at all. So a manual cost says so and
                // drops the provenance it does not have.
                l.costSource === "manual" ? "entered by hand" : (l.sourceVendor ?? null),
                l.costSource === "manual" ? null : l.sourceSku ? `part ${l.sourceSku}` : null,
                l.unitCost === null
                  ? "no price"
                  : `${unitCost(l.unitCost)} / ${(l.costUnit ?? "unit").toLowerCase()}`,
                // The date the price came from. Without it a vendor and a part
                // number read as provenance when they are only a label — an
                // owner could not tell Tuesday's invoice from March's.
                l.costSource === "manual" ? null : (age?.label ?? null),
                l.yieldFactor != null && l.yieldFactor < 1
                  ? `${pct((1 - l.yieldFactor) * 100, { scaled: true })} waste`
                  : null,
              ]
                .filter(Boolean)
                .join(" · "),
        quantity: l.quantity,
        unit: l.unit,
        unitOptions: unitFor(l),
        ext: l.missingCost ? "—" : unitCost(l.lineCost),
        missing: l.missingCost,
        missingWhy: whyMissing(l),
        priceAgeDays: l.costSource === "manual" ? null : (age?.days ?? null),
      }
    }),
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
    deleteBlockedBy:
      d.usedInCount === 0
        ? null
        : d.usedInCount === 1
          ? `“${d.usedInName}” uses this as a sub-recipe.`
          : `${count(d.usedInCount)} recipes use this as a sub-recipe, starting with “${d.usedInName}”.`,
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
export function costOf(d: Loaded): RecipeCost {
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
  const handTyped = priced.filter((l) => l.costSource === "manual").length

  return {
    perServing: unitCost(d.totalCost),
    // Where the figure above came from, shown only when it was divided. Null
    // on a one-plate recipe, which is every recipe in this account today.
    batch:
      d.servingSize > 1 || d.yieldUnit
        ? `Batch ${unitCost(d.batchCost)} ÷ ${count(d.servingSize)} ${d.yieldUnit ?? (d.servingSize === 1 ? "portion" : "portions")}`
        : null,
    bands,
    money: lines,
    foot:
      (margin === null
        ? `No observed price in ${d.rangeLabel}, so there is no margin to state.`
        : `${pct(margin, { scaled: true })} margin · ${pct(100 - margin, { scaled: true })} food cost`) +
      // A MANUAL PRICE HAS NO HISTORY, and the product does not say so
      // anywhere. `getCanonicalIngredientCost` documents it — "we do not store
      // manual price history" — and then every as-of recosting of a closed
      // month reaches for the same hand-typed figure that is in force today.
      // An invoiced line recosts to what the month actually paid; a typed one
      // recosts to now, silently, and the month moves.
      (handTyped > 0
        ? ` · ${count(handTyped)} of these ${handTyped === 1 ? "prices was" : "prices were"} ` +
          `typed in rather than invoiced, and a typed price has no history — recosting a closed ` +
          `month uses today's figure for ${handTyped === 1 ? "it" : "them"}.`
        : ""),
    gap: gapOf(d, missing),
    // Stated on every recipe, priced or not — see the function's own comment.
    note:
      `Packaging is not in this cost. Across the account ${money(d.packaging.spend)} of ` +
      `containers, liners and gloves is bought and appears in no recipe. Whether that is a ` +
      `deliberate exclusion or ${count(d.packaging.n)} missing lines is a decision nobody has ` +
      `written down, and the Ingredients page reports the same figure as a gap.`,
  }
}

/**
 * What is wrong with this cost, in the order it matters.
 *
 * Three cases, where there used to be two. The one that is new is the recipe
 * that HAS lines, priced none of them, and fell back to its override — the
 * catalogue reported that as "No lines", which is a false sentence about a
 * recipe whose lines are the whole problem. `emptyWalk` means "walked to
 * nothing"; `hasLines` is what separates the two, and both now travel out of
 * the walk so a page can tell them apart.
 */
function gapOf(d: Loaded, missing: RecipeCostLine[]): RecipeCost["gap"] {
  if (d.emptyWalk && !d.hasLines) {
    return {
      lead: "no lines",
      body:
        `Nothing was costed. This recipe has no ingredient lines at all, so the ` +
        `${unitCost(d.totalCost)} above is its recipe-level override standing in for a cost ` +
        `nobody computed — not a plate cost that happens to be low.`,
    }
  }

  if (d.overrideApplied) {
    return {
      lead: "override in use",
      href: missing[0] ? `/dashboard/ingredients/${missing[0].refId}` : undefined,
      body:
        `Not one of this recipe's ${count(d.lines.length)} lines could be priced, so the ` +
        `${unitCost(d.totalCost)} above is the cost override rather than anything computed. ` +
        `Fix the lines and the override stops being used.`,
    }
  }

  if (missing.length === 0) return null

  const reasons = [...new Set(missing.map((l) => whyMissing(l)).filter(Boolean))]
  return {
    lead: `${count(missing.length)} of ${count(d.lines.length)}`,
    href: `/dashboard/ingredients/${missing[0].refId}`,
    body:
      `${missing.map((l) => titleCase(l.name)).join(", ")} could not be priced — ` +
      `${reasons.join("; ")}. So this plate costs AT LEAST ${unitCost(d.totalCost)} rather than ` +
      `exactly, and the difference is understated food cost on every one of them.`,
  }
}

function sellsAsOf(d: Loaded): RecipeSellsAs {
  return {
    links: d.posNames.map((p) => ({
      key: `${p.kind}:${p.name}`,
      name: p.name,
      kind: p.kind === "item" ? ("item" as const) : ("modifier" as const),
      stores: p.stores,
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
    builder: s((d) => builderOf(d, input.today)),
    cost: s(costOf),
    sellsAs: s(sellsAsOf),
    trend: s(trendOf),
  }
}

export async function getRecipeSections(input: RecipeInput): Promise<RecipeSections> {
  return awaitSections(getRecipeSectionPromises(input))
}
