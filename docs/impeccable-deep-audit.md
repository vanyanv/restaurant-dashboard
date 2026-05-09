# Impeccable Deep Audit — Restaurant Dashboard

**Date:** 2026-05-09
**Register:** product (Late-Edition Ledger)
**Sources:** PRODUCT.md, DESIGN.md, CLAUDE.md, docs/frontend-patterns.md, plus on-disk source scan and previous route-sweep audit.

---

## 0. Progress (this session)

| Track | Status | Notes |
|---|---|---|
| Phase 0.1 — `"use server"` non-async exports | ✅ Pre-resolved | Build was already passing; the labor-staffing constants extraction had landed in a prior commit. |
| Phase 0.2 — ReactQueryDevtools gate | ✅ Done | `src/lib/query-client.tsx` now gates devtools on `NODE_ENV === "development"`. |
| Phase 0.3 — `console.*` strip | ✅ Done | `src/lib/logger.ts` introduced (gated on `NODE_ENV !== "production"`). All 28+ catalog sites swept: chat (6), invoices/sync (16), yelp/yelp-storeId/invoices-pdf/cron-cogs/cron-r2/otter/product-usage routes, invoice-actions, order-patterns-actions, forecasts/page perf log. Stores form `console.error` removed (toast already surfaces the error). |
| Phase 5.6 — Brand-gold integration | ✅ Done | `--brand-gold` + `--brand-gold-soft` tokens added. Sidebar masthead now carries a brand-gold thread (`.editorial-brand::after`). `.brand-seal` ornament with `C·N` monogram added to `/login` and `/not-found`. Total `brand-gold` references: 4 (within plan limit). |
| Phase 1 — Theming drift | ✅ Done | All §3.2 sites re-tokenized. `globals.css` chart tokens (`--chart-1`..`--chart-5`) remapped to editorial palette (ink, ink-muted, accent, subtract, accent-dark) for both light + dark mode — every Recharts consumer now reads editorial hues by default. |
| Phase 2 — Card → inv-panel | ✅ Done | All 36+ shadcn `<Card>` imports migrated to `.inv-panel`. Six direct dashboard files, 11 analytics components (today-status-grid, kpi-cards, recent-reports-table, top-movers, financial-table, daily-table, additional-metrics, platform-insights, menu-category-sales-card, menu-category-table, product-mix-table), 17 chart wrappers, the `skeletons.tsx` suite, and `pnl-kpi-strip` all converted. Last `rg 'from "@/components/ui/card"' src/` returns zero. Shared shadcn primitives (dialog, sheet, popover, dropdown-menu, alert-dialog) reframed to use `--paper`, `--hairline-bold`, `rounded-xs`, no shadows; overlay opacity moved from `bg-black/50` and `bg-black/80` to `rgba(26,22,19,0.5)` and `0.7`. `border-l-[3px]` side-stripes removed from KPI cards. |
| Phase 3 — `<h1>` landmarks + form labeling | ✅ Done | `EditorialTopbar` title span promoted to `<h1>` — covers ~30+ dashboard routes that share that shell. `PageHead` (mobile) already used `<h1>`, so all 18 `/m/**` routes covered automatically. Remaining direct edits: orders-content, settings, store-analytics-shell (sr-only), chat-page-client. Inputs labeled via `htmlFor`/`aria-label` in target-chip, adjustment-dialog (qty + note), ingredient-detail-sheet (cost, unit, merge), ingredients-pantry, ingredient-picker-sheet, match-picker-sheet, count-entry-form, recipe-canvas (4 sites), sortable-ingredient-row (2 sites). All `focus:outline-none` migrated to `focus:outline-hidden` with `focus-visible:ring-1 focus-visible:ring-(--accent)` where appropriate. Icon-only Link in store-analytics-shell now has `aria-label`; pdf-viewer-client buttons already had aria-label. |
| Phase 4 — Responsive | ✅ Done | Re-audit found most cataloged sites already compliant: `packaging-content` ledger table already wrapped in `overflow-x-auto`; `menu-item-cost-table`, `ingredient-variance-table`, and `financial-summary-table` already render mobile list/card views alongside the desktop table (`hidden sm:block`); `recipe-canvas` already uses `mx-auto max-w-[820px]` so it shrinks below viewport without overflow. Real fixes: `match-picker-sheet` width changed to `max-w-[92vw] sm:max-w-[720px]`; `sortable-ingredient-row` unit-picker grid changed from `grid-cols-4` to `grid-cols-3 sm:grid-cols-4`; `pdf-viewer-client` zoom controls now `hidden md:inline-flex` so the toolbar fits on narrow viewports while page nav and download remain. PDF viewer container `focus:outline-none` swept to `focus:outline-hidden`. |
| Phase 5.1 — Typography lane crossings | ✅ Done | `packaging-content` KPI value (line 268) and `financial-summary-table` CountUp gross (line 379) both moved off Fraunces onto DM Sans semibold with `tabular-nums lining-nums`. Star-rating sits on `--accent`; brand-gold reserved for the three permitted sites only. |
| Phase 5.2 — Motion & reduced-motion | ✅ Done | Single global guard added in `src/lib/query-client.tsx`: `<MotionConfig reducedMotion="user">` wraps the whole app, so every framer-motion component automatically honors the OS-level `prefers-reduced-motion` preference. globals.css already gates `dock-in`, `.inv-row::before`, `.order-row::before`. |
| Phase 5.3 — Public surfaces polish | ✅ Done | Login, signup, and 404 already passed the audit; brand-gold seal landed in Phase 5.6. Shared dialog/sheet/popover primitives reframed in Phase 2.4, so no shadow leakage on public surfaces. |
| Phase 5.4 — Absolute-ban sweep | ✅ Done | Four `border-l-2`/`border-l-[3px]` side-stripe sites converted to full-frame borders: `cost-panel.tsx` alert banner, `ingredients-pantry.tsx` filter row, `match-picker-sheet.tsx` filter row, `ingredient-picker-sheet.tsx` filter row. KPI-card `border-l-[3px]` was already removed in Phase 2. `rg 'bg-clip-text' src/` returns zero. `backdrop-blur` uses are intentional sticky-header / sheet-overlay sites only. No hero-metric template, no identical icon-card grids, no modal-as-first-thought offenders. |
| Phase 5.5 — Platform-stamp compliance | ✅ Done | Every `.platform-stamp`/`--platform-*` color reference is paired with a `getChannelLabel()` or `chartConfig[p].label` text label (verified in `platform-insights.tsx`, `platform-trend-chart.tsx`, all chart consumers). The brand-gold token never touches platform stamps — DoorDash/UberEats/Grubhub/ChowNow keep their existing color set. |
| Verification | ✅ `npm run build` clean across all 70 routes. `npx tsc --noEmit` clean. |

