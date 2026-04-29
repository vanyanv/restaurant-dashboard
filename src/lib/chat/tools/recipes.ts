import { z } from "zod"
import { embed, toVectorLiteral } from "@/lib/chat/embeddings"
import {
  dateRangeSchema,
  parseDateRange,
  resolveStoreIds,
  storeIdsSchema,
  ymd,
} from "./_shared"
import type { ChatTool, ChatToolContext } from "./types"

/**
 * Recipe tools. Recipes are owner-level (not store-level) — `Recipe.ownerId`
 * is the only scope. The schema's `(ownerId, itemName, category)` unique
 * means a name lookup must qualify by category to be deterministic; when
 * the user gives only a name we return all matches and let the LLM pick.
 *
 * Cost computation: each `RecipeIngredient` carries either a
 * `canonicalIngredientId` (cost = quantity * canonical.costPerRecipeUnit)
 * or a `componentRecipeId` (cost = quantity * recursive total). Component
 * recipes are walked depth-first with a depth cap to prevent cycles. When
 * any leaf canonical lacks a `costPerRecipeUnit`, the line cost becomes
 * null and `fullyCosted` flips to false on the way up.
 */

const COMPONENT_DEPTH_CAP = 5

interface RecipeIngredientPayload {
  id: string
  ingredientName: string | null
  quantity: number
  unit: string
  notes: string | null
  canonicalIngredient: {
    id: string
    name: string
    costPerRecipeUnit: number | null
    recipeUnit: string | null
    defaultUnit: string
  } | null
  componentRecipe: {
    id: string
    itemName: string
  } | null
}

interface RecipePayload {
  id: string
  itemName: string
  category: string
  servingSize: number
  notes: string | null
  foodCostOverride: number | null
  isSellable: boolean
  ingredients: RecipeIngredientPayload[]
}

export type RecipeIngredientRow = {
  ingredientId: string | null
  /** What the recipe shows: canonical name, component-recipe name, or the
   *  free-text fallback. */
  name: string
  /** "canonical" | "component" | "free-text". */
  source: "canonical" | "component" | "free-text"
  quantity: number
  unit: string
  /** Cost per recipe unit when known, in dollars. */
  unitCost: number | null
  /** quantity * unitCost when both are available. */
  lineCost: number | null
  notes: string | null
}

export type RecipeResult = {
  recipeId: string
  itemName: string
  category: string
  servingSize: number
  notes: string | null
  isSellable: boolean
  /** Owner-overridden food cost; takes precedence over the computed total. */
  foodCostOverride: number | null
  /** Sum of `lineCost` across rows (component recipes resolved recursively).
   *  Null when any canonical leaf has unknown cost. */
  computedTotalCost: number | null
  /** True when every ingredient row carries a known unitCost. */
  fullyCosted: boolean
  ingredients: RecipeIngredientRow[]
}

const recipeSelect = {
  id: true,
  itemName: true,
  category: true,
  servingSize: true,
  notes: true,
  foodCostOverride: true,
  isSellable: true,
  ingredients: {
    select: {
      id: true,
      ingredientName: true,
      quantity: true,
      unit: true,
      notes: true,
      canonicalIngredient: {
        select: {
          id: true,
          name: true,
          costPerRecipeUnit: true,
          recipeUnit: true,
          defaultUnit: true,
        },
      },
      componentRecipe: {
        select: { id: true, itemName: true },
      },
    },
  },
} as const

async function loadRecipeById(
  ctx: ChatToolContext,
  id: string,
): Promise<RecipePayload | null> {
  return ctx.prisma.recipe.findFirst({
    where: { id, ownerId: ctx.ownerId },
    select: recipeSelect,
  })
}

/** Recursive cost walker. Returns `null` when any leaf canonical lacks a
 *  `costPerRecipeUnit`. Cycles are broken by `seen` + a depth cap. */
async function computeRecipeCostDeep(
  ctx: ChatToolContext,
  recipeId: string,
  seen: Set<string> = new Set(),
  depth = 0,
): Promise<number | null> {
  if (depth > COMPONENT_DEPTH_CAP || seen.has(recipeId)) return null
  const r = await loadRecipeById(ctx, recipeId)
  if (!r) return null
  if (r.foodCostOverride !== null && r.foodCostOverride !== undefined) {
    return r.foodCostOverride
  }
  if (r.ingredients.length === 0) return null
  const nextSeen = new Set(seen)
  nextSeen.add(recipeId)
  let total = 0
  for (const ri of r.ingredients) {
    let line: number | null = null
    if (ri.canonicalIngredient) {
      const unit = ri.canonicalIngredient.costPerRecipeUnit
      line = unit !== null && unit !== undefined ? unit * ri.quantity : null
    } else if (ri.componentRecipe) {
      const sub = await computeRecipeCostDeep(
        ctx,
        ri.componentRecipe.id,
        nextSeen,
        depth + 1,
      )
      line = sub !== null ? sub * ri.quantity : null
    }
    if (line === null) return null
    total += line
  }
  return total
}

