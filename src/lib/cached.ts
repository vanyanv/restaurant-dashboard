import { cache } from "react"
import { getCanonicalIngredientCost } from "./canonical-ingredients"
import { computeRecipeCost } from "./recipe-cost"

/**
 * Per-request dedup of ingredient cost lookups. Two recipes that both use
 * "onion" resolve the price once per incoming HTTP request.
 */
export const costIngredientCached = cache(getCanonicalIngredientCost)

/**
 * Per-request dedup of recipe cost walks. Two menu items that share a
 * sub-recipe (e.g., "Burger Bun") walk it once per request.
 */
export const costRecipeCached = cache(computeRecipeCost)
