# Menu Pages — Performance Design

## Context

Three routes under `/dashboard/menu` feel slow on both **cold navigation** and
**in-page interactions** (date/store/filter changes, tab switches):

1. `/dashboard/menu` — analytics page with KPIs, trend, heatmap, ranking race,
   channel chart, items table.
2. `/dashboard/menu/catalog` — sortable item catalog (~100+ items typical).
3. `/dashboard/menu/catalog/[id]` — item deep-dive.

Investigation (see appendix) found the hot spots:

| # | Issue | Severity |
|---|---|---|
| 1 | `/catalog/[id]` calls `listRecipes()` — which re-costs every recipe — to read a single item's summary | **Critical** |
| 2 | `listRecipes()` fires `computeRecipeCost()` per recipe. Each cost walk hits the DB once per ingredient. ~240–300 queries per catalog load is typical. | High |
| 3 | No request-level or cross-request caching. Every navigation re-fetches and re-computes everything. | High |
| 4 | Analytics page ships ~470 KB of JSON and always-loaded Recharts + Framer Motion bundles | Medium |
| 5 | `MenuItemsTable` renders 500+ DOM rows (no virtualization) | Medium |
| 6 | Chart props aren't memoized; any filter change cascades a full re-render of every chart | Medium |
| 7 | `OtterMenuItem` / `OtterMenuCategory` lack a composite `@@index([storeId, date])` | Low |

The chosen approach is **Approach B — request-level caching plus a Next.js
data-cache layer plus targeted client fixes**. Approach C (rewriting
`computeRecipeCost` as a batched operation) is deferred because B is expected to
remove the user-perceivable pain at ~1/3 the risk.

## Goals

- Cold navigation to any menu page: **server work under 400 ms** on a repeat
  visit (cache hit) and under 1 s on a cold visit.
- Tab switch and filter change inside Menu Performance: **no perceptible delay
  beyond a fade transition**.
- `/catalog/[id]` navigation from the catalog: **near-instant** — the only
  remaining work should be fetching the one recipe plus its cost tree.

Success is measured by (a) `console.time` in the server loaders before/after,
and (b) Chrome DevTools Performance panel: scripting time on filter change,
JS bundle size on initial load, DOM-node count in the items table.

## Non-goals

- Rewriting `computeRecipeCost` to be batched (Approach C).
- Converting the menu pages to streaming / partial hydration.
- Server-side pagination / filtering of `allItems` — virtualization handles
  500-row scale without it.
- Changes to `/dashboard/menu` that would affect the new editorial detail view
  beyond client memoization.

## Design

### Component 1 — `src/lib/cached.ts` (new)

A single module that owns every caching boundary we introduce. Having all tags
and cache functions here prevents the cache-invalidation surface from leaking
across files.

```ts
import { cache } from "react"
import { unstable_cache } from "next/cache"

// Per-request dedup: calling the same ingredient cost N times in one request
// only hits the DB once.
export const costIngredientCached = cache(getCanonicalIngredientCost)
export const costRecipeCached = cache(computeRecipeCost)

export const MENU_TAGS = {
  performance: (storeId: string) => `menu:perf:${storeId}`,
  catalog: (ownerId: string) => `menu:catalog:${ownerId}`,
  recipes: (ownerId: string) => `recipes:${ownerId}`,
}

export const cachedMenuPerformance = unstable_cache(
  async (storeId: string, range: { startDate: string; endDate: string }) =>
    getMenuPerformanceAnalyticsRaw(storeId, range),
  ["menu-perf-v1"],
  { tags: [/* resolved at runtime */], revalidate: 300 }
)

export const cachedCatalogBundle = unstable_cache(
  async (ownerId: string) =>
    loadCatalogBundleRaw(ownerId), // listRecipes + sellPrices + mappings
  ["menu-catalog-v1"],
  { tags: [/* resolved at runtime */], revalidate: 300 }
)
```

Notes:
- Two layers: `React.cache` for in-request dedup; `unstable_cache` for
  cross-request/TTL caching. The first costs nothing structurally and always
  helps. The second is the "feels instant" layer.
- `revalidate: 300` (5 min) is a backstop. The primary invalidation is
  tag-driven from mutations.
- Dynamic tags (`menu:perf:${storeId}`) require constructing the cache fn
  per-call. Implementation uses a factory:
  ```ts
  const cached = unstable_cache(fn, key, { tags: [MENU_TAGS.performance(storeId)], revalidate: 300 })
  return cached(storeId, range)
  ```
  Pattern already in use in other Next 15 apps; the `key` array includes the
  dynamic values so the cache entry itself is correctly keyed.