async function shapeRecipe(
  ctx: ChatToolContext,
  r: RecipePayload,
): Promise<RecipeResult> {
  const componentCosts = new Map<string, number | null>()
  for (const ri of r.ingredients) {
    if (ri.componentRecipe && !componentCosts.has(ri.componentRecipe.id)) {
      const cost = await computeRecipeCostDeep(
        ctx,
        ri.componentRecipe.id,
        new Set([r.id]),
        1,
      )
      componentCosts.set(ri.componentRecipe.id, cost)
    }
  }

  let total = 0
  let allKnown = true
  const rows: RecipeIngredientRow[] = r.ingredients.map((ri) => {
    let name: string
    let source: RecipeIngredientRow["source"]
    let unitCost: number | null = null
    if (ri.canonicalIngredient) {
      name = ri.canonicalIngredient.name
      source = "canonical"
      unitCost = ri.canonicalIngredient.costPerRecipeUnit ?? null
    } else if (ri.componentRecipe) {
      name = ri.componentRecipe.itemName
      source = "component"
      unitCost = componentCosts.get(ri.componentRecipe.id) ?? null
    } else {
      name = ri.ingredientName ?? "(unnamed)"
      source = "free-text"
    }
    const lineCost = unitCost !== null ? unitCost * ri.quantity : null
    if (lineCost === null) {
      allKnown = false
    } else {
      total += lineCost
    }
    return {
      ingredientId: ri.canonicalIngredient?.id ?? null,
      name,
      source,
      quantity: ri.quantity,
      unit: ri.unit,
      unitCost,
      lineCost,
      notes: ri.notes,
    }
  })
  return {
    recipeId: r.id,
    itemName: r.itemName,
    category: r.category,
    servingSize: r.servingSize,
    notes: r.notes,
    isSellable: r.isSellable,
    foodCostOverride: r.foodCostOverride,
    computedTotalCost: rows.length > 0 && allKnown ? total : null,
    fullyCosted: rows.length > 0 && allKnown,
    ingredients: rows,
  }
}

const searchParams = z
  .object({
    query: z
      .string()
      .min(1)
      .describe(
        "Natural-language description of the built recipe (e.g. 'cheese burger', 'milkshake', 'spicy slider'). Vector search — phrasing does not need to match the recipe's exact name.",
      ),
    limit: z.number().int().min(1).max(20).optional().default(10),
  })
  .strict()

export type RecipeSearchRow = {
  recipeId: string
  itemName: string
  category: string
  isSellable: boolean
  /** Cosine similarity 0..1 — higher is more relevant. */
  score: number
}

export const searchRecipes: ChatTool<typeof searchParams, RecipeSearchRow[]> = {
  name: "searchRecipes",
  description:
    "Vector search across the owner's built recipes. Use this when the user's phrasing doesn't exactly match a recipe name (e.g. 'cheese burger' → 'Smash Burger', 'milkshake' → 'OREO COOKIE SHAKE'). Returns the top hits with cosine similarity scores; pair with getRecipeById to load one in full.",
  parameters: searchParams,
  async execute(args, ctx) {
    const vec = await embed(args.query)
    const lit = toVectorLiteral(vec)

    const rows = await ctx.prisma.$queryRawUnsafe<
      Array<{
        recipeId: string
        itemName: string
        category: string
        isSellable: boolean
        score: number
      }>
    >(
      `SELECT e."recipeId",
              e."itemName",
              e."category",
              r."isSellable",
              (1 - (e.embedding <=> $1::vector))::float8 AS score
         FROM "RecipeEmbedding" e
         JOIN "Recipe" r ON r.id = e."recipeId"
        WHERE e."ownerId" = $2
        ORDER BY e.embedding <=> $1::vector
        LIMIT $3`,
      lit,
      ctx.ownerId,
      args.limit ?? 10,
    )

    return rows.map((r) => ({
      recipeId: r.recipeId,
      itemName: r.itemName,
      category: r.category,
      isSellable: r.isSellable,
      score: Number(r.score),
    }))
  },
}