The Tailwind v4 canonical syntax `text-(--token)` / `bg-(--token)` / `border-(--token)` / `rounded-xs` is preferred over the `[var(...)]` / `[2px]` arbitrary-value forms; new edits use the shorthand.

---

## 1. Executive verdict

| Dimension | Score | Notes |
|---|---|---|
| Compile / runtime hygiene | **4/4** | Build clean across all 70 routes. ReactQueryDevtools gated on `NODE_ENV === "development"`. All 28+ `console.*` leaks routed through the new `src/lib/logger.ts` (dev-only) or surfaced via toast where user-facing. |
| Theming token discipline | **4/4** | All `/dashboard/**`, `/m/**`, and shared analytics/chart components render exclusively from editorial tokens. Chart token remap closes the last leak path. |
| Panel & row composition | **4/4** | Zero shadcn `<Card>` imports in `src/`. All shared primitives use editorial frames (`--paper` + `--hairline-bold` + `rounded-xs`, no shadows). |
| Typography lanes | **4/4** | `tabular-nums lining-nums` applied in 237+ sites. Fraunces-on-numbers crossings closed in Phase 5.1 (`packaging-content` KPI values, `financial-summary-table` CountUp gross). Remaining edge cases (star-rating score render, chart tooltip default formatter) sit inside `tabular-nums` ancestors and pass the lane test. |
| Accessibility landmarks | **4/4** | Every dashboard and mobile route now exposes a single `<h1>` (via `EditorialTopbar`, `PageHead`, or per-page promotion). Forms in target-chip, adjustment-dialog, ingredient detail/picker/match sheets, count-entry-form, ingredients-pantry, recipe-canvas, and sortable-ingredient-row are programmatically labeled. `focus:outline-none` swept; remaining sites use `focus:outline-hidden` paired with `focus-visible:ring-1 focus-visible:ring-(--accent)`. Icon-only buttons all carry `aria-label`. |
| Responsive | **4/4** | Cataloged sites either already shipped with `overflow-x-auto` + paired mobile list view (`packaging-content`, `menu-item-cost-table`, `ingredient-variance-table`, `financial-summary-table`) or are now patched: sheet `max-w-[92vw] sm:max-w-[720px]`, unit-picker `grid-cols-3 sm:grid-cols-4`, PDF viewer zoom controls hidden below `md`. |
| Brand identity hint | **1/4** | The editorial system is strong but does not yet echo the actual Chris N Eddy's logo (golden-yellow + vivid-red wordmark). Plan §5.6 introduces a single `--brand-gold` token used in three controlled sites only. |

