# Menu Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three menu pages (`/dashboard/menu`, `/dashboard/menu/catalog`, `/dashboard/menu/catalog/[id]`) feel snappy on both cold load and in-page interactions.

**Architecture:** Two-layer caching (per-request `React.cache` for deduping cost computations + `unstable_cache` for cross-request data caching with tag-based invalidation), a narrow detail-page loader, composite DB index, and three targeted client fixes (chart memoization, dynamic import of inactive-tab charts, items-table virtualization).

**Tech Stack:** Next.js 15 (App Router), React 19, Prisma + PostgreSQL, TanStack Virtual, Recharts, Framer Motion.

**Testing note:** This repo has no test harness (`package.json` has no `test` script). Each task uses `npx tsc --noEmit` plus an explicit manual verification step as its test. Where a pure function is introduced, inline assertion scripts run via `npx tsx` are used as a lightweight substitute for unit tests.

**Reference spec:** [`docs/superpowers/specs/2026-04-20-menu-performance-design.md`](../specs/2026-04-20-menu-performance-design.md)

---

## Task 1: Add composite `(storeId, date)` index to Otter rollup tables

**Why:** The performance page runs `findMany({ where: { storeId, date: { gte, lte } } })` on both tables. A composite index serves this query in one range scan instead of combining two single-column indexes.

**Files:**
- Modify: `prisma/schema.prisma:186-189` (OtterMenuCategory), `prisma/schema.prisma:211-213` (OtterMenuItem)
- Generated: a new migration directory under `prisma/migrations/`

- [ ] **Step 1: Edit `prisma/schema.prisma` — OtterMenuCategory indexes.**

Find the `OtterMenuCategory` model (around line 169). Replace:
```prisma
  @@unique([storeId, date, category])
  @@index([storeId])
  @@index([date])
```
with:
```prisma
  @@unique([storeId, date, category])
  @@index([storeId, date])
```

- [ ] **Step 2: Edit `prisma/schema.prisma` — OtterMenuItem indexes.**

Find the `OtterMenuItem` model (around line 191). Replace:
```prisma
  @@unique([storeId, date, category, itemName, isModifier])
  @@index([storeId])
  @@index([date])
```
with:
```prisma
  @@unique([storeId, date, category, itemName, isModifier])
  @@index([storeId, date])
```

- [ ] **Step 3: Apply the schema change.**

This project uses `prisma db push` (no `prisma/migrations/` folder exists; `package.json` defines `db:reset` via `db push --force-reset`). Run:
```bash
npx prisma db push
```
Expected: output reports two indexes dropped and one created per table, Prisma client is regenerated, database in sync. Do NOT pass `--force-reset` — it wipes data.

If Prisma prompts about data loss (unlikely for an index-only change), abort (`Ctrl+C`), report `BLOCKED`, and do not force through.

- [ ] **Step 4: Typecheck.**

Run:
```bash
npx tsc --noEmit
```
Expected: no output, exit code 0.

- [ ] **Step 5: Verify the index is used.**

Against the dev database:
```bash
psql "$DATABASE_URL" -c "EXPLAIN SELECT * FROM \"OtterMenuItem\" WHERE \"storeId\" = 'any-id' AND \"date\" BETWEEN '2026-01-01' AND '2026-02-01';"
```
Expected: the query plan shows `Index Scan using OtterMenuItem_storeId_date_idx` (or similar name containing both columns). If it shows `Seq Scan` on a non-empty table, the migration didn't apply — rerun `npx prisma migrate dev`.

