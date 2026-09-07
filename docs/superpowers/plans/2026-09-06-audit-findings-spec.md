# Codebase Audit Findings — 2026-09-06 (spec for the fix plan)

Audit of `dashboardv2`. All gates were green at audit time (`npm run tokens`,
`npx tsc --noEmit`); everything below runs green today. Line numbers are as of
commit `be551443`.

## 1. Cross-tenant leaks (adapters)

The tenancy boundary is `accountId` (`src/lib/auth-scope.ts`). Store-owned
models reach it through `store: { accountId }`; raw SQL joins `"Store"`.

| # | Site | Defect |
|---|------|--------|
| L1 | `src/lib/counter/adapters/settings.ts:140-144` | `loginEvent.findMany` / `.count` filter only on `kind` + `createdAt`. `LoginEvent` (schema.prisma:1206) has **no relation field to User**, only a nullable `userId` scalar — so the fix filters `userId: { in: <account user ids> }`. Leaks every account's sign-in IPs/user agents. |
| L2 | `src/lib/counter/adapters/stock-counts.ts:877` | `loadCountEntry(countId)` derives the tenant from the fetched row (`findUnique({ id }).store.accountId`); `input.accountId` (present on `CountSessionInput`, line 681-684) is dropped at the call site (`:825`). Any foreign `countId` renders that account's catalogue + quantities. |
| L3 | `src/lib/counter/adapters/ingredient.ts:221` | `stockCountLine.count()` with no `where`, rendered as "…in the account". Needs `{ stockCount: { store: { accountId } } }`. |
| L4 | `src/lib/counter/adapters/stock-counts.ts:252` | `ingredientModelState.count()` with no `where`; `storeIds` in scope above. |
| L5 | `src/lib/counter/adapters/new-store.ts:91-93` | `otterStore.findMany`, `harriBrand.findMany`, `storeWeatherSignal.count()` all unscoped; the weather count renders directly (all-tenant number). |
| L6 | `src/lib/counter/adapters/recipes.ts:169-173` | Raw SQL over `DailyCogsItem` with no store filter; rows discarded but reads all tenants. `storeIds` in scope. |
| L7 | `src/lib/counter/adapters/product-usage.ts:237` | `canonicalIngredient.findMany({ id: { in: missing } })` without `accountId` (defensive; ids derive from scoped query today). |
| L8 | `src/lib/counter/adapters/decisions.ts:9,715` | The only adapter resolving its own session (`getCachedSession`). Scoping correct; rule violation. |

## 2. Figure divergences

| # | Figure | Defect |
|---|--------|--------|
| F1 | `median` | `adapters/prices.ts:104` returns `sorted[floor(n/2)]` — upper-middle, not median, on even n. Correct impl exported at `adapters/alerts.ts:274`. |
| F2 | Marketplace commission | `channel-mix.ts` computes real commission (store DB rate × gross, `null` for Grubhub) and `ticket`; `adapters/overview.ts:1305` strips both; `components/counter/surface/channel-rows.tsx:96-99` recomputes fee from hardcoded trade averages (`channels.ts:43-46`, DD .25/UE .23/GH .20) × **net**, and ticket with a weaker guard. Grubhub shows a confident 20% bar where the real answer is "no published rate". Comment at `overview.ts:1302-1304` asserts the opposite of what the code does. `commissionFor` has exactly one consumer (channel-rows.tsx). |
| F3 | `blendedMargin` | Two same-named functions: `adapters/menu-hub.ts:231` (exported, `100 − cost/revenue×100`) and `adapters/product-mix.ts:238` (private, window-bridge). `adapters/menu-profit.ts:199` inlines the same formula. product-mix's `Unit.price` is `salesRevenue / qty` (`:190`), so its denominator IS recorded revenue — the defect is the name collision + triplication, not a third denominator. |
| F4 | Recipe cost on cycles | `src/lib/recipe-cost.ts:371` omits a cyclic recipe from the result map; `src/lib/recipe-cost-batch.ts:52-66` returns `{ totalCost: 0, partial: true }`. Orders page (`adapters/orders.ts:1528`) prices a cyclic plate at $0/partial while every other page shows it absent. |
| F5 | Overview food-cost delta | `adapters/overview.ts:479` computes "pts vs plan" from the **unrounded** ratio while printing the rounded figure — can render "28.4% · Plan 29.0% · −0.5 pts". `prime-cost.ts:101-104` documents deriving from the rounded value to avoid exactly this. |