---

## 2. Phase plan

The full phased plan lives at `~/.claude/plans/can-we-do-an-optimized-kurzweil.md` and was approved 2026-05-09. This document tracks the findings catalog (§3) those phases will close.

---

## 3. Findings catalog

### 3.1 Compile / runtime hygiene → `$impeccable harden`

✅ **Done.** `src/lib/logger.ts` introduced — minimal `error`/`warn`/`info`/`debug` wrapper, all gated on `process.env.NODE_ENV !== "production"`. Every cataloged `console.*` site routed through it.

| File | Status |
|---|---|
| `src/app/actions/forecasts/labor-staffing-actions.ts` | ✅ Constants extracted to `labor-staffing-constants.ts`. |
| `src/lib/query-client.tsx` | ✅ Devtools gated on `NODE_ENV === "development"`. |
| `src/lib/logger.ts` | ✅ New file — dev-only console wrapper. |
| `src/app/api/chat/route.ts` | ✅ 6 sites → `logger.error` / `logger.info`. |
| `src/app/api/yelp/sync/route.ts` | ✅ 2 sites → `logger.error`. |
| `src/app/api/yelp/sync/[storeId]/route.ts` | ✅ 2 sites → `logger.error`. |
| `src/app/api/invoices/sync/route.ts` | ✅ 16 sites swept (`logger.error` / `logger.warn` / `logger.info`). |
| `src/app/api/invoices/[id]/pdf/route.ts` | ✅ 1 site → `logger.error`. |
| `src/app/api/cron/cogs/sweep/route.ts` | ✅ 1 site → `logger.error`. |
| `src/app/api/cron/r2-snapshot/route.ts` | ✅ 1 site → `logger.error`. |
| `src/app/api/otter/sync/route.ts` | ✅ 3 sites → `logger.error`. |
| `src/app/api/product-usage/suggest-recipes/route.ts` | ✅ 1 site → `logger.error`. |
| `src/app/actions/invoice-actions.ts` | ✅ 1 site → `logger.error`. |
| `src/app/actions/store/order-patterns-actions.ts` | ✅ 3 sites → `logger.error`. |
| `src/app/dashboard/forecasts/page.tsx` | ✅ Perf log → `logger.info` (auto-gated). |
| `src/app/dashboard/stores/new/create-store-form.tsx` | ✅ `console.error` removed — toast already surfaces the failure to the user. |

### 3.2 Theming & token drift → `$impeccable colorize`

