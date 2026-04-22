# COGS page — design spec

## Context

The owner-operator currently has no single surface that answers the question *"is my food cost in control, and where is margin leaking?"* The data exists — `DailyCogsItem` is already materialized per store/date/menu-item with `qtySold`, `salesRevenue`, `unitCost`, `lineCost`, `status` — but it's only consumed as a single row inside the P&L statement. Invoices and recipe-cost have their own pages, so the COGS-shaped picture is fragmented.

This spec introduces a dedicated **per-store COGS page** at `/dashboard/cogs/[storeId]` whose sole job is **food-cost health monitoring**: COGS %, $, period-over-period change, gap to a per-store target, plus the actionable breakdowns that explain it. Visual treatment is an editorial broadsheet ("Owner's Almanac") that extends the existing `editorial.css` system rather than introducing a new aesthetic.

## Decisions made during brainstorm

- **Primary job:** food-cost health monitor (price-rise tracking is secondary, surfaced inside the cost-driver-ingredients section as a tiny ▲▼ trend per ingredient — no separate "Price movers" section in v1).
- **Scope:** per-store, route `/dashboard/cogs/[storeId]`, mirrors P&L.
- **Sections (6):** KPI strip, COGS % trend, Cost by category, Worst-margin menu items, Top cost-driver ingredients, Data-quality strip.
- **Target:** new optional `Store.targetCogsPct` field; editable inline via a topbar "stamp" chip.
- **Period controls:** reuse the P&L `DateRangeUrlControls` for consistency.
- **Visual direction:** editorial broadsheet, single-signal red ink only on the hero COGS % when over target. See "Visual direction" below.

## Architecture

### Data sources (no new ETL)

- **`DailyCogsItem`** is the spine for KPIs, trend, by-category, worst-margin items, and data-quality. Pure aggregation — no new compute.
- **`Store.targetCogsPct`** (NEW, optional `Decimal(5,2)`) drives the "vs target" KPI and the chart's target band.
- **Recipe × Sales decomposition** for "Top cost-driver ingredients" — computed on-the-fly per request in `src/lib/cogs.ts`, joining `DailyCogsItem` rows with `Recipe.ingredients` and aggregating by `canonicalIngredientId`. Reuses `canonicalizeUnit` and `convert` from `src/lib/recipe-cost.ts`. **No new materialization table.** Bounded by typical scope (~30 items × ~10 ingredients per month). Can promote to a `DailyIngredientUsage` table later if it becomes slow.

### Schema change

```prisma
model Store {
  // ...existing fields
  targetCogsPct Decimal? @db.Decimal(5, 2)  // e.g. 28.50
}
```

Migration: `prisma migrate dev --name store_target_cogs_pct`. Nullable → no impact on existing stores.

## File plan

**New files**
- `src/app/dashboard/cogs/[storeId]/page.tsx` — server-rendered shell.
- `src/app/dashboard/cogs/[storeId]/cogs-shell.tsx` — `EditorialTopbar` + `DateRangeUrlControls` + `<Suspense>`-wrapped sections.
- `src/app/dashboard/cogs/components/sections/`
  - `data-quality-strip-section.tsx` — § 06, rendered visually just under the topbar.
  - `cogs-kpi-strip-section.tsx` — § 01.
  - `cogs-trend-section.tsx` — § 02.
  - `cost-by-category-section.tsx` — § 03.
  - `worst-margin-items-section.tsx` — § 04.
  - `top-cost-driver-ingredients-section.tsx` — § 05.
- `src/app/dashboard/cogs/components/target-chip.tsx` — inline-editable target stamp.
- `src/lib/cogs.ts` — query/aggregation helpers.
- `src/app/actions/cogs-actions.ts` — `setStoreTargetCogsPct(storeId, pct)`.

**`src/lib/cogs.ts` exports** (all take `(storeId, startDate, endDate)`):
- `getCogsKpis(...)` → `{ cogsPct, cogsDollars, revenueDollars, deltaVsPriorPp, deltaVsTargetPp }`. Computes prior-equivalent period internally; reads `Store.targetCogsPct`.
- `getCogsTrend(..., granularity)` → `[{ bucket, cogsPct, cogsDollars, revenueDollars }]`. Bucket math mirrors P&L.
- `getCostByCategory(...)` → `[{ category, cogsDollars, pctOfCogs }]`. `category` is `DailyCogsItem.category` (sourced from `Recipe.category`), not invoice category.
- `getWorstMarginItems(..., limit)` → `[{ itemName, recipeId, unitsSold, revenue, foodCostDollars, foodCostPct }]`, sorted desc by `foodCostPct`.
- `getDataQualityCounts(...)` → `{ unmapped, missingCost, costed }` from `DailyCogsItem.status`.
- `getTopCostDriverIngredients(..., limit)` → recipe×sales decomposition, returns `[{ canonicalIngredientId, name, theoreticalDollars, pctOfCogs, latestUnitCost, priorUnitCost }]`. Sub-recipe walking reuses recursion in `recipe-cost.ts::computeRecipeCost`.

**Modified files**
- `prisma/schema.prisma` — add `Store.targetCogsPct`.
- `src/components/app-sidebar.tsx` (or `nav-main.tsx`) — add "COGS" item under the per-store nav group, wired like the existing P&L link.
- `src/app/dashboard/editorial.css` — append COGS tokens at the bottom: `.cogs-hero-pct`, `.cogs-hero-pct--over`, `.cogs-target-stamp`, `.cogs-corrigenda`, `.cogs-bar-row`. No edits to existing rules.

