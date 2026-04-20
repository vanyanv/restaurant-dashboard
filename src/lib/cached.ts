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

import { unstable_cache } from "next/cache"
import type { MenuPerformanceData } from "@/types/analytics"

export const MENU_TAGS = {
  performance: (storeIdOrAll: string) => `menu:perf:${storeIdOrAll}`,
  catalog: (ownerId: string) => `menu:catalog:${ownerId}`,
  recipes: (ownerId: string) => `recipes:${ownerId}`,
} as const

type PerfOptions = { days?: number; startDate?: string; endDate?: string }

/**
 * Cache key includes storeId + date range so every distinct call gets its own
 * entry. Tag-based invalidation is scoped to the store (Task 7c wires this
 * into mutation paths).
 */
export function cachedMenuPerformance(
  loader: (
    storeId: string | undefined,
    options?: PerfOptions
  ) => Promise<MenuPerformanceData | null>,
  storeId: string | undefined,
  options?: PerfOptions
): Promise<MenuPerformanceData | null> {
  const storeKey = storeId ?? "all"
  const rangeKey =
    options?.startDate && options?.endDate
      ? `${options.startDate}:${options.endDate}`
      : `days:${options?.days ?? 7}`
  const cached = unstable_cache(
    () => loader(storeId, options),
    ["menu-perf-v1", storeKey, rangeKey],
    {
      tags: [MENU_TAGS.performance(storeKey), MENU_TAGS.performance("all")],
      revalidate: 300,
    }
  )
  return cached()
}

import { listRecipes } from "@/app/actions/recipe-actions"
import {
  getMenuItemSellPrices,
  getMenuItemsForCatalog,
} from "@/app/actions/menu-item-actions"

type CatalogBundle = {
  recipes: Awaited<ReturnType<typeof listRecipes>>
  sellPrices: Awaited<ReturnType<typeof getMenuItemSellPrices>>
  otterMappings: Awaited<ReturnType<typeof getMenuItemsForCatalog>>
}

/**
 * Bundle the three catalog-page queries into one cached fetch. Keyed per owner;
 * tagged for invalidation from recipe edits (Task 7c).
 */
export function cachedCatalogBundle(ownerId: string): Promise<CatalogBundle> {
  const cached = unstable_cache(
    async () => {
      const [recipes, sellPrices, otterMappings] = await Promise.all([
        listRecipes(),
        getMenuItemSellPrices(30),
        getMenuItemsForCatalog(),
      ])
      return { recipes, sellPrices, otterMappings }
    },
    ["menu-catalog-bundle-v1", ownerId],
    {
      tags: [MENU_TAGS.catalog(ownerId), MENU_TAGS.recipes(ownerId)],
      revalidate: 300,
    }
  )
  return cached()
}