Divergences that die with dead code (no fix task): `laborPct` scale collisions
(`labor-scorecard.ts`, `pnl-actions.ts:715` consumer paths), clock-drift
net-vs-gross (`lib/labor-leaks.ts` old page), avg-ticket variants D/E/F.

## 3. Dead code (~43k lines)

Verified by transitive reachability from the 260 Next entrypoints +
per-module grep. Deletion tranches:

- **D1 styles:** `src/styles/editorial-dashboard.css` (8,502 lines, zero imports).
- **D2 shadcn:** `src/components/ui/**` (31 files), `src/lib/utils.ts` (`cn`, all 48 importers dead), `components.json`, `src/hooks/use-mobile.ts`.
- **D3 chat:** `src/components/chat/**` (20 files incl. `chat.css`), plus `src/lib/chat/{composer,describe-error,hydrate-messages,thread-scroll,trend-rows,group-conversations}.ts`. **Exception:** `src/components/chat/tool-labels` is imported by the counter tree — keep (relocate later if desired).
- **D4 monitoring components:** `src/components/monitoring/**` (35 files); `src/lib/monitoring/{engagement,system-status,jwt-health,ingredient-audit,node-handlers,github-incidents}.ts`.
- **D5 analytics/charts + loose:** `src/components/analytics/**`, `src/components/charts/**`, `src/lib/{format,date-presets}.ts`, `src/components/pnl/pnl-date-presets.ts`, `app-sidebar.tsx`, `app-sidebar-client.tsx`, `store-selector.tsx`, `logout-dialog.tsx` (+`src/lib/logout.ts`), `invoice-sync-button.tsx` (+`use-invoice-sync.ts`), `otter-sync-button.tsx` (+`use-sync-progress.ts`), `skeletons.tsx`, `dashboard/route-error.tsx`, `dashboard/sort-affordance.tsx`, `recipe/provenance-chip.tsx`, `forecast/transfer-source-caption.tsx`, `hooks/use-is-phone.ts`, `(mobile)/m/more/switch-to-desktop.tsx`. **Keep:** `dashboard/welcome-marquee.tsx`, `telemetry/page-view-tracker.tsx`, `components/mobile/{page-head,panel}`.
- **D6 actions:** 10 zero-importer action files (`harri-actions`, `labor-productivity-actions`, `mobile-stock-count-actions`, `operational-actions`, `packaging-actions`, `product-usage-actions`, `store/dashboard-analytics-actions`, `store/labor-series-actions`, `store/menu-analytics-actions`, `store/order-patterns-actions`) + 7 test-only (`forecasts/labor-staffing-constants`, `forecasts/recipe-suggestion-actions`, `inventory/count-detail-actions`, `product-usage/data-actions`, `product-usage/recipe-actions`, `ingredient-auto-match-actions`, `pantry-ledger-actions`) + `actions/_shared/{auth-scope,date-range,variance}.ts` + `login/components/login-form.tsx`, `signup/[token]/components/signup-form.tsx`.
- **D7 lib orphans:** `cogs.ts` (731), `external-signals.ts` (+ sole-importer `weather-labels.ts`), `query-client.tsx`, `session-provider.tsx`, `menu-margin.ts`, `pnl-pace.ts`, `rotation-health.ts`, `harri-rotation-health.ts`, `github-credential.ts`, `pantry-attention.ts`, `pantry-format.ts`, `pantry-stations.ts`, `labor-leaks.ts`, `labor-scorecard.ts`, `operational-analytics-aggregation.ts`, `canonical-spend-batch.ts`, `decisions/ribbon.ts`, `dashboard/{channel-fold,lede,needs-you,range-label,store-label}.ts` (keep `dashboard/{model-call,splh-fold}.ts`), `src/types/{operations,product-usage}.ts`, dead half of `labor-week.ts` (keep `isoMondayUTC`, `isoDate`, `isoWeekStartsCovering`, `addDaysUTC`).
- **D8 API routes:** `api/stores`, `api/otter/seed-store`, `api/otter/orders-sync`, `api/auth/register`, `api/cron/vendor-lead-time`, `api/cron/harri/stores`. Verify-then-cut: `api/cron/harri-employees` (workflow runs the script instead).
- **D9 deps/config:** remove `@dnd-kit/*` ×4, `react-pdf`, `@tanstack/react-table`, `@tanstack/react-virtual`, `@hookform/resolvers`, `vaul`, `embla-carousel-react`, `input-otp`, `next-themes`; after D2-D5 also `@tanstack/react-query`, `@tanstack/react-query-devtools`, `react-hook-form`, `react-day-picker`, `class-variance-authority`, `clsx`, `tailwind-merge`, unused `@radix-ui/*`, `cmdk` (verify each at cut time). Remove `./src/pages/**` glob from `tailwind.config.ts`. Untrack `debug-harri-login.png` and `tmp/**` (41 files incl. data CSVs); gitignore both.
- **Paired tests to delete in the same commits:** `tests/lib/dashboard/*` (7), `tests/lib/format.test.ts`, `tests/app/actions/product-usage/*`, dead `tests/lib/monitoring/*`, `tests/lib/chat/group-conversations.test.ts`, and any test importing a deleted module (grep at cut time).
- **Hazards:** `tests/styles/token-parity.test.ts` matches file TEXT — a comment naming a pre-Counter class fails it. `src/lib/harri-token-store.ts` looks dead but is lazy-imported (`harri.ts:113`) — keep. `scripts/` orphans (25 files, ~7,400 lines) are a judgment call — NOT in scope of this plan.