### Component 2 — Detail-page loader cleanup

Problem: [`src/app/dashboard/menu/catalog/[id]/page.tsx`][detail-page] calls
`listRecipes()` just to read the summary row (ingredient count, partial flag,
cost). That re-costs *every* recipe on the owner.

Solution: new thin action in
[`src/app/actions/recipe-actions.ts`][recipe-actions]:

```ts
export async function getRecipeCatalogSummary(
  recipeId: string
): Promise<MenuCatalogRow | null>
```

This returns the single `MenuCatalogRow` the detail page needs: the recipe
metadata, the computed cost (via `costRecipeCached`), and the resolved sell
price (via the same reverse-lookup the catalog page does, but scoped to the one
recipe and its mappings).

`/catalog/[id]/page.tsx` is simplified to:
```ts
const [summary, detail] = await Promise.all([
  getRecipeCatalogSummary(id),
  getRecipeDetail(id),
])
```

Expected impact: from ~300 DB queries to ~10 for a detail navigation.

### Component 3 — Cache invalidation wiring

Mutation paths that change menu data already call `revalidatePath`. We extend
each of them to also call `revalidateTag` for the appropriate tag. Known call
sites from the investigation:

- Otter sync handlers — `revalidateTag(MENU_TAGS.performance(storeId))` and
  `revalidateTag(MENU_TAGS.catalog(ownerId))`.
- `upsertRecipe` / recipe deletion — `revalidateTag(MENU_TAGS.recipes(ownerId))`
  and `revalidateTag(MENU_TAGS.catalog(ownerId))`.
- Ingredient / canonical-price edits — `revalidateTag(MENU_TAGS.recipes(ownerId))`.

A tag never fires unless its data is actually stale. The pattern is to call
`revalidateTag` immediately after the DB mutation completes, same transaction
boundary as the existing `revalidatePath`.

### Component 4 — Client-side rendering

Three focused changes in
[`menu-performance-content.tsx`][perf-content] and the four charts:

1. **Memoize chart props.** Inside `MenuPerformanceContent`, wrap each chart's
   data in `useMemo` with `[data]` as the only dependency. Without this, the
   `setData(result)` after a date-range change creates new array references
   and every chart re-renders.
2. **`React.memo` the charts.** `MenuDailyTrendChart`, `CategoryBreakdownChart`,
   `ItemHeatmap`, `RankingRaceChart`, `ChannelComparisonChart`, `MenuKpiCards`.
   With stable props, they skip re-render.
3. **Dynamic-import the inactive-tab charts.** `ItemHeatmap`,
   `RankingRaceChart`, `ChannelComparisonChart` become `next/dynamic(...,
   { ssr: false, loading: () => <ChartSkeleton /> })`. The Items tab (default)
   stays eager so the first paint isn't blank.

### Component 5 — Items table virtualization

[`src/components/analytics/menu-items-table.tsx`][items-table] currently
renders every row. With `@tanstack/react-virtual`:
- Wrap the table body in a virtualizer keyed to the sorted rows.
- Header and sort UI stay unchanged.
- Fixed row height (estimated once from the current row markup); no dynamic
  measurement needed.

This drops DOM node count from ~500 rows × ~6 columns (~3,000 nodes) to ~30 × 6
(~180 nodes) at typical scroll position. `@tanstack/react-virtual` is not
currently installed — add it (~4 KB gzipped).

### Component 6 — DB indexes

One Prisma migration. `OtterMenuItem` and `OtterMenuCategory` are queried
by `where: { storeId, date: { gte, lte } }` in the performance path. Replace
the two single-column indexes with a composite:

```prisma
model OtterMenuItem {
  // -- remove:
  //   @@index([storeId])
  //   @@index([date])
  // -- add:
  @@index([storeId, date])
}

model OtterMenuCategory {
  // same swap
  @@index([storeId, date])
}
```

Single-column `@@index([storeId])` is no longer needed because a composite
on `(storeId, date)` can serve `WHERE storeId = ?` queries. `@@index([date])`
is kept only if there's a date-only query path — investigation didn't find
one, so it can be dropped.

### Data flow diagram