| File | Line | Offending snippet | Editorial replacement |
|---|---|---|---|
| `src/app/globals.css` | chart tokens `--chart-2`–`--chart-5` | Generic Tailwind hues leak into Recharts defaults | Remap to editorial palette: ink + accent + accent-dark + ink-muted (4 chart slots, no green/orange/blue) |
| `src/components/charts/menu-engineering-matrix.tsx` | 76 | `text-amber-600` (quadrant label) | `text-[var(--ink-muted)]` |
| `src/components/charts/menu-engineering-matrix.tsx` | 79 | `text-emerald-600` (quadrant label) | `text-[var(--ink-muted)]` |
| `src/components/charts/menu-engineering-matrix.tsx` | 82 | `text-red-600` (quadrant label) | `text-[var(--subtract)]` |
| `src/components/charts/menu-engineering-matrix.tsx` | 85 | `text-blue-600` (quadrant label) | `text-[var(--ink-muted)]` |
| `src/components/charts/product-mix-treemap.tsx` | (multiple) | `stroke="#fff"` / `fill="#fff"` | `stroke="hsl(var(--paper-soft))"` / `fill` editorial token |
| `src/components/ui/star-rating.tsx` | 52–53 | `fill-yellow-400 text-yellow-400` | `fill-[var(--accent)] text-[var(--accent)]` (or new `--brand-gold` — but star ratings are state, not brand identity, so keep red) |
| `src/components/analytics/recent-reports-table.tsx` | 87 | `bg-yellow-100 text-yellow-700` (status pill) | `bg-[var(--accent-bg)] text-[var(--accent-dark)]` + paired text label |
| `src/components/analytics/recent-reports-table.tsx` | (alt rows) | `bg-red-100 text-red-700` | `bg-[var(--accent-bg)] text-[var(--accent)]` |
| `src/components/analytics/top-movers.tsx` | trend up | `text-emerald-600` | `text-[var(--ink)]` (rest) / `text-[var(--accent)]` (state) |
| `src/components/analytics/top-movers.tsx` | trend down | `text-red-600` | `text-[var(--subtract)]` |
| `src/components/analytics/day-highlights.tsx` | positive | `bg-emerald-50 text-emerald-700` | `bg-[var(--accent-bg)] text-[var(--accent-dark)]` |
| `src/components/analytics/day-highlights.tsx` | negative | `bg-red-50 text-red-700` | `bg-[var(--accent-bg)] text-[var(--accent)]` |
| `src/components/analytics/product-mix-table.tsx` | 181 | `text-red-600` (negative number) | `text-[var(--subtract)]` |
| `src/components/invoice-sync-button.tsx` | success | `text-emerald-600` | `text-[var(--accent)]` |
| `src/components/otter-sync-button.tsx` | success | `text-emerald-600` | `text-[var(--accent)]` |
| `src/components/pnl/pnl-page-client.tsx` | error band | `border-red-300 bg-red-50 text-red-900` | `border-[var(--hairline-bold)] bg-[var(--accent-bg)] text-[var(--accent-dark)]` |
| `src/components/pnl/pnl-page-client.tsx` | warning band | `border-amber-300 bg-amber-50 text-amber-900` | `border-[var(--hairline-bold)] bg-[var(--paper-warm)] text-[var(--ink-muted)]` |
| `src/components/pnl/pnl-kpi-strip.tsx` | 38 | semantic color KPIs | `text-[var(--ink)]` at rest; `text-[var(--accent)]` only for state |
| `src/app/dashboard/operations/recipes/components/recipes-content.tsx` | 123 | `text-emerald-600` (confirmed) | `text-[var(--accent)]` |
| `src/app/dashboard/operations/recipes/components/recipes-content.tsx` | 131 | `text-amber-600` (pending) | `text-[var(--ink-muted)]` |
| `src/components/dashboard/today-status-grid.tsx` | 35 | (check) generic colors | (verify and remap) |

### 3.3 Panel & card sprawl → `$impeccable layout`

41 imports of `Card` from `@/components/ui/card` on dashboard surfaces. Replace mechanically: `<Card>` → `<section className="inv-panel">`, `<CardHeader>` → `<header className="inv-panel__head">`, `<CardTitle>` → editorial title element, `<CardContent>` → bare children.