## 4. Linter/docs drift

- `no-direct-data-import` runs on `.tsx` only (`counter-lint.ts:336`) and doesn't know `@/generated/prisma` — the specifier the repo actually uses (`@prisma/client` matches nothing live). `counter-alerts-client.tsx:34` imports it (type-only) in a page client today.
- `color-mix(` missing from linter `COLOUR_LITERAL` (the twin regex in `tests/styles/counter-components.test.ts:156` has it). `counter-repairs.css` uses token-only `color-mix` at 1181-1182, 1199-1203, 1396, 1445-1446.
- `counter-components.css` allowlist hides non-shadow literals: `:119` (`.navbtn .badge`), `:247` (`.classtag.PUZZLE`), `:765` (`.statebar button[aria-pressed]`), `:782` (`.loginmsg.is-warn .fi`), `:901-904` (`.toast`). Two of this class already repaired via `counter-repairs.css:127,146` — same pattern applies.
- Stale prose: `counter-lint.ts:405` (+`:139`), `DESIGN.md:246-254` (exemption ruling S-R5 describes pre-`Promise.all` code), `docs/refactor-playbook.md:123`, `overview.ts:1302-1304` (F2 fixes it).
- `(mobile)/m/login` is a Counter page outside `(counter)` — loading/error/streaming rules can't reach it. Harmless today; document or move (document only in this plan).

## 5. Monitoring all-tenant reads (policy decision required)

`monitoring-people.ts` (`:138,160,165,173,473`), `monitoring-ingredients.ts`
(`:110,125,127,128,148,158`), `monitoring-ml.ts` (`:181,198`),
`monitoring-tabs.ts:479` read tenant business data globally; `monitoring.ts`'s
docblock concedes `hasOwnerAccess` is true for every logged-in user. Options:
(a) gate `/dashboard/admin/monitoring/**` + `/m/monitoring/**` behind
`role === "DEVELOPER"`, keep global reads; (b) account-scope the queries;
(c) both. Decision is the owner's; infra-only tables (`JobRun`, `ErrorEvent`,
etc.) stay global under every option.