**Reused as-is**
- `EditorialTopbar`, `SectionHead`, `HeroKpi`, `SectionErrorBoundary`.
- `DateRangeUrlControls` from `src/components/analytics/`.
- `canonicalizeUnit` / `convert` from `src/lib/recipe-cost.ts`.
- `DailyCogsItem` and the existing `cogs-materializer.ts` — read-only; no changes to materialization.
- shadcn `Chart` wrapper / Recharts for trend line and category donut.

## Layout (page composition)

```
EditorialTopbar
  § NN · COGS                      [▸ Store: <name>]
  (NN = page's slot in the dashboard's editorial numbering, picked at
   implementation time to follow the existing pages — distinct from the
   §01–§06 numbering of sections within this page below.)
  Stamps:  Period · Δ vs prior · Target stamp (editable)
  Controls: DateRangeUrlControls

§ 06  DATA QUALITY  (corrigenda strip — pinned just under topbar; renders only if non-zero)

§ 01  KPI STRIP
  Hero COGS % occupies left 50%; secondary KPIs (COGS $, Δ prior, vs target)
  stack 3-row in right 50%, divided by hairlines.

§ 02  TREND  — full-width line chart, 3:1 aspect, target band drawn first.

§ 03  COST BY CATEGORY  (donut + marginalia legend)   |   § 04  WORST-MARGIN ITEMS (table)
  50/50 side-by-side at desktop, stacked on mobile.

§ 05  TOP COST-DRIVER INGREDIENTS — full-width horizontal bar list (top 15).
```

## Visual direction — "Owner's Almanac"

Editorial financial broadsheet that extends `editorial.css` — same `--ink/--paper/--hairline/--accent`, same `font-display` (italic display serif) and `font-mono` (tabular figures) — but pushes the serif larger and the hairlines thinner than anywhere else in the app.

**The memorable moment:** the hero COGS % set in `font-display` italic ~120px, with the `%` glyph in `font-mono` at half-size baseline-aligned. **Only this number on the page is allowed to be red.** If COGS % is over `targetCogsPct`, it's broadsheet red `oklch(0.45 0.15 25)`. Otherwise ink. That single chromatic rule means the owner walks past their laptop and knows the answer without reading.

- **Typography:** hero `font-display` italic ~120px (color = ink or red); secondary KPIs `font-mono` ~36px tabular nums; tables `font-mono`; section heads `editorial-section-label`.
- **Color:** `--paper` background, `--ink` text, no card backgrounds, no shadows, ≤2px radii. Single signal: broadsheet red, used **only** for the hero COGS % when over target and for `▲` glyphs in the worst-margin table.
- **Spatial:** topbar carries an editable target stamp `[ TARGET · 28.0% ]`. Trend's target band = a hairline pair filled with a 3% black wash, drawn under the line. Cost-by-category donut sits left, marginalia legend right. Cost-driver bars fill toward the right with `--ink @ 8% opacity`; figure sits at bar's end.
- **Motion (restrained):** KPI strip fades in 60ms staggered (hero first); trend chart line draws in via `stroke-dashoffset` over 800ms ease-out; hero COGS % CountUp 0→value over 700ms. No hover lifts, no scroll reveals — the page is supposed to feel printed.
- **Atmosphere:** 4% SVG-noise grain overlay fixed on the body; vertical column-rule hairline between topbar title and controls; `font-feature-settings: "tnum"` everywhere numerics appear.

## Empty / edge states

- No `DailyCogsItem` rows in period → each section shows a single italic line: *"No COGS data for this period — sync invoices and Otter sales."*
- `Store.targetCogsPct` unset → hero COGS % stays ink; KPI shows a "Set a target" chip; trend chart hides the band.
- `getDataQualityCounts` all zero → § 06 corrigenda strip does not render.

## Verification (manual)

- `prisma migrate dev` succeeds; `Store.targetCogsPct` nullable; existing stores unaffected.
- `pnpm dev`, navigate to `/dashboard/cogs/<storeId>`:
  - For a store with `DailyCogsItem` rows: every section renders.
  - For a store with no rows: every section shows the italic empty-state line.
  - With `targetCogsPct = null`: hero COGS % is ink; "Set a target" chip visible; chart hides band.
  - With `targetCogsPct` set and current COGS % over it: hero number renders red.
- Topbar target stamp edit → server action persists → page revalidates and KPIs/band update.
- Data-quality strip's link navigates to `/dashboard/recipes`.
- Spot-check: pick one menu item from the worst-margin table; manually multiply a few ingredient quantities × current canonical costs (`CanonicalIngredient.costPerRecipeUnit`) and confirm the line cost matches `DailyCogsItem.lineCost` for that day.

## Implementation sequence (suggested)

1. Schema + migration: `Store.targetCogsPct`.
2. `src/lib/cogs.ts` aggregation helpers (KPI / trend / category / worst-margin / data-quality first; cost-driver-ingredients last since it's the most involved).
3. Server action `setStoreTargetCogsPct`.
4. Editorial CSS additions.
5. Page shell + `EditorialTopbar` integration + `DateRangeUrlControls` wiring.
6. Sections in order: KPI strip → Trend → Worst-margin items → Cost by category → Top cost-driver ingredients → Data-quality strip → Target chip.
7. Sidebar nav entry.
8. Manual verification pass.

## Out of scope (v1)

- Materialized per-ingredient daily usage table.
- Vendor-comparison view for the same canonical ingredient.
- Theoretical-vs-actual variance (requires inventory bridge).
- Standalone "Price movers" section (mini ▲▼ inside the cost-driver section is the v1 surface for price movement).
- Multi-store rollup or league table (deliberate — owner asked for per-store).
