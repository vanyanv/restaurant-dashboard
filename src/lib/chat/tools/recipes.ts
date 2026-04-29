import { z } from "zod"
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
 * recipes are followed one level deep on read; we don't try to resolve
 * arbitrary nesting in the chat tool — `null` totals propagate up so the
 * UI can render "—" instead of inventing a number.
 */

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
  /** Sum of `lineCost` across rows. Null when any row has unknown cost. */
  computedTotalCost: number | null
  /** True when every ingredient row carries a known unitCost. */
  fullyCosted: boolean
  ingredients: RecipeIngredientRow[]
}

function shapeRecipe(r: RecipePayload): RecipeResult {
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
      // We deliberately don't cost component recipes here — that's a
      // recursive walk best left to the cogs materializer. Surface as
      // unknown so the UI shows "—" rather than inventing a number.
      unitCost = null
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

const searchParams = z
  .object({
    query: z
      .string()
      .min(1)
      .describe(
        "Substring on recipe item name (case-insensitive). E.g. 'burger', 'shake'.",
      ),
    limit: z.number().int().min(1).max(20).optional().default(10),
  })
  .strict()

export type RecipeSearchRow = {
  recipeId: string
  itemName: string
  category: string
  isSellable: boolean
  ingredientCount: number
}

export const searchRecipes: ChatTool<typeof searchParams, RecipeSearchRow[]> = {
  name: "searchRecipes",
  description:
    "Substring search across the owner's recipes by item name. Use this when the user asks 'do we have a recipe for X' or wants to browse recipes by a partial name. Returns the matches with category and ingredient count; pair with getRecipeById to load a single one.",
  parameters: searchParams,
  async execute(args, ctx) {
    const rows = await ctx.prisma.recipe.findMany({
      where: {
        ownerId: ctx.ownerId,
        itemName: { contains: args.query, mode: "insensitive" },
      },
      select: {
        id: true,
        itemName: true,
        category: true,
        isSellable: true,
        _count: { select: { ingredients: true } },
      },
      orderBy: { itemName: "asc" },
      take: args.limit ?? 10,
    })
    return rows.map((r) => ({
      recipeId: r.id,
      itemName: r.itemName,
      category: r.category,
      isSellable: r.isSellable,
      ingredientCount: r._count.ingredients,
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
    // If two recipes match the name and the caller didn't disambiguate, we
    // just return the first by id-order; the LLM is encouraged via system
    // prompt to ask for category when it sees an ambiguous answer.
    return shapeRecipe(matches[0]!)
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
    "Fetches one recipe by id with its ingredient breakdown and computed total food cost. Returns null when not owned by the caller.",
  parameters: byIdParams,
  async execute(args, ctx) {
    const r = await loadRecipeById(ctx, args.id)
    return r ? shapeRecipe(r) : null
  },
}
