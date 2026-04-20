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

/**
 * Tag constants used by `revalidateTag` callers in mutation paths. The
 * corresponding `unstable_cache` wrappers that consumed these tags were
 * removed because Next.js 16 forbids `headers()`/`cookies()` access inside
 * a cached function, and the underlying loaders (`listRecipes`,
 * `getMenuPerformanceAnalytics`) auth via `getServerSession` internally.
 *
 * Kept as a stable identifier namespace so mutation paths can keep emitting
 * `revalidateTag` calls; if the cache layer is re-introduced with
 * ownerId-parameterized raw loaders, no mutation-path churn is needed.
 */
export const MENU_TAGS = {
  performance: (storeIdOrAll: string) => `menu:perf:${storeIdOrAll}`,
  catalog: (ownerId: string) => `menu:catalog:${ownerId}`,
  recipes: (ownerId: string) => `recipes:${ownerId}`,
} as const