const byNameParams = z
  .object({
    name: z.string().min(1).describe("Exact recipe item name (case-insensitive)."),
    category: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional category to disambiguate when two recipes share a name across categories.",
      ),
  })
  .strict()

export const getRecipeByName: ChatTool<typeof byNameParams, RecipeResult | null> = {
  name: "getRecipeByName",
  description:
    "Fetches one recipe by its exact item name (case-insensitive). When a name is ambiguous across categories, pass `category` to narrow it. Use this when the user asks 'show me the burger recipe' / 'what's in the slider'.",
  parameters: byNameParams,
  async execute(args, ctx) {
    const matches = await ctx.prisma.recipe.findMany({
      where: {
        ownerId: ctx.ownerId,
        itemName: { equals: args.name, mode: "insensitive" },
        ...(args.category
          ? { category: { equals: args.category, mode: "insensitive" } }
          : {}),
      },
      select: recipeSelect,
      take: 2,
    })
    if (matches.length === 0) return null
    return shapeRecipe(ctx, matches[0]!)
  },
}

const byIdParams = z
  .object({
    id: z.string().min(1).describe("The Recipe id (cuid)."),
  })
  .strict()

export const getRecipeById: ChatTool<typeof byIdParams, RecipeResult | null> = {
  name: "getRecipeById",
  description:
    "Fetches one recipe by id with its ingredient breakdown and computed total food cost. Component sub-recipes are resolved recursively (depth ≤ 5). Honors `foodCostOverride` when set. Returns null when the recipe isn't owned by the caller.",
  parameters: byIdParams,
  async execute(args, ctx) {
    const r = await loadRecipeById(ctx, args.id)
    return r ? shapeRecipe(ctx, r) : null
  },
}

const marginParams = z
  .object({
    recipeId: z.string().min(1).describe("The Recipe id whose margin to compute."),
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema
      .optional()
      .describe("Optional sales window. Defaults to the last 30 days."),
  })
  .strict()

export type MenuMarginResult = {
  recipeId: string
  itemName: string
  category: string
  /** Recipe food cost (override if set, else recursive sum). Null when unknown. */
  recipeCost: number | null
  /** Avg implied selling price across mapped Otter items in the date window. */
  avgSellingPrice: number | null
  marginDollars: number | null
  marginPct: number | null
  qtySold: number
  totalRevenue: number
  dateRange: { from: string; to: string }
  /** Otter item names mapped to this recipe via OtterItemMapping. Empty when
   *  no mapping exists (the message will say so). */
  mappedOtterItems: string[]
  /** Human-readable note when math is incomplete. */
  note: string | null
}

