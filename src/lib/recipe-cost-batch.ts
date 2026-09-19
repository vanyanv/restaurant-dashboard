/**
 * Re-export shim. The implementation moved to `@/lib/recipe-cost`.
 *
 * This module used to hold a SECOND `batchRecipeCosts` — same exported name,
 * different module path, different behaviour. It never flagged the price-spike
 * guard, it reported no `emptyWalk` so a $0.00 override could not be told
 * apart from a real cost, and it treated a missing component recipe as a
 * harmless zero where the other one threw. Which of the two a page got was
 * decided by which path it happened to import: the recipes and ingredient
 * pages took one, the orders adapter and `listRecipes` took the other.
 *
 * `recipe-cost.ts` now owns the only walk in the product, and this path stays
 * so the eight existing import sites keep working. Per
 * `docs/refactor-playbook.md` step 7 a shim must NOT carry `"use server"` —
 * the bundler erases re-exports under it and the build fails with "the module
 * has no exports at all". There is none here, and there must not be.
 *
 * The old return type was `{ totalCost, partial }`; `RecipeCostResult` is a
 * superset, so every caller reads the same two fields off a richer object.
 */
export { batchRecipeCosts } from "@/lib/recipe-cost"
export type { RecipeCostResult } from "@/lib/recipe-cost"