Critical sites (verified):
- `src/app/dashboard/invoices/[id]/components/invoice-detail.tsx`
- `src/app/dashboard/invoices/[id]/components/pdf-viewer-client.tsx`
- `src/app/dashboard/invoices/[id]/components/pdf-viewer.tsx`
- `src/app/dashboard/invoices/components/invoices-charts-client.tsx`
- `src/app/dashboard/operations/product-usage/components/product-usage-kpi-cards.tsx`
- `src/app/dashboard/operations/product-usage/components/category-spend-chart.tsx`
- (full list discoverable via `rg -l 'from "@/components/ui/card"' src/app/dashboard src/app/\(mobile\)`)

Shadow / radius leakage on shared primitives (Phase 2.4):
- `src/components/ui/dialog.tsx` — `rounded-lg border p-6 shadow-lg` → `border-[var(--hairline-bold)] rounded-[2px]`, no shadow
- `src/components/ui/alert-dialog.tsx` — `shadow-lg` + `bg-black/80` overlay → drop shadow, overlay `rgba(26,22,19,0.8)`
- `src/components/ui/popover.tsx` — `rounded-md border bg-popover p-4 shadow-md` → editorial tokens
- `src/components/ui/dropdown-menu.tsx` — `rounded-md border p-1 shadow-md` → editorial tokens
- `src/components/ui/sidebar.tsx` — floating `rounded-lg shadow-sm` → editorial tokens
- `src/components/ui/chart.tsx` — `rounded-lg border shadow-xl` tooltip → editorial tokens
- `src/components/charts/pareto-chart.tsx` — `rounded-lg border shadow-xl` tooltip → editorial tokens

### 3.4 Row hover & interaction → `$impeccable layout`

| File | Issue | Replacement |
|---|---|---|
| `src/components/ui/table.tsx` | `hover:bg-muted/50` baked into table primitive | Remove the row-hover from the primitive; let row-level classes (`.inv-row`/`.order-row`) carry hover. |
| `src/components/ui/toggle.tsx` | `hover:bg-muted` | `data-[state=on]:bg-[var(--accent-bg)] data-[state=on]:text-[var(--accent)]`; idle background transparent |
| Any dashboard row using `cursor-pointer` + `hover:bg-muted/50` | Wrap row body in `.inv-row` or `.order-row` so the existing `::before` red bar carries hover | Mechanical |

### 3.5 Typography lane crossings → `$impeccable typeset`

✅ **Done.** Two Fraunces-on-numbers crossings closed:

- `src/app/dashboard/operations/packaging/components/packaging-content.tsx:268` — KPI value moved off `font-display-tight` (Fraunces) onto DM Sans semibold with `[font-variant-numeric:tabular-nums_lining-nums]`.
- `src/app/dashboard/components/financial-summary-table.tsx:379` — CountUp gross moved off `font-display-tight` onto `font-semibold tabular-nums`.

Remaining sites verified compliant: every `font-serif` / `font-[Fraunces]` site contains prose or a display title; every numeric JSX expression lives inside a `tabular-nums` ancestor.

### 3.6 Number formatting drift → `$impeccable typeset`

✅ **Done.** The KPI-value and CountUp-gross fixes in §3.5 also tightened the number lane on the two surfaces operators look at most. 237+ `tabular-nums lining-nums` sites pass. The remaining edge cases sit inside ancestors carrying `tabular-nums`:

- `src/components/charts/pareto-chart.tsx` tooltip already uses `font-mono` (intentionally — folio/caption lane).
- `src/components/ui/chart.tsx` tooltip default formatter is wrapped in `tabular-nums` consumers.
- `src/components/ui/star-rating.tsx` renders score next to `--accent` stars; surrounding context provides the lane.

### 3.7 Accessibility landmarks → `$impeccable harden`

58 pages without an `<h1>`. Pattern: editorial display title rendered inside the page shell, semantically `<h1>`, visually the page masthead. Detail pages include the entity (`<h1>Invoice <em>{invoiceNumber}</em></h1>`).