export const getMenuMargin: ChatTool<typeof marginParams, MenuMarginResult> = {
  name: "getMenuMargin",
  description:
    "Computes the margin on one Recipe by joining its Otter item mappings (OtterItemMapping → OtterMenuItem aggregates). Returns recipe cost, average implied selling price, and margin in dollars + percent across the date window. Use this for 'what's the margin on the smash burger?' / 'how profitable is the chicken sandwich?'. Returns a clear note when the recipe has no Otter mapping or no sales in the window.",
  parameters: marginParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const range = args.dateRange
      ? parseDateRange(args.dateRange)
      : (() => {
          const to = new Date()
          const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
          return { from, to }
        })()

    const recipe = await ctx.prisma.recipe.findFirst({
      where: { id: args.recipeId, ownerId: ctx.ownerId },
      select: { id: true, itemName: true, category: true, foodCostOverride: true },
    })
    if (!recipe) {
      return {
        recipeId: args.recipeId,
        itemName: "",
        category: "",
        recipeCost: null,
        avgSellingPrice: null,
        marginDollars: null,
        marginPct: null,
        qtySold: 0,
        totalRevenue: 0,
        dateRange: { from: ymd(range.from), to: ymd(range.to) },
        mappedOtterItems: [],
        note: "Recipe not found or not owned by this user.",
      }
    }

    const recipeCost = await computeRecipeCostDeep(ctx, recipe.id)

    const mappings = await ctx.prisma.otterItemMapping.findMany({
      where: { recipeId: recipe.id, storeId: { in: storeIds } },
      select: { otterItemName: true, storeId: true },
    })

    if (mappings.length === 0) {
      return {
        recipeId: recipe.id,
        itemName: recipe.itemName,
        category: recipe.category,
        recipeCost,
        avgSellingPrice: null,
        marginDollars: null,
        marginPct: null,
        qtySold: 0,
        totalRevenue: 0,
        dateRange: { from: ymd(range.from), to: ymd(range.to) },
        mappedOtterItems: [],
        note: "No Otter item mapping for this recipe — connect it in the menu mapper to compute margin.",
      }
    }

    const mappedNames = Array.from(new Set(mappings.map((m) => m.otterItemName)))
    const sales = await ctx.prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: storeIds },
        isModifier: false,
        date: { gte: range.from, lte: range.to },
        OR: mappings.map((m) => ({
          storeId: m.storeId,
          itemName: m.otterItemName,
        })),
      },
      select: {
        fpQuantitySold: true,
        fpTotalSales: true,
        tpQuantitySold: true,
        tpTotalSales: true,
      },
    })

    let qty = 0
    let revenue = 0
    for (const s of sales) {
      qty += (s.fpQuantitySold ?? 0) + (s.tpQuantitySold ?? 0)
      revenue += (s.fpTotalSales ?? 0) + (s.tpTotalSales ?? 0)
    }

    if (qty === 0) {
      return {
        recipeId: recipe.id,
        itemName: recipe.itemName,
        category: recipe.category,
        recipeCost,
        avgSellingPrice: null,
        marginDollars: null,
        marginPct: null,
        qtySold: 0,
        totalRevenue: 0,
        dateRange: { from: ymd(range.from), to: ymd(range.to) },
        mappedOtterItems: mappedNames,
        note: "No sales in the date window.",
      }
    }

    const avgSellingPrice = revenue / qty
    const marginDollars =
      recipeCost !== null ? avgSellingPrice - recipeCost : null
    const marginPct =
      marginDollars !== null && avgSellingPrice > 0
        ? (marginDollars / avgSellingPrice) * 100
        : null

    return {
      recipeId: recipe.id,
      itemName: recipe.itemName,
      category: recipe.category,
      recipeCost,
      avgSellingPrice,
      marginDollars,
      marginPct,
      qtySold: qty,
      totalRevenue: revenue,
      dateRange: { from: ymd(range.from), to: ymd(range.to) },
      mappedOtterItems: mappedNames,
      note:
        recipeCost === null
          ? "Selling price computed; recipe cost unknown (some ingredients lack a costPerRecipeUnit)."
          : null,
    }
  },
}

const rankParams = z
  .object({
    by: z
      .enum(["cost", "margin"])
      .describe(
        "Rank dimension. 'cost' ranks by computed recipe food cost (no sales required). 'margin' ranks by implied margin in dollars and requires Otter mappings + sales in the date window.",
      ),
    direction: z.enum(["asc", "desc"]).optional().default("desc"),
    limit: z.number().int().min(1).max(50).optional().default(10),
    storeIds: storeIdsSchema,
    dateRange: dateRangeSchema
      .optional()
      .describe("Sales window for margin ranking. Defaults to last 30 days. Ignored when by='cost'."),
  })
  .strict()

export type RankRecipesRow = {
  recipeId: string
  itemName: string
  category: string
  recipeCost: number | null
  avgSellingPrice: number | null
  marginDollars: number | null
  marginPct: number | null
  qtySold: number
}