```
 Browser request
       ↓
 /dashboard/menu page.tsx        ← server component
       ↓  (awaits)
 cachedMenuPerformance(store, range)
       ↓  (cache hit?)
      yes → return memoized JSON ────────────┐
       ↓  no                                  │
 getMenuPerformanceAnalyticsRaw               │
       ↓                                      │
 prisma queries (indexed on storeId+date)     │
       ↓                                      │
 in-memory aggregate                          │
       ↓                                      │
 write to data cache (tag: menu:perf:<store>) │
       ↓                                      │
 ─────────────────────────────────────────────┘
       ↓
 MenuPerformanceContent (client)
   • useMemo on each chart's slice of data
   • React.memo on each chart
   • next/dynamic for inactive-tab charts
   • virtualized items table
```

## Implementation order

1. DB indexes (smallest blast radius, easy to roll back).
2. Request-level `React.cache` wrappers (no behavioral change, pure win).
3. Detail-page cleanup (`getRecipeCatalogSummary` + call-site swap).
4. Client memoization + dynamic imports + virtualization.
5. `unstable_cache` wrappers + `revalidateTag` wiring (highest risk of cache
   staleness bugs — land last so earlier wins aren't blocked).

Each step is a separate commit. If cache staleness shows up in step 5, we can
revert just that commit without losing 1–4.

## Verification

Baseline the three pages before landing anything. For each loader, add a
`console.time` around the top-level server work and record p50/p95 over ~10
navigations on a dev DB snapshot.

After each step:

- **Step 1 (indexes):** `EXPLAIN ANALYZE` the
  `OtterMenuItem.findMany({ where: { storeId, date: {...} } })` query before
  and after. Expect index scan on the composite.
- **Step 2 (React.cache):** On `/catalog`, log cost-fn call counts with a
  counter — expect a large drop (many recipes share sub-recipes /
  ingredients).
- **Step 3 (detail cleanup):** Navigate to `/catalog/[id]` from the catalog.
  Server time should drop to near the cost of `getRecipeDetail` alone.
- **Step 4 (client):**
  - DevTools → React Profiler. Change date range. Before: every chart
    re-renders. After: only the charts whose data slice changed.
  - DevTools → Network → JS transfer size on initial `/dashboard/menu`.
    Expect ~200 KB less JS on first paint.
  - Elements panel on `/catalog` with ≥100 items: count `<li>` in the list —
    should be ≤~30 visible.
- **Step 5 (data cache):** Open `/dashboard/menu`, note p95 server time. Hit
  it again within 5 min — expect cache hit (`console.time` ≤ 10 ms). Run an
  Otter sync → immediately reload → confirm fresh data (cache was invalidated
  by tag).

No new automated tests are added. The existing typecheck must pass after each
commit; if the codebase gains a perf test harness later, migrate the
measurements into it.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| `unstable_cache` serves stale data after a mutation path we missed | Ship A-level fixes before the cache layer; fall back to a 60 s `revalidate` if tag coverage is incomplete. |
| `React.cache` wrappers change observable behavior (e.g. race conditions within a single request tree) | Cost functions are already pure given the same inputs; the snapshot confirms the only difference is dedup. |
| Virtualization breaks keyboard navigation / shadcn Table styling | The existing table is shadcn-based; virtualization requires rendering a plain `<div>` scroller. Keep the header as a non-virtualized shadcn `<Table>` on top of a virtualized body. |
| Dynamic imports cause a visible loading state on slow tab switch | Each dynamic chart is wrapped in `<ChartSkeleton />`; the skeleton matches the final chart's footprint. |

Every step is independently revertable via `git revert <commit>`.

## Appendix — baseline investigation

The baseline snapshot (collected during brainstorming) is summarized in the
Context table. Key anchors:

- [`getMenuPerformanceAnalytics`][get-menu-perf] — line ~784 of
  `store-actions.ts`, returns `MenuPerformanceData`.
- [`computeRecipeCost`][compute-cost] — line ~54 of `src/lib/recipe-cost.ts`;
  per-call `memo` map, no cross-call caching.
- [`listRecipes`][list-recipes] — `src/app/actions/recipe-actions.ts:40`;
  `Promise.all(recipes.map(r => computeRecipeCost(r.id)))`.
- [Detail page loader][detail-page] — `/catalog/[id]/page.tsx` calls
  `listRecipes()` unnecessarily.

[detail-page]: ../../../src/app/dashboard/menu/catalog/%5Bid%5D/page.tsx
[recipe-actions]: ../../../src/app/actions/recipe-actions.ts
[perf-content]: ../../../src/app/dashboard/menu/components/menu-performance-content.tsx
[items-table]: ../../../src/components/analytics/menu-items-table.tsx
[get-menu-perf]: ../../../src/app/actions/store-actions.ts
[compute-cost]: ../../../src/lib/recipe-cost.ts
[list-recipes]: ../../../src/app/actions/recipe-actions.ts