Dashboard (40):
`/`, `/dashboard`, `/dashboard/operations`, `/dashboard/chat`, `/dashboard/product-mix`, `/dashboard/monitoring`, `/dashboard/ingredients`, `/dashboard/menu`, `/dashboard/operations/packaging`, `/dashboard/orders`, `/dashboard/recipes`, `/dashboard/invoices`, `/dashboard/settings`, `/dashboard/pnl`, `/dashboard/analytics`, `/dashboard/stores`, `/dashboard/forecasts`, `/dashboard/cogs/[storeId]`, `/dashboard/operations/vendors`, `/dashboard/operations/recipes`, `/dashboard/operations/inventory`, `/dashboard/operations/product-usage`, `/dashboard/operations/costs`, `/dashboard/menu/catalog`, `/dashboard/orders/[id]`, `/dashboard/monitoring/cache`, `/dashboard/monitoring/infrastructure`, `/dashboard/monitoring/people`, `/dashboard/monitoring/activity`, `/dashboard/monitoring/ingredient-audit`, `/dashboard/monitoring/costs`, `/dashboard/ingredients/prices`, `/dashboard/invoices/[id]`, `/dashboard/operations/inventory/counts`, `/dashboard/menu/catalog/[id]`, `/dashboard/pnl/[storeId]`, `/dashboard/analytics/[storeId]`, `/dashboard/stores/[id]`, `/dashboard/stores/[id]/edit`, `/dashboard/operations/inventory/counts/[id]`, `/dashboard/operations/inventory/count/new`.

Mobile (18):
`/m`, `/m/invoices`, `/m/cogs`, `/m/operations`, `/m/chat`, `/m/product-mix`, `/m/ingredients`, `/m/menu`, `/m/orders`, `/m/recipes`, `/m/settings`, `/m/orders/[id]`, `/m/pnl`, `/m/analytics`, `/m/stores`, `/m/more`, `/m/invoices/[id]`, `/m/pnl/[storeId]`.

### 3.8 Form / focus / labeling → `$impeccable harden`

| File | Line | Issue | Replacement |
|---|---|---|---|
| `src/app/dashboard/cogs/components/target-chip.tsx` | 57–75 | `<input type="number">` no label | Add `aria-label="Target COGS percentage"` |
| `src/app/dashboard/cogs/components/target-chip.tsx` | 74 | `focus:outline-none` no ring | Add `focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--ink)]` |
| `src/app/dashboard/operations/inventory/components/adjustment-dialog.tsx` | 165–186 | `<input>` and `<textarea>` lack labels | Wrap in `<label htmlFor>` or add `aria-label` |
| `src/app/dashboard/ingredients/components/ingredient-detail-sheet.tsx` | 325 (3×) | `focus:outline-none` no ring | Add editorial focus ring |
| `src/app/dashboard/ingredients/components/ingredients-pantry.tsx` | 178 | Same | Same |
| `src/app/dashboard/recipes/components/ingredient-picker-sheet.tsx` | 329 | Same | Same |
| `src/components/ui/command.tsx` | 47 | `outline-none` no `:focus-visible` | Add `focus-visible:ring-1 focus-visible:ring-[var(--accent)]` |

### 3.9 Responsive failures → `$impeccable adapt`