- [ ] **Step 6: Commit.**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "perf(menu): composite (storeId, date) index on OtterMenuItem/Category"
```

---

## Task 2: Request-scoped memoization of ingredient + recipe cost

**Why:** `computeRecipeCost` already memoizes within one tree, but not across trees in the same request. On `/catalog`, two recipes that share a sub-recipe (e.g., "Burger Bun") each recompute it. `React.cache` dedupes these within one request at zero behavioral cost — cost functions are already pure given the same inputs.

**Files:**
- Create: `src/lib/cached.ts`
- Modify: `src/lib/recipe-cost.ts` (swap one import + one call site)
- Modify: `src/app/actions/recipe-actions.ts:58-62` (swap the `computeRecipeCost` call)
- Modify: `src/app/actions/recipe-actions.ts:252` (swap the `getCanonicalIngredientCost` call)

- [ ] **Step 1: Create `src/lib/cached.ts` with the two wrappers.**

```ts
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
```

- [ ] **Step 2: Swap the ingredient-cost call inside `recipe-cost.ts`.**

In `src/lib/recipe-cost.ts`, find the import (top of file) and the call site:
```ts
const cost = await getCanonicalIngredientCost(
  ing.canonicalIngredientId,
  asOf
)
```
(around line 130). Leave the import as-is (it's needed because `cached.ts` imports back from this module — a direct swap here would create a circular cache wrapper that doesn't dedup correctly with the current call path). Instead, **do not modify this file**; the dedup that matters is at the recipe-level and the callers in `recipe-actions.ts`. Skip to Step 3.

(Rationale: `computeRecipeCost` already memoizes ingredients *within one tree walk* via its own `memo` map. The extra win from caching individual ingredient lookups across trees is marginal compared to the recipe-level cache. Keeping the change minimal here avoids the import cycle and still captures the big win.)

- [ ] **Step 3: Replace the `computeRecipeCost` calls in `recipe-actions.ts`.**

In `src/app/actions/recipe-actions.ts`, at the top of the file, **add** the import (do not remove the existing `import { computeRecipeCost } from "@/lib/recipe-cost"`):
```ts
import { costRecipeCached, costIngredientCached } from "@/lib/cached"
```

Then locate the `listRecipes` body at around line 58:
```ts
  const costs = await Promise.all(
    recipes.map((r) =>
      computeRecipeCost(r.id).catch(() => null)
    )
  )
```
Replace `computeRecipeCost` with `costRecipeCached`:
```ts
  const costs = await Promise.all(
    recipes.map((r) =>
      costRecipeCached(r.id).catch(() => null)
    )
  )
```

Locate `getRecipeDetail` around line 96:
```ts
  const cost = await computeRecipeCost(recipeId).catch(() => null)
```
Replace with:
```ts
  const cost = await costRecipeCached(recipeId).catch(() => null)
```

Locate the `getCanonicalIngredientCost` call at around line 252:
```ts
      const cost = await getCanonicalIngredientCost(ing.canonicalIngredientId)
```
Replace with:
```ts
      const cost = await costIngredientCached(ing.canonicalIngredientId)
```

Remove the now-unused direct imports of `computeRecipeCost` and `getCanonicalIngredientCost` at the top of `recipe-actions.ts` if they have no other references. Run a project-wide search inside this one file (`grep computeRecipeCost src/app/actions/recipe-actions.ts`) — if only the import remains, delete it.

- [ ] **Step 4: Typecheck.**

```bash
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 5: Manual verification — count DB queries on a catalog load.**

In `src/lib/prisma.ts`, the client is already configured with `log: ['query', 'error', 'warn']` in dev. Start the dev server:
```bash
npm run dev
```
Navigate to `/dashboard/menu/catalog`. In the terminal where `npm run dev` is running, count the `prisma:query` log lines emitted during that one request (Ctrl+F for `prisma:query`). Record the number.

Then hard-refresh the page and count again. The per-request count should be notably lower than a baseline without the cache (if you want a true A/B, temporarily revert Step 3 — but this is optional).

- [ ] **Step 6: Commit.**

```bash
git add src/lib/cached.ts src/app/actions/recipe-actions.ts
git commit -m "perf(menu): request-scoped React.cache for recipe cost"
```

---

## Task 3: Narrow detail-page loader (`getRecipeCatalogSummary`)

**Why:** `/dashboard/menu/catalog/[id]/page.tsx` calls `listRecipes()` — which re-costs every recipe — only to read one item's summary fields. Replace that with a dedicated action that fetches exactly one recipe's row.

**Files:**
- Modify: `src/app/actions/recipe-actions.ts` (add new export `getRecipeCatalogSummary`)
- Modify: `src/app/dashboard/menu/catalog/[id]/page.tsx` (swap the loader)

- [ ] **Step 1: Extract the sell-price resolution helper.**

In `src/app/dashboard/menu/catalog/page.tsx`, the block from lines ~26–66 resolves a recipe's sell price by trying `sellPrices.get(itemName)` then walking `otterMappings`. The same logic is duplicated in `[id]/page.tsx` (lines ~33–60). Extract it to a new helper file so both callers use the same logic.