export const rankRecipes: ChatTool<typeof rankParams, RankRecipesRow[]> = {
  name: "rankRecipes",
  description:
    "Ranks the owner's recipes by computed food cost or by margin. Use this for 'highest-cost recipes' / 'lowest-margin items' / 'most expensive things to make'. Margin mode requires recipes to have an OtterItemMapping with sales in the window — recipes without mappings are dropped.",
  parameters: rankParams,
  async execute(args, ctx) {
    const storeIds = await resolveStoreIds(ctx, args.storeIds)
    const recipes = await ctx.prisma.recipe.findMany({
      where: { ownerId: ctx.ownerId, isSellable: true },
      select: { id: true, itemName: true, category: true },
    })

    const costs = new Map<string, number | null>()
    for (const r of recipes) {
      costs.set(r.id, await computeRecipeCostDeep(ctx, r.id))
    }

    if (args.by === "cost") {
      const rows: RankRecipesRow[] = recipes
        .map((r) => ({
          recipeId: r.id,
          itemName: r.itemName,
          category: r.category,
          recipeCost: costs.get(r.id) ?? null,
          avgSellingPrice: null,
          marginDollars: null,
          marginPct: null,
          qtySold: 0,
        }))
        .filter((r) => r.recipeCost !== null)
      rows.sort((a, b) => {
        const av = a.recipeCost ?? 0
        const bv = b.recipeCost ?? 0
        return args.direction === "asc" ? av - bv : bv - av
      })
      return rows.slice(0, args.limit ?? 10)
    }

    // margin mode
    const range = args.dateRange
      ? parseDateRange(args.dateRange)
      : (() => {
          const to = new Date()
          const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
          return { from, to }
        })()

    const mappings = await ctx.prisma.otterItemMapping.findMany({
      where: {
        storeId: { in: storeIds },
        recipeId: { in: recipes.map((r) => r.id) },
      },
      select: { recipeId: true, storeId: true, otterItemName: true },
    })
    if (mappings.length === 0) return []

    const sales = await ctx.prisma.otterMenuItem.findMany({
      where: {
        storeId: { in: storeIds },
        isModifier: false,
        date: { gte: range.from, lte: range.to },
        OR: mappings.map((m) => ({
          storeId: m.storeId,
          itemName: m.otterItemName,
        })),
      },
      select: {
        storeId: true,
        itemName: true,
        fpQuantitySold: true,
        fpTotalSales: true,
        tpQuantitySold: true,
        tpTotalSales: true,
      },
    })

    type Bucket = { qty: number; revenue: number }
    const byMappingKey = new Map<string, Bucket>()
    for (const s of sales) {
      const key = `${s.storeId}|${s.itemName}`
      const cur = byMappingKey.get(key) ?? { qty: 0, revenue: 0 }
      cur.qty += (s.fpQuantitySold ?? 0) + (s.tpQuantitySold ?? 0)
      cur.revenue += (s.fpTotalSales ?? 0) + (s.tpTotalSales ?? 0)
      byMappingKey.set(key, cur)
    }

    const recipeAgg = new Map<string, Bucket>()
    for (const m of mappings) {
      const key = `${m.storeId}|${m.otterItemName}`
      const b = byMappingKey.get(key)
      if (!b) continue
      const cur = recipeAgg.get(m.recipeId) ?? { qty: 0, revenue: 0 }
      cur.qty += b.qty
      cur.revenue += b.revenue
      recipeAgg.set(m.recipeId, cur)
    }

    const rows: RankRecipesRow[] = []
    for (const r of recipes) {
      const agg = recipeAgg.get(r.id)
      if (!agg || agg.qty === 0) continue
      const cost = costs.get(r.id) ?? null
      const avgPrice = agg.revenue / agg.qty
      const marginDollars = cost !== null ? avgPrice - cost : null
      const marginPct =
        marginDollars !== null && avgPrice > 0
          ? (marginDollars / avgPrice) * 100
          : null
      rows.push({
        recipeId: r.id,
        itemName: r.itemName,
        category: r.category,
        recipeCost: cost,
        avgSellingPrice: avgPrice,
        marginDollars,
        marginPct,
        qtySold: agg.qty,
      })
    }
    rows.sort((a, b) => {
      const av = a.marginDollars ?? Number.NEGATIVE_INFINITY
      const bv = b.marginDollars ?? Number.NEGATIVE_INFINITY
      return args.direction === "asc" ? av - bv : bv - av
    })
    return rows.slice(0, args.limit ?? 10)
  },
}

const byCategoryParams = z
  .object({
    category: z
      .string()
      .min(1)
      .describe("Recipe category (case-insensitive). E.g. 'sandwiches', 'sides', 'shakes'."),
    sellableOnly: z.boolean().optional().default(true),
  })
  .strict()

export type RecipeByCategoryRow = {
  recipeId: string
  itemName: string
  category: string
  isSellable: boolean
  servingSize: number
  ingredientCount: number
}

export const listRecipesByCategory: ChatTool<typeof byCategoryParams, RecipeByCategoryRow[]> = {
  name: "listRecipesByCategory",
  description:
    "Lists every recipe in a given category. Use this for 'show me my sandwiches' / 'list all sides' / 'what shakes do we have'. By default returns sellable items only; pass sellableOnly=false to include sub-recipes / components.",
  parameters: byCategoryParams,
  async execute(args, ctx) {
    const rows = await ctx.prisma.recipe.findMany({
      where: {
        ownerId: ctx.ownerId,
        category: { equals: args.category, mode: "insensitive" },
        ...(args.sellableOnly === false ? {} : { isSellable: true }),
      },
      select: {
        id: true,
        itemName: true,
        category: true,
        isSellable: true,
        servingSize: true,
        _count: { select: { ingredients: true } },
      },
      orderBy: { itemName: "asc" },
    })
    return rows.map((r) => ({
      recipeId: r.id,
      itemName: r.itemName,
      category: r.category,
      isSellable: r.isSellable,
      servingSize: r.servingSize,
      ingredientCount: r._count.ingredients,
    }))
  },
}