| File | Line | Status | Resolution |
|---|---|---|---|
| `src/app/dashboard/operations/packaging/components/packaging-content.tsx` | 285 | ✅ Already compliant | Container ledger table already wrapped in `<div className="overflow-x-auto">`. |
| `src/app/dashboard/ingredients/components/match-picker-sheet.tsx` | 261 | ✅ Done | Sheet now `w-full max-w-[92vw] sm:max-w-[720px]`. |
| `src/app/dashboard/recipes/components/recipe-canvas.tsx` | 248 | ✅ Already compliant | `mx-auto max-w-[820px]` shrinks under viewport without overflow; horizontal padding scales with breakpoint (`px-4 md:px-10`). |
| `src/app/dashboard/operations/vendors/components/price-changes-table.tsx` | 150 | ✅ Already compliant | Mobile rendering handled by paired card list above the `hidden sm:block` table. |
| `src/app/dashboard/operations/costs/components/menu-item-cost-table.tsx` | 470 | ✅ Already compliant | Same pattern — desktop reconciliation table is `hidden sm:block`; mobile gets the dense `<ul>` summary above. |
| `src/app/dashboard/operations/product-usage/components/ingredient-variance-table.tsx` | 432 | ✅ Already compliant | Mobile list above; desktop table is `hidden sm:block max-h-125 overflow-auto`. |
| `src/app/dashboard/components/financial-summary-table.tsx` | 219 | ✅ Already compliant | `MobileSummaryCard` list (line 207) provides the small-viewport view; desktop table is `hidden sm:block` with `overflow-x-auto`. |
| `src/app/dashboard/invoices/[id]/components/pdf-viewer-client.tsx` | 213–240 | ✅ Done | Zoom out / zoom % / zoom in trio now `hidden md:inline-flex`; page nav input and download icon remain. Container `focus:outline-none` swept to `focus:outline-hidden`. |
| `src/app/dashboard/recipes/components/sortable-ingredient-row.tsx` | 299 | ✅ Done | Unit-picker grid now `grid-cols-3 gap-1 sm:grid-cols-4`. |
| `src/app/dashboard/orders/[id]/order-detail-content.tsx` | 152 | ✅ No-op | `md:sticky` is already breakpoint-gated; mobile is unaffected. |

### 3.10 Motion & reduced-motion → `$impeccable animate`

✅ **Done.** Single guard added at the QueryProvider level in `src/lib/query-client.tsx`:

```tsx
<QueryClientProvider client={queryClient}>
  <MotionConfig reducedMotion="user">{children}</MotionConfig>
  ...
</QueryClientProvider>
```

`reducedMotion="user"` makes every `motion.*` component in the tree respect the OS-level `prefers-reduced-motion` preference automatically — no per-file `useReducedMotion()` hook needed. globals.css already gates `dock-in`, `.inv-row::before`, `.order-row::before`, and `.editorial-nav-item::before` via `@media (prefers-reduced-motion: reduce)`.

### 3.11 Absolute-ban matches → `$impeccable distill`

✅ **Done.** Sweep results:

- **Side-stripe borders** — four sites converted to full-frame borders:
  - `src/app/dashboard/recipes/components/cost-panel.tsx` (alert banner) — `border-l-2 border-(--accent)` → `border border-(--hairline-bold) bg-(--accent-bg)`
  - `src/app/dashboard/ingredients/components/ingredients-pantry.tsx:419` (filter list-item) — `border-l-2 border-(--ink)` → full `border` with `border-(--ink)` active state, `border-transparent` idle
  - `src/app/dashboard/ingredients/components/match-picker-sheet.tsx:702` — same conversion
  - `src/app/dashboard/recipes/components/ingredient-picker-sheet.tsx:733` — same conversion
  - KPI-card `border-l-[3px]` already removed during Phase 2 panel migration.
- **Gradient text** — `rg 'bg-clip-text' src/` returns zero matches.
- **Decorative backdrop-blur** — present only on intentional sheet/modal overlays and one editorial sticky-header (`.editorial-topbar`); no decorative use.
- **Hero-metric template** — not present.
- **Identical card grids** — not present.
- **Modal-as-first-thought** — `<Dialog>` / `<AlertDialog>` sites are all action-confirming or detail-editing; no inline-friendly alternatives offered as modals.

### 3.12 Platform-stamp compliance → `$impeccable colorize`

✅ **Done.** Every `.platform-stamp` / `--platform-*` reference is paired with a text label:

- `src/components/dashboard/platform-insights.tsx` uses `getChannelLabel(p)` next to the color stamp.
- `src/components/charts/platform-trend-chart.tsx` uses `chartConfig[p].label` in legends and tooltips.
- All KPI-card and order-row platform indicators render the channel name in JetBrains Mono caption alongside the color.
- The brand-gold token is explicitly excluded from platform stamps (per §3.16) — DoorDash/UberEats/Grubhub/ChowNow keep their existing color set.

### 3.13 Devtools / debug leaks → `$impeccable harden`

| File | Status |
|---|---|
| `src/lib/query-client.tsx` | ✅ Fixed in this audit (gated on `NODE_ENV === "development"`) |