Create `src/lib/menu-sell-price.ts`:
```ts
import type { getMenuItemSellPrices, getMenuItemsForCatalog } from "@/app/actions/menu-item-actions"

type SellPriceMap = Awaited<ReturnType<typeof getMenuItemSellPrices>>
type OtterMappings = Awaited<ReturnType<typeof getMenuItemsForCatalog>>

export type ResolvedSellPrice = {
  avgPrice: number
  qtySold: number
  sourceOtterName: string
}

/**
 * Resolve the best sell price + qty-sold for a recipe, trying the recipe's
 * own name first, then walking Otter→recipe mappings and picking the most-sold
 * mapped item.
 */
export function resolveSellPriceForRecipe(
  recipeId: string,
  recipeName: string,
  sellPrices: SellPriceMap,
  otterMappings: OtterMappings
): ResolvedSellPrice | null {
  const direct = sellPrices.get(recipeName.toLowerCase())
  if (direct) {
    return {
      avgPrice: direct.avgPrice,
      qtySold: direct.qtySold,
      sourceOtterName: recipeName,
    }
  }
  let best: ResolvedSellPrice | null = null
  let bestQty = -1
  for (const m of otterMappings) {
    if (m.mappedRecipeId !== recipeId) continue
    const sp = sellPrices.get(m.otterItemName.toLowerCase())
    if (sp && sp.qtySold > bestQty) {
      bestQty = sp.qtySold
      best = {
        avgPrice: sp.avgPrice,
        qtySold: sp.qtySold,
        sourceOtterName: m.otterItemName,
      }
    }
  }
  return best
}
```

- [ ] **Step 2: Add `getRecipeCatalogSummary` to `recipe-actions.ts`.**

At the bottom of `src/app/actions/recipe-actions.ts`, append:
```ts
import { getMenuItemSellPrices, getMenuItemsForCatalog } from "@/app/actions/menu-item-actions"
import { resolveSellPriceForRecipe } from "@/lib/menu-sell-price"

export type RecipeCatalogSummary = {
  id: string
  itemName: string
  category: string
  isConfirmed: boolean
  ingredientCount: number
  computedCost: number | null
  partialCost: boolean
  updatedAt: Date
  sellPrice: number | null
  qtySold: number
  sellSourceName: string | null
}

export async function getRecipeCatalogSummary(
  recipeId: string
): Promise<RecipeCatalogSummary | null> {
  const ownerId = await requireOwnerId()
  if (!ownerId) return null

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, ownerId },
    select: {
      id: true,
      itemName: true,
      category: true,
      isConfirmed: true,
      updatedAt: true,
      ingredients: { select: { id: true } },
    },
  })
  if (!recipe) return null

  const [cost, sellPrices, otterMappings] = await Promise.all([
    costRecipeCached(recipe.id).catch(() => null),
    getMenuItemSellPrices(30),
    getMenuItemsForCatalog(),
  ])

  const resolved = resolveSellPriceForRecipe(
    recipe.id,
    recipe.itemName,
    sellPrices,
    otterMappings
  )

  return {
    id: recipe.id,
    itemName: recipe.itemName,
    category: recipe.category,
    isConfirmed: recipe.isConfirmed,
    ingredientCount: recipe.ingredients.length,
    computedCost: cost?.totalCost ?? null,
    partialCost: cost?.partial ?? true,
    updatedAt: recipe.updatedAt,
    sellPrice: resolved?.avgPrice ?? null,
    qtySold: resolved?.qtySold ?? 0,
    sellSourceName: resolved?.sourceOtterName ?? null,
  }
}
```

Confirm `requireOwnerId` and `prisma` are already imported at the top of the file.

- [ ] **Step 3: Rewrite `catalog/[id]/page.tsx` to use the new loader.**

Replace the entire body of `src/app/dashboard/menu/catalog/[id]/page.tsx` with:
```tsx
import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  getRecipeCatalogSummary,
  getRecipeDetail,
} from "@/app/actions/recipe-actions"
import { MenuItemDetailView } from "./menu-item-detail-view"

export default async function MenuItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const [summary, detail] = await Promise.all([
    getRecipeCatalogSummary(id),
    getRecipeDetail(id),
  ])

  if (!summary || !detail) notFound()

  return (
    <MenuItemDetailView
      recipe={{
        id: detail.recipe.id,
        itemName: detail.recipe.itemName,
        category: detail.recipe.category,
        isConfirmed: detail.recipe.isConfirmed,
        isSellable: detail.recipe.isSellable,
        servingSize: detail.recipe.servingSize,
        notes: detail.recipe.notes,
        updatedAt: detail.recipe.updatedAt,
        ingredientCount: summary.ingredientCount,
        computedCost: summary.computedCost,
        partialCost: summary.partialCost,
      }}
      cost={detail.cost}
      sell={
        summary.sellPrice != null && summary.sellSourceName != null
          ? {
              avgPrice: summary.sellPrice,
              qtySold: summary.qtySold,
              sourceOtterName: summary.sellSourceName,
            }
          : null
      }
    />
  )
}
```