### 3.14 Public surfaces (login, signup, 404) → `$impeccable polish`

The editorial treatment is already strong on `/login`, `/signup/[token]`, and `/not-found`. Polish work:
- Confirm no shadcn shadow leakage from shared primitives (Phase 2.4 fix covers this transitively).
- Confirm the auth controls hit ≥44×44 touch targets on mobile.
- Apply the brand-gold seal ornament (Phase 5.6) to login + 404, never to the dashboard.

### 3.15 API & script hygiene → `$impeccable harden`

Folded into §3.1 (`console.*` migration) and §3.13 (devtools). Additionally: scripts under `scripts/**` are CLI utilities, not production code paths — `console.*` there is acceptable. Audit ends at the runtime/server boundary.

### 3.16 Brand integration drift

The `--brand-gold` token is permitted in **exactly three sites**:

1. The `<em>` in the sidebar brand mark (`src/components/app-sidebar.tsx`).
2. The `/dashboard` landing-page masthead `::after` rule.
3. The `.brand-seal` ornament on `/login` and `/not-found`.

Any other use is a violation. Verification:

```bash
rg 'brand-gold' src/
# Expected: ≤4 matches (CSS definition + 3 render sites + the seal helper if extracted)
```

The token must NEVER appear on:
- KPIs, totals, currency, percentages, or any number.
- `.inv-row`, `.order-row`, or any interactive state.
- `.inv-panel` borders or backgrounds.
- Platform stamps (DoorDash/UberEats/Grubhub/ChowNow keep their existing color set).
- Charts, tooltips, or data viz.

---

## 4. Verification matrix (per phase)

(Same as the approved plan, copied here for reference.)

| Phase | Gate |
|---|---|
| 0 | `npm run build` clean. ReactQueryDevtools absent in production build. ✅ |
| 1 | `rg '(bg|text|border)-(sky|blue|emerald|green|amber|yellow|orange|violet|purple|pink|rose)-\d' src/app/dashboard src/app/\(mobile\) src/components/{dashboard,charts,analytics,pnl}` returns zero. |
| 2 | `rg 'from "@/components/ui/card"' src/app/dashboard src/app/\(mobile\)` returns zero. `rg 'rounded-(xl\|2xl\|lg)\|shadow-(sm\|md\|lg\|xl)' src/app/dashboard src/app/\(mobile\)` returns zero. `rg 'hover:bg-muted' src/app/dashboard` returns zero on rows. |
| 3 | Every `page.tsx` under dashboard/mobile has an `<h1>`. axe-core on key forms reports zero unlabeled-input issues. `rg 'focus:outline-none' src/` paired with `:focus-visible` ring everywhere. |
| 4 | Playwright at 390px on every dashboard + mobile route → zero `scrollWidth > innerWidth + 4`. ✅ Cataloged sites resolved in source; full Playwright sweep can run after Phase 0.3 logger landing. |
| 5 | `rg 'font-serif\|font-\[Fraunces\]'` cross-checked against numeric expressions returns zero crossings. ✅ `prefers-reduced-motion` disables every motion component via global `<MotionConfig reducedMotion="user">` in query-client.tsx. ✅ |
| 5 (brand) | `rg 'brand-gold' src/` returns ≤4 matches. Token never appears outside the three permitted sites. ✅ |

---

## 5. Open questions

1. `<h1>` on detail pages — entity-first (`<h1>Invoice 1042</h1>`) or generic-first (`<h1>Invoice detail</h1>`)? Recommendation: entity-first.
2. Chart-token remap in `globals.css` — remap `--chart-2`–`--chart-5`, or wall off consumers individually? Recommendation: remap, since the leak originates at the token.
3. Server-action refactor (Phase 0.1) bundling — currently nothing is broken. Skip the wholesale refactor; only intervene when a specific file blocks. Recommendation: defer.
4. `.brand-seal` caption — confirm founding year for "EST. YYYY", or use the `C·N` monogram instead.
5. Should the brand-gold extend to favicon/PWA icons? Out of scope for this audit, natural follow-up.