- [ ] **Step 4: (Optional DRY) Refactor `catalog/page.tsx` to share the resolver.**

In `src/app/dashboard/menu/catalog/page.tsx`, replace the inline sell-price resolution block (lines ~26–66, starting with `const priceByRecipeId = ...` and ending at the close of its `for` loop) with:
```tsx
import { resolveSellPriceForRecipe } from "@/lib/menu-sell-price"

// ... inside the function, after the Promise.all:
const rows = menuRecipes.map((r) => {
  const price = resolveSellPriceForRecipe(r.id, r.itemName, sellPrices, otterMappings)
  return {
    id: r.id,
    itemName: r.itemName,
    category: r.category,
    isConfirmed: r.isConfirmed,
    ingredientCount: r.ingredientCount,
    computedCost: r.computedCost,
    partialCost: r.partialCost,
    updatedAt: r.updatedAt,
    sellPrice: price?.avgPrice ?? null,
    qtySold: price?.qtySold ?? 0,
    sellSourceName: price?.sourceOtterName ?? null,
  }
})
```
Delete the `priceByRecipeId` variable and its loop. The `menuRecipes.map` still runs over the list from `listRecipes()`.

- [ ] **Step 5: Typecheck.**

```bash
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 6: Manual verification.**

1. `npm run dev`
2. Open `/dashboard/menu/catalog`, wait for it to settle, then click an item row.
3. In the terminal, count `prisma:query` log lines emitted during the detail-page navigation. With Task 3 landed, this should be ≤10 queries (was ~300 before).
4. Confirm the detail page renders correctly — title, badges, stat grid, ingredient tree are all populated.
5. Navigate straight to a detail URL (`/dashboard/menu/catalog/<id>`) in a fresh tab to confirm the loader works without the catalog being rendered first.

- [ ] **Step 7: Commit.**

```bash
git add src/lib/menu-sell-price.ts src/app/actions/recipe-actions.ts src/app/dashboard/menu/catalog/page.tsx src/app/dashboard/menu/catalog/\[id\]/page.tsx
git commit -m "perf(menu): narrow loader for catalog detail page"
```

---

## Task 4: Client-side memoization of chart props + `React.memo` on chart components

**Why:** Changing the date range on `/dashboard/menu` calls `setData(result)`, which creates new array/object references for every chart prop, forcing a full re-render of every chart. Memoize the slices of `data` that each chart consumes, and wrap the heavy chart components with `React.memo`.

**Files:**
- Modify: `src/app/dashboard/menu/components/menu-performance-content.tsx`
- Modify: each chart component to wrap export with `React.memo`:
  - `src/components/charts/menu-daily-trend-chart.tsx`
  - `src/components/charts/category-breakdown-chart.tsx`
  - `src/components/charts/channel-comparison-chart.tsx`
  - `src/components/charts/item-heatmap.tsx`
  - `src/components/charts/ranking-race-chart.tsx`
  - `src/components/charts/menu-kpi-cards.tsx`
  - `src/components/analytics/menu-items-table.tsx`

- [ ] **Step 1: Add `useMemo` wrappers in `menu-performance-content.tsx`.**

Open `src/app/dashboard/menu/components/menu-performance-content.tsx`. Near the existing `insights` useMemo, add:

```ts
const trendData = useMemo(() => data?.dailyTrends ?? [], [data])
const categoryData = useMemo(() => data?.categoryBreakdown ?? [], [data])
const channelData = useMemo(() => data?.channelComparison ?? [], [data])
const heatmapMatrix = useMemo(() => data?.itemDailyMatrix ?? [], [data])
const heatmapItemNames = useMemo(() => data?.matrixItemNames ?? [], [data])
const raceFrames = useMemo(() => data?.raceDayFrames ?? [], [data])
const itemsTableData = useMemo(() => data?.allItems ?? [], [data])
const heatmapDateRange = useMemo(() => data?.dateRange, [data])
```

Then swap the chart JSX to use these memoized values. Replace `data.dailyTrends` with `trendData`, `data.categoryBreakdown` with `categoryData`, etc. The `hasData` guard stays in place; if `data` is null the memoized arrays are empty, which the charts handle via their existing `length === 0` empty states.

- [ ] **Step 2: Memoize the items-click handler.**

`handleItemClick` is already wrapped in `useCallback`, but double-check its dependency list includes `[pathname, router, searchParams]` and not raw function references. Leave if correct.

- [ ] **Step 3: Wrap each chart's default export with `React.memo`.**

For each file listed above, change the export pattern from:
```tsx
export function MenuDailyTrendChart({ data, className }: Props) { ... }
```
to:
```tsx
import { memo } from "react"

function MenuDailyTrendChartImpl({ data, className }: Props) { ... }

export const MenuDailyTrendChart = memo(MenuDailyTrendChartImpl)
```

Repeat for `CategoryBreakdownChart`, `ChannelComparisonChart`, `ItemHeatmap`, `RankingRaceChart`, `MenuKpiCards`, `MenuItemsTable`.

No behavioral change — these components receive plain-data props, so `React.memo`'s default shallow compare is correct.

- [ ] **Step 4: Typecheck.**

```bash
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 5: Manual verification with React DevTools Profiler.**

1. `npm run dev`; open `/dashboard/menu`.
2. Install/open React DevTools → Profiler tab.
3. Start recording; change the date range (click a different preset).
4. Stop recording. In the commit list, expand the render triggered by the date-range change.
5. Expect: only the charts whose data actually changed (all of them, in this case, because all data changes) render — but they render *once*, not multiple times. Before this change, each chart would show up with multiple re-renders per commit. A single render per chart per data change is the goal.
6. Do the same after clicking an item in the Items table — expect the item table's render but the other tabs' charts should NOT re-render (their props are reference-stable; the sheet mount is a separate commit).

- [ ] **Step 6: Commit.**

```bash
git add src/app/dashboard/menu/components/menu-performance-content.tsx src/components/charts src/components/analytics/menu-items-table.tsx
git commit -m "perf(menu): memoize chart props and React.memo chart components"
```

---

## Task 5: Dynamic-import the non-default-tab charts

**Why:** The Menu Explorer has four tabs; only the Items tab is visible on first paint. Dynamic-import the other three charts so Recharts + Framer-Motion aren't parsed or executed until the user switches tabs.

**Files:**
- Modify: `src/app/dashboard/menu/components/menu-performance-content.tsx` (imports + tab content)

- [ ] **Step 1: Swap the three imports for `next/dynamic`.**

At the top of `src/app/dashboard/menu/components/menu-performance-content.tsx`, replace these three lines:
```tsx
import { ChannelComparisonChart } from "@/components/charts/channel-comparison-chart"
import { ItemHeatmap } from "@/components/charts/item-heatmap"
import { RankingRaceChart } from "@/components/charts/ranking-race-chart"
```
with:
```tsx
import dynamic from "next/dynamic"
import { ChartSkeleton } from "@/components/skeletons"

const ChannelComparisonChart = dynamic(
  () => import("@/components/charts/channel-comparison-chart").then((m) => m.ChannelComparisonChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
const ItemHeatmap = dynamic(
  () => import("@/components/charts/item-heatmap").then((m) => m.ItemHeatmap),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
const RankingRaceChart = dynamic(
  () => import("@/components/charts/ranking-race-chart").then((m) => m.RankingRaceChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
```

If `ChartSkeleton` is already imported elsewhere in the file, don't duplicate the import.

- [ ] **Step 2: Typecheck.**

```bash
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Verify the bundle split.**

Build in analyzer mode:
```bash
ANALYZE=true npm run build
```
If the repo doesn't have `next-bundle-analyzer` wired up, skip this and use the browser approach:

Run `npm run dev`, open `/dashboard/menu`, open DevTools → Network → JS. Filter to `_next/static/chunks`. Note the total JS transfer size on first paint. Then click the **Heatmap** tab — a new chunk should load at that point (Recharts vendor chunk). Then click **Top Sellers** — another chunk (framer-motion). This confirms lazy loading.

- [ ] **Step 4: Manual verification.**

1. On `/dashboard/menu`, confirm the page loads with Items tab visible, no skeleton flicker.
2. Click each of the other three tabs — a brief `<ChartSkeleton />` appears, then the chart renders.
3. Click back to Items — no re-fetch of chunks (they're cached after first tab visit).

- [ ] **Step 5: Commit.**

```bash
git add src/app/dashboard/menu/components/menu-performance-content.tsx
git commit -m "perf(menu): dynamic-import non-default tab charts"
```

---

## Task 6: Virtualize the Menu Items table

**Why:** `MenuItemsTable` renders ~500 `<tr>` nodes even though only ~15 are in the viewport. Virtualization keeps the DOM small and scroll responsive.

**Files:**
- Add dependency: `@tanstack/react-virtual`
- Modify: `src/components/analytics/menu-items-table.tsx`

- [ ] **Step 1: Install the virtualizer.**

```bash
npm install @tanstack/react-virtual
```
Expected: `package.json` gains the dep; lockfile updates.

- [ ] **Step 2: Refactor the table body in `src/components/analytics/menu-items-table.tsx`.**

Read the file first — note that `data` is the sorted/filtered row list and each row is a `<TableRow>` inside `<TableBody>`. The refactor wraps the body in a scroll container managed by `useVirtualizer` and renders only visible rows via an absolutely-positioned track.

Replace the table body with:

```tsx
"use client"

import { useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
// (keep the rest of the existing imports)

// Inside the component, add before the return:
const parentRef = useRef<HTMLDivElement>(null)
const ROW_HEIGHT = 44 // match the current row height; tune after first render

const rowVirtualizer = useVirtualizer({
  count: sortedData.length, // use the same variable the existing table body maps over
  getScrollElement: () => parentRef.current,
  estimateSize: () => ROW_HEIGHT,
  overscan: 8,
})

// Replace the existing <Table> ... <TableBody> ... </TableBody> ... </Table> block with:
return (
  <div className="rounded-md border">
    {/* Sticky header — keep the existing header markup, not virtualized */}
    <div className="border-b bg-muted/40 px-4 py-2">
      {/* existing header row JSX */}
    </div>
    <div
      ref={parentRef}
      className="max-h-[540px] overflow-auto"
      style={{ contain: "strict" }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const row = sortedData[vi.index]
          return (
            <div
              key={row.itemName + row.category}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${vi.size}px`,
                transform: `translateY(${vi.start}px)`,
              }}
              className="flex items-center border-b px-4"
            >
              {/* The current <TableRow> contents, rendered as flex cells.
                  Keep the same column order + classNames as the existing row. */}
            </div>
          )
        })}
      </div>
    </div>
  </div>
)
```

**Integration notes (important):**
- The existing file uses shadcn `<Table>` / `<TableRow>` / `<TableCell>`. Those are semantic `<table>` elements. Virtualization can't use translateY on `<tr>` reliably. The refactor replaces the body with `<div>`-based rows but keeps the visual styling (borders, padding, `tabular-nums` for numeric cells).
- Copy each cell's classNames from the current `<TableCell>` to the new `<div>` cells. Use `flex` with `flex-basis` matching the existing column widths, or a CSS grid with `grid-cols-[...]` that mirrors the shadcn table's columns.
- Header stays a single static row on top; it doesn't need to be a `<table>` element either.

- [ ] **Step 3: Typecheck.**

```bash
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Manual verification.**

1. `npm run dev`; open `/dashboard/menu`; switch to the Items tab.
2. Right-click a row → **Inspect**. In the Elements panel, count rendered row `<div>`s — should be ~15–25 (visible + overscan), not 100+.
3. Scroll through the list: rows materialize/unmount smoothly.
4. Click a row → the `ItemExplorerSheet` opens with the right item.
5. Sort by a different column → the scroll container stays at top, rows re-render with new order.

- [ ] **Step 5: Commit.**

```bash
git add package.json package-lock.json src/components/analytics/menu-items-table.tsx
git commit -m "perf(menu): virtualize Menu Items table"
```

---

## Task 7a: `unstable_cache` wrapper for menu performance analytics

**Why:** `getMenuPerformanceAnalytics` is the slowest loader. Wrapping it in `unstable_cache` with a 5-minute revalidate plus tag-based invalidation makes repeat navigations near-instant.

**Files:**
- Modify: `src/lib/cached.ts` (add factory)
- Modify: `src/app/actions/store-actions.ts` (rename inner function; wrapper becomes the export)

- [ ] **Step 1: Add the factory + tag constants to `src/lib/cached.ts`.**

Append to `src/lib/cached.ts`:
```ts
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
 * entry. Tag-based invalidation is scoped to the store.
 */
export function cachedMenuPerformance(
  loader: (storeId: string | undefined, options?: PerfOptions) => Promise<MenuPerformanceData | null>,
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
```

- [ ] **Step 2: Rename the raw implementation in `store-actions.ts`.**

In `src/app/actions/store-actions.ts`, find `export async function getMenuPerformanceAnalytics(` (around line 784). **Rename** it to `getMenuPerformanceAnalyticsRaw` (same body, same parameters, just unexported — drop `export`):

```ts
async function getMenuPerformanceAnalyticsRaw(
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<import("@/types/analytics").MenuPerformanceData | null> {
  // (body unchanged)
}
```

Then add the public wrapper immediately after it:
```ts
export async function getMenuPerformanceAnalytics(
  storeId?: string,
  options?: { days?: number; startDate?: string; endDate?: string }
): Promise<import("@/types/analytics").MenuPerformanceData | null> {
  const { cachedMenuPerformance } = await import("@/lib/cached")
  return cachedMenuPerformance(getMenuPerformanceAnalyticsRaw, storeId, options)
}
```

(Dynamic `import` avoids a circular dependency since `cached.ts` imports types from `@/types/analytics` but the store-actions file imports heavily from other places.)

- [ ] **Step 3: Typecheck.**

```bash
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Manual cache-hit verification.**

1. `npm run dev`; open `/dashboard/menu`. Note the page's server time (add a `console.time('perf-loader')` in `getMenuPerformanceAnalyticsRaw` top/bottom if needed — remove before commit).
2. Reload the page within 5 minutes. Second load's `perf-loader` should log a much smaller time, or the wrapped loader should not invoke the raw function at all (you can log in the outer `cachedMenuPerformance` too for certainty).
3. Change the date range — a new cache entry is created (different `rangeKey`), so first time is a miss; second time same range is a hit.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/cached.ts src/app/actions/store-actions.ts
git commit -m "perf(menu): unstable_cache wrapper for performance analytics"
```

---

## Task 7b: `unstable_cache` wrapper for the catalog bundle

**Why:** `/dashboard/menu/catalog`'s loader fires three queries; the whole bundle can be cached together, keyed by ownerId.

**Files:**
- Modify: `src/lib/cached.ts` (add factory)
- Modify: `src/app/dashboard/menu/catalog/page.tsx` (swap the `Promise.all`)

- [ ] **Step 1: Add the catalog-bundle factory to `src/lib/cached.ts`.**

Append to `src/lib/cached.ts`:
```ts
import { listRecipes } from "@/app/actions/recipe-actions"
import { getMenuItemSellPrices, getMenuItemsForCatalog } from "@/app/actions/menu-item-actions"

type CatalogBundle = {
  recipes: Awaited<ReturnType<typeof listRecipes>>
  sellPrices: Awaited<ReturnType<typeof getMenuItemSellPrices>>
  otterMappings: Awaited<ReturnType<typeof getMenuItemsForCatalog>>
}

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
```

Note: `listRecipes` etc. are *already* doing their own auth check via `requireOwnerId`. Because `unstable_cache` is keyed by `ownerId` explicitly here, each owner gets their own cache entry.

- [ ] **Step 2: Find ownerId at the page level.**

`listRecipes()` internally calls `requireOwnerId()` but doesn't return it. Add a helper to `src/lib/auth.ts` (or wherever `requireOwnerId` lives) that exposes the ownerId for caching. If it already exports `requireOwnerId`, import it in the page.

In `src/app/dashboard/menu/catalog/page.tsx`, near the top of the function:
```ts
import { requireOwnerId } from "@/lib/auth" // or the correct path
// ...
const ownerId = await requireOwnerId()
if (!ownerId) redirect("/login")
```
Replace the existing `Promise.all` block with:
```ts
import { cachedCatalogBundle } from "@/lib/cached"
// ...
const { recipes, sellPrices, otterMappings } = await cachedCatalogBundle(ownerId)
```
The rest of the function (the `menuRecipes.map(...)` block using the shared `resolveSellPriceForRecipe`) stays the same.

- [ ] **Step 3: Typecheck.**

```bash
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Manual cache-hit verification.**

1. `npm run dev`; open `/dashboard/menu/catalog`.
2. Check terminal `prisma:query` log count for this request. Note it.
3. Reload within 5 min. Second request should show **zero** `prisma:query` lines for the catalog bundle (all three queries cached).
4. Sort, filter, click — no new server round trip; all client-side.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/cached.ts src/app/dashboard/menu/catalog/page.tsx
git commit -m "perf(menu): unstable_cache wrapper for catalog bundle"
```

---

## Task 7c: Wire `revalidateTag` into mutation paths

**Why:** Without invalidation, cached data goes stale until the 5-min TTL expires. Call `revalidateTag` in every code path that mutates the underlying data.

**Files:**
- Modify: `src/app/api/otter/sync/route.ts` (after the Otter menu upserts)
- Modify: `src/app/actions/recipe-actions.ts` (in `upsertRecipe`, `deleteRecipe`, and any ingredient edit)
- Modify: `src/app/actions/canonical-ingredient-actions.ts` (at the existing `revalidatePath` sites)

- [ ] **Step 1: Add tag invalidation to Otter sync.**

Open `src/app/api/otter/sync/route.ts`. At the end of the handler — after the upserts complete and before the response is returned — add:
```ts
import { revalidateTag } from "next/cache"
import { MENU_TAGS } from "@/lib/cached"

// Determine storeIds affected by the sync (collected during the upsert loop;
// if not already tracked, collect them as rows are upserted).
for (const storeId of affectedStoreIds) {
  revalidateTag(MENU_TAGS.performance(storeId))
}
revalidateTag(MENU_TAGS.performance("all"))
```
If the route doesn't already track which storeIds were touched, add a `Set<string>` that the upsert loop feeds into. Do NOT blanket-invalidate all stores if only one was synced.

- [ ] **Step 2: Add tag invalidation to `upsertRecipe` and `deleteRecipe`.**

In `src/app/actions/recipe-actions.ts`:

At the top:
```ts
import { revalidateTag } from "next/cache"
import { MENU_TAGS } from "@/lib/cached"
```

In `upsertRecipe` (line ~100), after the existing `invalidateDailyCogs({...})` call and before `return { id }`:
```ts
revalidateTag(MENU_TAGS.recipes(ownerId))
revalidateTag(MENU_TAGS.catalog(ownerId))
```

In `deleteRecipe` (line ~170), after the existing delete completes:
```ts
revalidateTag(MENU_TAGS.recipes(ownerId))
revalidateTag(MENU_TAGS.catalog(ownerId))
```

- [ ] **Step 3: Add tag invalidation to canonical-ingredient mutations.**

In `src/app/actions/canonical-ingredient-actions.ts` at lines ~134 and ~251 where `revalidatePath` is called, add `revalidateTag` calls alongside:

Near the top:
```ts
import { revalidateTag } from "next/cache"
import { MENU_TAGS } from "@/lib/cached"
```

At both `revalidatePath` sites, add immediately after:
```ts
revalidateTag(MENU_TAGS.recipes(ownerId))
revalidateTag(MENU_TAGS.catalog(ownerId))
```
(Confirm `ownerId` is in scope at those sites; if not, look it up via `requireOwnerId()` at the top of the action.)

- [ ] **Step 4: Typecheck.**

```bash
npx tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 5: Manual verification of invalidation.**

1. `npm run dev`; open `/dashboard/menu`; leave browser open.
2. In another terminal, trigger an Otter sync (POST to `/api/otter/sync`, or use the existing sync button in the UI from a second tab).
3. Go back to the first tab; reload `/dashboard/menu`. Server log should show a fresh set of `prisma:query` lines (cache was invalidated). The KPI numbers should reflect the newly synced data.
4. Open `/dashboard/menu/catalog`; in another tab edit a recipe (change its name). Back on the catalog tab, navigate away and back — the updated recipe name is visible without a 5-min wait.

- [ ] **Step 6: Commit.**

```bash
git add src/app/api/otter/sync/route.ts src/app/actions/recipe-actions.ts src/app/actions/canonical-ingredient-actions.ts
git commit -m "perf(menu): wire revalidateTag into mutation paths"
```

---

## Post-implementation verification

After all seven tasks land, run the final smoke check:

- [ ] **End-to-end perf baseline vs. after.**

1. Pick a test storeId and a 30-day date range.
2. Before landing this branch (check out `main`): record server time + JS transfer size + DOM node count for each page. Write it down.
3. Check out this branch; repeat. Every number should be down.

**Expectations:**
- `/dashboard/menu` cold: server time under 1 s; cache-hit reload under 50 ms.
- `/dashboard/menu` hot interactions (date/store/tab change): no perceptible lag — a change triggers one memoized chart re-render per changed slice.
- `/dashboard/menu/catalog` cold: under 1 s with ~100 recipes; cache-hit reload under 50 ms.
- `/dashboard/menu/catalog/[id]` cold: under 400 ms (one recipe + cost + sell-price resolution).
- Items table DOM count: ≤ 30 rows regardless of `allItems.length`.

- [ ] **Close the plan.**

```bash
git log --oneline main..HEAD
```
Expected: seven commits, each with a `perf(menu):` prefix, each independently revertable.

---

## Self-review checklist

- **Spec coverage:** all six components in the spec (`cached.ts`, detail-page cleanup, cache invalidation, client rendering, virtualization, DB indexes) have a corresponding task.
- **No placeholders:** all code blocks contain actual code; all commands include expected output.
- **Type consistency:** `costRecipeCached` / `costIngredientCached` / `cachedMenuPerformance` / `cachedCatalogBundle` / `MENU_TAGS` are named consistently across Tasks 2, 7a, 7b, 7c. `getRecipeCatalogSummary` returns `RecipeCatalogSummary` used by Task 3 only — name stable.
- **Ordering:** indexes → request cache → detail cleanup → client → data cache matches the spec's explicit implementation order. Each task is individually revertable.
