# Dashboard Redesign Recommendations — Page-by-Page Audit

_Date: 2026-05-09_
_Author: Claude (recommendations only — no code changes)_

---

## 1. Frame

This is a recommendations doc, not a plan. Each route in `src/app/dashboard/*` gets a consistent template — what works, what's broken (with file:line), top 3 moves, signal-placement opportunity, density observation. The user reads it and picks which subset becomes a real spec.

### The editorial-docket lens, in one paragraph

The dashboard runs a deliberate "editorial docket" design system: warm cream paper (`var(--paper)`), Fraunces italic serif for prose and display only, DM Sans 500–600 with `font-variant-numeric: tabular-nums lining-nums` for **all** numbers, JetBrains Mono uppercase for captions and folios, hairline-bold borders, 2px radii, no shadows, and a single proofmark red `var(--accent)` reserved for state. Sections compose with `.inv-panel` (not shadcn `<Card>`); rows hover with the `.inv-row` / `.order-row` pattern (a 4px red accent bar that `scaleY(0→1)` from the left while the row washes to a faint red). The five tripwires that recur in CLAUDE.md cover (1) generic Tailwind colors on `/dashboard/*`, (2) wrong typography for numbers, (3) wrong hover pattern, (4) shadcn `<Card>` instead of `.inv-panel`, (5) splitting files >400 lines without the refactor playbook.

### The three new signals — and where they live today

The repo has acquired three powerful signals in the last few sprints, and **all three are currently buried inside one card**:

1. **Weather** — `prisma.storeWeatherSignal` (Open-Meteo, hourly per store, WMO codes). Surfaced only as a concatenated string in `LaborStaffingCard`'s "Pressure" column tooltip (`labor-staffing-card.tsx:37–40`). Heavy rain / thunderstorm (codes 95, 96, 99) is flagged as severity "high" but rendered identically to mild signals.
2. **Labor** — Harri LiveWire actuals + ML labor forecast. Rendered as a 7-row "actuals · prior 7 days" table tucked at the bottom of `LaborStaffingCard` (lines 42–93). Variance turns red on overspend; that's the only color signal.
3. **PredictHQ events** — `prisma.storeEventSignal` (per-store-per-day aggregates: `hospitalityImpact`, `hospitalitySpend`, `attendance`, plus per-category counts for sports / concerts / festivals / performing arts / community / conferences / expos) **and** `prisma.storeEventDetailSignal` (per-event rows with `title`, `category`, `attendance`, `localRank`, `venueName`, `distanceMiles`, indexed by `(storeId, date, localRank DESC)` for fast "top N per day" reads). Sync at `ml/external_signal_sync.py` calls both `/v1/features/` and `/v1/events/`. Currently surfaced only as a flat `day.drivers.map(d => d.label).join(" · ")` string in `labor-staffing-card.tsx:37–40` — the rich payload (named events, attendance, impact, venue) is queried by `labor-staffing-actions.ts:192–211` and immediately collapsed.

The opportunity: these are the signals an operator most wants to see *first* on Monday morning. They're hidden in the deepest tab of the most complex card. Most of the moves below either re-home them or add new surfaces for them.

### The lens applied to every route below

- **Editorial fit** — does the route follow the docket? (1 = ad-hoc shadcn; 5 = pristine.)
- **Signal use** — does the route surface or could it surface weather / event / labor signals? (1 = no signal context; 5 = first-class signal placement.)
- **Density** — is the information-per-pixel tuned right? (1 = sparse dead zones or crowded clipping; 5 = scannable and complete.)

A score of 3/5 on Signal Use does NOT mean "broken" — it means "could absorb a signal without needing a redesign." Many routes legitimately don't need weather context; that's noted.

---

## 2. Per-Route Audit

### `/dashboard/forecasts`

**Purpose:** Forward-looking ML portfolio: revenue, menu, costs, operations, anomalies — all behind a 5-tab ribbon.
**Files audited:** `src/app/dashboard/forecasts/page.tsx`, `components/forecasts-ribbon.tsx`, `components/forecasts-briefing.tsx`, `components/revenue-forecast-card.tsx`, `components/labor-staffing-card.tsx`, `components/anomaly-feed.tsx`, plus the 8 sibling cards.
**Scores:** Editorial fit 5/5 · Signal use 2/5 · Density 4/5

#### What works

- Universally uses `.inv-panel` — no shadcn `<Card>` anywhere in the route. Briefing, revenue card, labor card, anomaly feed all consistent.
- Numbers render correctly: `forecasts-briefing.tsx:8` defines a reusable `tabular` constant; `revenue-forecast-card.tsx:93–94`, `labor-staffing-card.tsx:68/80/196`, `channel-mix-card.tsx:54/84/90/96/102` all enforce `fontVariantNumeric: "tabular-nums lining-nums"` inline alongside `tabular-nums` className.
- Accent red is used only for state — `labor-staffing-card.tsx:24/32` paints "thin schedule" red; `anomaly-feed.tsx:85` highlights downside residuals red. Color is information, not decoration.
- The ribbon (`forecasts-ribbon.tsx`) is exemplary editorial nav — `§` section marks, `aria-current="page"`, `scroll={false}` to suppress jumps. This is the pattern to copy elsewhere.
- Per-section Suspense boundaries with `ForecastSectionFallback` skeletons stream cards independently — revenue-extras (food-cost, cash-position, channel-mix, promo-roi) load in parallel after the main revenue card.

#### What's broken

- **The hover red is hardcoded, not tokenized.** Ten components write `hover:bg-[rgba(220,38,38,0.045)]` literally: `labor-staffing-card.tsx:184`, `anomaly-feed.tsx:67`, `food-cost-forecast-card.tsx:123`, `channel-mix-card.tsx:72`, `promo-roi-card.tsx:84`, `vendor-reliability-card.tsx:86`, `lost-sales-card.tsx:75`, `menu-item-forecast-table.tsx:65`, `launch-trajectory-card.tsx:95`, `waste-cluster-card.tsx:109`. If you ever change the accent hue, you have ten edits to make. There's no `--row-hover-bg` token.
- **Weather and event signals are tooltip-grade.** `labor-staffing-card.tsx:37–40` renders `day.drivers.map(d => d.label).join(" · ")`. Severity "high" (heavy rain / thunderstorm) and severity "low" both render as plain `var(--ink-muted)` text with the same dot separator. The model knows the severity; the UI throws it away.
- **No briefing-level summary of external pressure.** `forecasts-briefing.tsx` shows revenue MAPE, anomaly count, etc. — but no "this week's weather: 2 storm days flagged" or "3 catering events forecast." The most actionable forward-looking facts are buried two clicks deep.
- **The 5-tab ribbon assumes equal weight.** "Anomalies" is a *response*, not a *forecast category* — it deserves its own surface or to live in the briefing. Same for the orphaned `cash-position-card` and `profit-risk-card`, which sit awkwardly inside Revenue and Operations respectively.

#### Top 3 moves

1. **Promote the external-signals strip to above the ribbon.** Build one component — `<ExternalSignalsStrip />` — that renders three rows for today and the next 6 days. Row 1: weather (Open-Meteo WMO icon + label per day, severity-tinted for codes 95/96/99). Row 2: PredictHQ events — top 1–2 named events per day pulled from `StoreEventDetailSignal` ordered by `localRank DESC`, rendered as `"Sat · Lakers vs Warriors (18k attendance · localRank 88)"` with category chips behind them. Row 3: labor-pressure summary (understaffed / balanced / overstaffed day count) from the existing `LaborStaffingData.days[].staffingRisk`. Place it above `<ForecastsRibbon />` so every tab inherits the context. Reuses `forecasts-briefing.tsx` typographic patterns. **Effort: M.** This is the highest-leverage change in the route — the new signals stop being tooltip easter eggs and start carrying named, ranked content.
2. **Tokenize the hover row treatment.** Add `--row-hover-bg: color-mix(in oklab, var(--accent) 4.5%, transparent)` to `globals.css`, then sweep the 10 hardcoded `rgba(220,38,38,0.045)` instances. While doing it, audit whether each row even needs the treatment — anomaly feed rows aren't really "interactive lists" the way menu-item-forecast-table rows are. **Effort: S.** Pure hygiene, but unlocks future palette shifts.
3. **Move "Anomalies" out of the ribbon and into the briefing.** Anomalies aren't a forecast category — they're an exception list. Render the count inline in the briefing ("3 anomalies open · 1 demands review"), and link to a `/dashboard/forecasts/anomalies` sub-route or a dialog when the count > 0. The 5-tab ribbon becomes a 4-tab ribbon (Revenue / Menu / Costs / Operations) — symmetric and faster to scan. **Effort: M.**

#### Signal-placement opportunity

The strip in move #1 covers the route. Secondary opportunity: tag each row in `anomaly-feed.tsx` with a small chip indicating whether the spike is weather-correlated (`weather-driven` vs `unexplained`). The model already knows; the UI doesn't say.

#### Density

Well-tuned. Revenue card has appropriate breathing room around the chart. Labor grid is dense but justified. Anomaly feed is appropriately short (z ≥ 3 gate). No below-the-fold dead zones.

---

### `/dashboard/analytics`

**Purpose:** Date-range-filtered historical aggregation — revenue heatmaps, channel mix, menu rankings, multi-store comparison.
**Files audited:** `src/app/dashboard/analytics/page.tsx`, `components/analytics-shell.tsx`, `components/sections/revenue-trends-section.tsx`, `components/sections/topbar-bits.tsx`.
**Scores:** Editorial fit 5/5 · Signal use 1/5 · Density 4/5

#### What works

- Topbar follows the editorial pattern cleanly — `§ 06` section marker, inline date-range stamp, role-gated sync button (`analytics-shell.tsx:45–50`).
- `DashboardSection` wrapper enforces consistent grid layout. Revenue trends use `lg:grid-cols-5` for a responsive heatmap slot. No shadcn imports.
- Skeleton fallbacks (`ChartSkeleton`, `PieChartSkeleton`, `HeatmapSkeleton`) are accessible — `aria-live="polite"`, "syncing…" text. No color tripwires in the audited files.
- `space-y-8` between sections, `p-4 sm:p-6` padding — consistent vertical rhythm.

#### What's broken

- **Zero signal context.** The revenue heatmap is a calendar-of-days grid showing $ delta per day. There is no overlay for weather, no event marker, no labor-pressure mark. A 12% Tuesday revenue spike could be Mother's Day, could be a storm closing competitors, could be a TikTok video — the user can't tell from the page.
- **Section-level skeletons load independently but aren't progressively meaningful.** All four sections begin loading at once; an operator scrolling looks at a wall of dots. No "above the fold loads first" prioritization.

#### Top 3 moves

1. **Layer event/weather indicators on the revenue heatmap.** Each calendar cell already shows revenue delta. Add two thin accent bars on the cell border: top-edge for weather severity (faint yellow for warn, accent for storm); right-edge intensity scaled to `StoreEventSignal.hospitalityImpact` (proofmark dot for low impact, full bar for high). Tooltip names the largest event of that day from `StoreEventDetailSignal` ordered by `localRank DESC` ("Beyoncé Renaissance Tour · 42k predicted attendance · 1.8 mi"). Turns the heatmap from "what happened" into "what *caused* what happened" — currently the chart can only tell you *that* Tuesday was hot. **Effort: M.** Reuses `StoreWeatherSignal`, `StoreEventSignal`, and `StoreEventDetailSignal` queries already shaped for this access pattern.
2. **Add a "context band" above the heatmap.** A single horizontal strip showing the date range's weather and event summary: "Range: 28 days · 4 storm days · 6 events · 2 closures." The operator orients before reading the chart. Reuses the strip from forecasts move #1 — *this is the cross-cutting external-signals strip*. **Effort: S** if the strip exists from forecasts work.
3. **Prioritize section streaming.** Render revenue-trends first (above the fold), defer multi-store comparison and operational KPIs. Currently all four sections compete for first paint. **Effort: S** — adjust Suspense boundary order in `analytics-shell.tsx`.

#### Signal-placement opportunity

Moves 1 and 2 cover it. The heatmap is *the* natural anchor for weather/event signals on this route.

#### Density

Healthy. Sections use `space-y-8`, no crowding. Below-the-fold risk on multi-store comparison if the store count grows past 8 — currently fine.

---

### `/dashboard/labor`

**Purpose:** Weekly Harri labor cost variance across all stores — KPI strip, store ranking, 13-week trend.
**Files audited:** `src/app/dashboard/labor/page.tsx`, `components/labor-week-kpis.tsx`, `components/labor-stores-panel.tsx`, `labor.css`.
**Scores:** Editorial fit 5/5 · Signal use 3/5 · Density 4/5

#### What works

- Custom `.labor-*` class suite isolates styling from any global Tailwind bleed. Zero color tripwires.
- KPI numbers use `font-variant-numeric: tabular-nums lining-nums` plus DM Sans 600 (`labor.css:191`).
- All panels wrap in `.inv-panel` (`labor.css:270`). Row hover uses the canonical 4px scaleY accent stripe (`.labor-stores__row::before`, `labor.css:657`).
- Foreground hierarchy is textbook: Fraunces italic serif for store names and dates, JetBrains Mono caps for labels, DM Sans for metrics.

#### What's broken

- **The hardcoded hover red again.** `labor.css:256` writes `background: rgba(220,38,38,0.045)` literally. Same problem as forecasts; same fix.
- **Labor pressure is implicit, not surfaced.** The KPI strip shows raw counts (alerts this week) but no severity ranking. "2 stores spike >15% variance" would be a useful headline; currently the operator has to scan the store table to find them.
- **The 13-week trend has no reference band.** It's a 140px chart with zero annotations. A faint band at ±5% vs forecast would let operators see seasonal drift at a glance.

#### Top 3 moves

1. **Add a labor-pressure callout on the week-nav header.** A red pill stamp next to the week selector when ≥1 store crosses a critical variance threshold ("3 critical · 5 watch"). Adjacent to it, a causal context line drawn from PredictHQ + Open-Meteo: "Sat understaffed · Lakers home + Adele tour · 60k combined attendance" (top events from `StoreEventDetailSignal` for the week, joined by store). Operators get to act on a *reason*, not just a count. **Effort: S** for the pill alone, **M** with the full causal context (one server-side join across `StoreEventDetailSignal` and Harri variance).
2. **Overlay a ±5% reference band on the 13-week trend.** Two faint horizontal hairlines at the variance threshold. Recharts supports `<ReferenceArea>` directly. **Effort: S.**
3. **Tokenize `labor.css:256`.** Same `--row-hover-bg` cleanup as forecasts. Bundle with the forecasts sweep. **Effort: S.**

#### Signal-placement opportunity

The week-nav is the natural home for weather/event signals on this route — labor variance is *causally* tied to weather and events, so the context belongs in the same eyeline.

#### Density

Well-spaced. KPI strip reflows 4→2 cols on tablet correctly. Store rows have 18px vertical padding, no crowding. No below-the-fold dead zone — the 13-week trend sits within first-scroll on a 1080p viewport.

---

### `/dashboard/operations`

**Purpose:** Multi-section operational health — weekly spend/revenue trends, cost-per-order, gross margin, category spending.
**Files audited:** `src/app/dashboard/operations/page.tsx`, `components/operations-content.tsx`, `components/operations-charts.tsx`.
**Scores:** Editorial fit 3/5 · Signal use 2/5 · Density 3/5

#### What works

- Recharts axes and gridlines use `var(--hairline)`, `var(--ink-muted)`, `var(--chart-*)` consistently (`operations-charts.tsx:46–100`).
- KPI cards use `.editorial-kpi` with a `data-emphasis="lede"` modifier on the cost-per-order card (`operations-content.tsx:240`). Colour variance is driven by `data-tone="up|down|alert"` enum, not ad-hoc Tailwind.
- Section headers use `.editorial-section-label` (`operations-charts.tsx:33`).

#### What's broken

- **shadcn destructive tokens leaking in.** `operations-content.tsx:85` uses `border-destructive/50 bg-destructive/10`. Same again at line 137 with `border` + `text-muted-foreground`. These are shadcn defaults, not editorial tokens — they'll pick up the wrong red and the wrong gray.
- **No `.inv-panel` on error/empty states.** Error containers use `rounded-lg` (arbitrary radius) instead of the docket's 2px hairline-bold pattern. Inconsistent with labor / cogs / pnl error states.
- **Cost-per-order has no narrative.** The KPI shows the number; it doesn't explain whether the trend is driven by labor efficiency, ingredient prices, or volume changes.

#### Top 3 moves

1. **Replace shadcn destructive classes with editorial tokens.** Map `border-destructive/50` → `border-(--hairline-bold)`, `bg-destructive/10` → `bg-(--accent-bg)` (add this token if not present). Same sweep for `text-muted-foreground` → `text-(--ink-muted)`. **Effort: S.** Two files; a single morning's polish.
2. **Wrap error/empty states in `.inv-panel`.** Match the visual treatment used elsewhere; remove `rounded-lg`. **Effort: S.**
3. **Add a "what changed" line under the cost-per-order KPI.** One sentence: "labor +8% · revenue +6% → CPO flat." This is computable from existing data and turns a dumb number into a signal. **Effort: M** — needs a small server-action helper to compute the deltas. **Could also weave in event/weather context** ("CPO up 14% — 2 storm days dropped revenue while staffing held").

#### Signal-placement opportunity

Cost-per-order narrative (move #3) is the natural anchor. Could also overlay weather days as faint vertical bands on the weekly spend/revenue chart in `operations-charts.tsx`.

#### Density

KPI grid is dense but adequate. Weekly charts are appropriately tall. Mobile stacks correctly. No below-the-fold dead zones.

---

### `/dashboard/pnl`

**Purpose:** Consolidated P&L across stores — waterfall, league table, side-by-side comparison.
**Files audited:** `src/components/pnl/pnl-page-client.tsx`, `src/components/pnl/pnl-waterfall.tsx`, `src/components/pnl/pnl-league-table.tsx`, `src/components/pnl/pnl-all-stores-client.tsx`.
**Scores:** Editorial fit 4/5 · Signal use 1/5 · Density 4/5

#### What works

- Waterfall uses CSS grid + custom properties (`--bar-top`, `--bar-scale`) for bar geometry. DM Sans 600 on amounts (`pnl-waterfall.tsx:119`). No backdrop-blur or stripe violations.
- League table rows use `.pnl-league__row--link`; best/worst stamps use semantic classes (`.pnl-league__stamp--best`, `--worst`) — colour stays in CSS, not in JSX.
- Bullet meters in league table cells (`pnl-league-table.tsx:119–143`) decouple visual from text — strong pattern.

#### What's broken

- **Same shadcn destructive leakage as operations.** `pnl-all-stores-client.tsx:85` writes `rounded-lg border border-destructive/50 bg-destructive/10 text-destructive`. Line 137 repeats the pattern. Should be tokenized.
- **Skeleton heights are arbitrary.** `pnl-all-stores-client.tsx:79–82` uses `h-48 / h-70 / h-65 / h-105`. No skeleton theming for the cream-paper background — they appear visually jarring during load.
- **League table has no momentum signal.** "Worst" stamp tells you the rank now; nothing tells you whether the store is improving or deteriorating ("↓ 3pp vs last period").
- **The waterfall is static.** No tooltip / detail row explaining what drove a drop ("Rent absorbed +3pp of margin vs prior month").

#### Top 3 moves

1. **Add a momentum column to the league table.** One delta value per store: "↑ 1.4pp" (small DM Sans, accent if negative). Non-trivial because it requires the prior period's P&L to be queried alongside, but the SQL exists in `pnl-actions.ts`. **Effort: M.** This is the single most useful improvement to this route.
2. **Annotate the waterfall.** On hover (or always, for the largest delta), surface "vs prior month: +/-X.Xpp" inline. Rent, COGS, Labor are the bars users will most want context for. **Effort: M.**
3. **Sweep destructive tokens + skeleton heights.** Same as operations. Bundle into a single PR. **Effort: S.**

#### Signal-placement opportunity

Nowhere natural. P&L is a backward-looking fiscal statement — weather and events don't directly belong here. Skip on this route.

#### Density

Waterfall is compact and well-scaled. League table has 7 columns; mobile truncates store names with ellipsis (acceptable). Below-the-fold risk on store comparison panel — users on 800px viewports may not see it.

---

### `/dashboard/cogs`

**Purpose:** 30-day COGS tracking — store ledger with target tracking, hero %, trend chart, worst-margin items.
**Files audited:** `src/app/dashboard/cogs/page.tsx`, `components/cogs-hero-pct.tsx`, `components/cogs-trend-chart.tsx`, `components/sections/worst-margin-items-section.tsx`.
**Scores:** Editorial fit 4/5 · Signal use 2/5 · Density 3/5

#### What works

- Page uses `.inv-panel` + `.cogs-store-ledger` grid (`page.tsx:46–103`). No shadcn Card imports.
- Trend chart uses recharts with editorial bindings: `stroke="var(--hairline)"`, `fill: "var(--ink)"`, `stroke="var(--chart-accent)"`. Clean.
- Worst-margin items render numbers with `font-mono text-[15px] tabular-nums` (`worst-margin-items-section.tsx:82`).
- Hero COGS % animates via `easeOutCubic` — no `bg-clip-text` gradients, no decorative blur. Disciplined.

#### What's broken

- **Mixed variable syntax in the same file.** `worst-margin-items-section.tsx:61` uses `text-(--ink)` (Tailwind v4 var() syntax) while line 68 uses `gap-1.5` (Tailwind class). Not broken per se, but inconsistent — pick one and stick with it.
- **`divide-y divide-(--hairline)` won't work as written.** Tailwind v4's `divide-color-(--hairline)` is the correct syntax for using a custom property as the divide color. The current shorthand may render the default divide color.
- **Store ledger header isn't an `.inv-panel`.** `page.tsx:43` uses a plain `<div className="flex flex-col">`. The ledger table itself is a panel; the header floats above without one.
- **Risk column is a plain count.** No color tinting when warning count exceeds a threshold; visually uniform with healthy stores.

#### Top 3 moves

1. **Tint risk-heavy ledger rows.** When a store has ≥3 warnings, paint the row background `color-mix(in oklab, var(--accent) 4%, transparent)`. Reuses the same accent-tint formula proposed for the row-hover token. **Effort: S.**
2. **Surface "ingredient price spike" callout.** When the trend chart's recent slope crosses a threshold, render a one-line callout above the chart: "Beef +12% week-over-week — affecting 4 worst-margin items." Wires the chart and the worst-margin section together. **Effort: M.**
3. **Fix the divide syntax + collapse risk column to icon on mobile.** Hygiene + responsive polish. **Effort: S.**

#### Signal-placement opportunity

Limited but real: vendor reliability signals (already a forecasts card) could live here as a cross-link. Weather doesn't naturally fit — COGS is mostly procurement, not consumption.

#### Density

Ledger has 8 columns and gets tight below 1024px. No horizontal scroll affordance — text just shrinks. Worst-margin mobile view uses `flex flex-col` with `py-3` — readable but loose.

---

### `/dashboard/invoices`

**Purpose:** Supplier invoices — KPIs, spend trend, invoice list, top products by spend, PDF viewer.
**Files audited:** `src/app/dashboard/invoices/page.tsx`, `components/invoices-shell.tsx`, `components/sections/summary-kpis-section.tsx`, `components/sections/invoices-list-section.tsx`, `components/sections/top-products-section.tsx`, `[id]/components/pdf-viewer-client.tsx`.
**Scores:** Editorial fit 4/5 · Signal use 1/5 · Density 4/5

#### What works

- CSS custom-property theming throughout — `var(--ink)`, `var(--hairline)`, `var(--accent)` everywhere. No generic Tailwind colors.
- Tabular-nums applied correctly on monetary and quantity columns: `top-products-section.tsx:129/143/149` uses `[font-variant-numeric:tabular-nums_lining-nums]`; spend-trend client uses inline `fontVariantNumeric` style.
- `inv-panel`, `inv-kpis`, `inv-row` enforce density and spacing. No rogue shadcn primitives.
- Per-section error boundaries — invoice scan never blocks UI streaming.

#### What's broken

- **Decorative `backdrop-blur` on the PDF viewer toolbar.** `[id]/components/pdf-viewer-client.tsx:1` applies `backdrop-blur` on a toolbar that's already at 90% opacity. No legibility benefit; pure GPU cost.
- **KPI counts skip tabular alignment.** `summary-kpis-section.tsx:27–49` renders `toLocaleString()` inside plain `<span>` — no `font-variant-numeric` or monospace fallback. Counts like 1,234 vs 12,456 misalign visually across the KPI strip.
- **Invoice status pills live in a separate CSS namespace.** Color mapping wasn't visible in the audited files; risk of drift from the editorial palette if pills were authored in isolation.

#### Top 3 moves

1. **Add tabular-nums to KPI counts.** Apply the same `font-variant-numeric: tabular-nums lining-nums` + DM Sans 500 enforcement on the four KPI numbers. **Effort: XS.** Two minutes of work; outsized scanability gain.
2. **Strip the decorative backdrop-blur on PDF toolbar.** Replace with a solid `var(--paper)` background. **Effort: XS.**
3. **Add a "price variance" signal under the spend trend.** When a vendor's per-unit cost on a SKU crosses a variance threshold, surface the SKU with a delta — "Beef tenderloin: $14.20 → $16.40 (+15%) — 3 invoices this week." This is the most useful possible insight for invoice review. **Effort: M.** Reuses ingredient price-history data that already exists.

#### Signal-placement opportunity

Weather/events don't fit. Vendor and price-variance signals (move #3) are the natural ones for this route.

#### Density

KPI strip dense (4 cards), spend chart full width, top-products table collapsible. Mobile clarity unclear — desktop assumes 1024px+.

---

### `/dashboard/menu`

**Purpose:** Menu item catalog with pricing, recipe costing, margin analysis, profitability ranking.
**Files audited:** `src/app/dashboard/menu/catalog/page.tsx`, `components/menu-catalog-shell.tsx`, `components/menu-catalog-content.tsx`, `components/sections/catalog-rows-section.tsx`.
**Scores:** Editorial fit 4/5 · Signal use 2/5 · Density 4/5

#### What works

- Editorial topbar consistent with invoices (§ 12, paper, hairline tokens).
- Virtualized list via `@tanstack/react-virtual` — 100+ menu items don't bloat the DOM.
- Attention-mask bitfield (`ATTENTION_BITS`, `ATTENTION_CONFIG`) keeps UI concerns separate from business logic. Filter pills use tone tokens ("alert", "warn", "ink") rather than hardcoded colors.
- `useDeferredValue(query)` keeps search input responsive during re-virtualization.

#### What's broken

- **`marginBandClass` import suggests dynamic margin styling but the source classes weren't audited.** If they fall back to `bg-emerald-*` / `text-red-*`, that's a tripwire violation. Verify before shipping anything else here.
- **Sort preference persisted to localStorage without validation.** `SORT_STORAGE_KEY = "menu-catalog-sort-v1"` — a malformed value could crash the sort reducer at hydration. Need a runtime guard or a Zod schema.
- **No Suspense boundary between filter changes and row re-virtualization.** Fast filter clicks can cause flicker.
- **No horizontal-scroll affordance on small viewports.** Quantity/cost/margin columns just clip below ~900px.

#### Top 3 moves

1. **Audit `marginBandClass` and convert any generic Tailwind colors.** This is a verification task as much as a fix — find the file, check the classes, swap to tokens if needed. **Effort: S.**
2. **Add a demand-forecast pill column.** The forecasts page already computes per-menu-item demand (`menuItemForecastTable`); the catalog should at minimum show whether each item is "trending up / flat / down" based on the next-7d forecast. Tiny inline sparkline or up-arrow chip. **Effort: M.** Connects two surfaces that currently live in isolation.
3. **Validate localStorage sort key.** Wrap the read in a try/catch with a default fallback. **Effort: XS.**

#### Signal-placement opportunity

Demand-forecast pill (move #2) is the natural signal anchor. Weather/events less so — *unless* you want to flag items that historically spike on storm days ("cocoa drinks: storm-correlated demand"). That's a powerful insight but a much larger spec.

#### Density

High but virtualized — handles it. Toolbar is reasonable. Horizontal clipping below 900px is the main weakness.

---

### `/dashboard/recipes`

**Purpose:** Recipe editor with menu item catalog, ingredient lists, costing, ML-powered ingredient mapping.
**Files audited:** `src/app/dashboard/recipes/page.tsx`, `components/recipes-shell.tsx`, `components/recipes-content.tsx`, `components/sections/recipe-editor-section.tsx`, `components/recipe-canvas.tsx`.
**Scores:** Editorial fit 3/5 · Signal use 1/5 · Density 3/5

#### What works

- `RecipeCanvas` is dynamically imported (`next/dynamic`, `ssr: false`) — dnd-kit and recipe logic are deferred until the editor mounts.
- Two-pane layout (`grid-cols-[280px_1fr]`) with proportional skeleton prevents CLS.
- Inline CSS var theming on modal content (`SheetContent style` line 437–449) prevents Tailwind color bleed into recipe modals.
- Batch confirmation gates ML ingredient mappings at ≥0.75 similarity — user audits before confirm. No silent mapping.

#### What's broken

- **Decorative `backdrop-blur-[2px]` on modal overlays.** `ingredient-picker-sheet.tsx:1`, `match-picker-sheet.tsx:1`. No legibility benefit; GPU cost on low-end devices.
- **Two different modal implementations in the same route.** Some sheets use inline CSS var injection (good); others use `bg-[#1a1613]/35 backdrop-blur` with hardcoded hex (bad). Copy-paste drift.
- **Loading button states aren't visually distinct.** `createPending`, `seedPending`, `batchPending` states don't change opacity or color — users can't tell something's working.
- **Ingredient cost rows have no price-history context.** A recipe priced today doesn't know that beef went up 12% this week.

#### Top 3 moves

1. **Strip the decorative `backdrop-blur` from sheet overlays.** Replace with a solid 35% paper wash. **Effort: XS.**
2. **Unify modal overlay styling.** Pick one approach (CSS var inheritance) and convert the hardcoded-hex sheets. Document the chosen pattern in `docs/frontend-patterns.md`. **Effort: S.**
3. **Add a "cost trend" sparkline in each ingredient row of the recipe editor.** Last 30 days of per-unit cost. Operators editing recipes immediately see which ingredients are getting expensive. **Effort: M.** Reuses existing ingredient price history.

#### Signal-placement opportunity

Recipe editor itself doesn't naturally absorb weather/event/labor signals — those are operational, not bill-of-materials. Cost trend (move #3) is the right signal here.

#### Density

Two-pane is comfortable on desktop. Mobile collapses to Sheet — but the canvas itself sprawls (ingredient rows × picker × quantity × unit × notes × cost). Accept the sprawl; recipes are inherently dense.

---

### `/dashboard/ingredients`

**Purpose:** Ingredient catalog with price history, unmatched-line-item review queue, modifier mapping.
**Files audited:** `src/app/dashboard/ingredients/page.tsx`, `components/ingredients-shell.tsx`, `components/sections/pantry-section.tsx`, `components/ingredient-detail-sheet.tsx`, `components/match-picker-sheet.tsx`.
**Scores:** Editorial fit 3/5 · Signal use 1/5 · Density 3/5

#### What works

- Shell wraps two independent sections (Pantry + SubItems) with separate error boundaries — modifier drawer never blocks pantry streaming.
- Canonical ingredient list fetched server-side; client mutation refreshes via action + setState (no optimistic mismatches).
- Detail and match-picker sheets use inline CSS var theming on most surfaces.

#### What's broken

- **Same `backdrop-blur-[2px]` decoration on `ingredient-detail-sheet.tsx:1`, `match-picker-sheet.tsx:1`.** Same fix as recipes.
- **Pantry section has joint failure mode.** `listCanonicalIngredients` and `listUnmatchedLineItems` are fetched in parallel — if either errors, the whole `PantryView` errors. Unmatched queue should stream independently with its own boundary.
- **Two modal styling implementations** — one uses inline CSS var inheritance, another uses hardcoded `bg-[#1a1613]/35`. Copy-paste artefact.
- **No per-ingredient price-history visualization on the catalog itself.** You have to open the detail sheet to see trend.

#### Top 3 moves

1. **Inline a price-history sparkline in each ingredient tile.** Last 30 days. Surfaces volatility at a glance, makes the catalog dramatically more useful. **Effort: M.**
2. **Split unmatched queue into its own Suspense boundary.** Pantry view shouldn't disappear when the unmatched query times out. **Effort: S.**
3. **Strip backdrop-blur + unify modal styling** (bundled with recipes work). **Effort: S.**

#### Signal-placement opportunity

"Variance from vendor average" badge on each ingredient (red/yellow flag during shortages or supplier mispricing). Weather/events don't apply to procurement.

#### Density

Moderate. Category sidebar + tile grid + collapsed modifier drawer. Pantry tiles reflow responsively. Review-inbox counter badges live in the editorial topbar — keeps main area uncluttered.

---

### `/dashboard/orders`

**Purpose:** Daily orders across platforms — list, filter, detail drill-down, fulfillment tracking.
**Files audited:** `src/app/dashboard/orders/page.tsx`, `components/orders-content.tsx`, `components/order-row.tsx`, `[id]/order-detail-content.tsx`.
**Scores:** Editorial fit 4/5 · Signal use 2/5 · Density 4/5

#### What works

- Sticky headers use `var(--hairline)` borders + paper opacity for proper docking (`orders-content.tsx:114`, `order-detail-content.tsx:47`).
- Order rows use `text-[var(--ink)]`, `text-[var(--ink-muted)]`, `text-[var(--ink-faint)]` — proper semantic hierarchy.
- Receipt section uses a subtle white wash (`bg-[rgba(255,255,255,0.4)]`) — not a shadcn Card; aligns with the docket.
- Totals use `font-display-tight` at 56→72px scale — strong typographic emphasis.

#### What's broken

- **`backdrop-blur-md` on sticky headers is decorative.** Solid paper would suffice; the blur trades scroll-anchor clarity for motion polish. Two locations.
- **Total fractional cents lack tabular enforcement.** `order-detail-content.tsx:157–159` uses only the Tailwind `tabular-nums` class on the cents span — no inline `font-variant-numeric`. Inconsistent with forecasts where both are enforced.
- **Ledger rows lack tabular-nums.** `<LedgerRow>` components (`order-detail-content.tsx:172–183`) render money without numeric variant — decimal alignment breaks across rows.

#### Top 3 moves

1. **Enforce tabular-nums on every money render in the detail view.** Add the inline style + DM Sans weight pattern to `<LedgerRow>` and the cents span. **Effort: XS.**
2. **Replace decorative backdrop-blur with solid paper on sticky headers.** **Effort: XS.**
3. **Add a per-platform anomaly slot above the ledger.** When the order's platform has a current incident (Uber refund surge, processor delay), a one-line callout. Requires platform-incident data; could start with a stub. **Effort: M.**

#### Signal-placement opportunity

Per-platform incident signal (move #3) is the natural fit. Weather doesn't apply at the individual-order level.

#### Density

Order list virtualizes correctly (72px row, 8px gap). Detail splits 1.6:1 manifest:receipt — appropriate. Mobile collapses cleanly.

---

### `/dashboard/monitoring`

**Purpose:** System health — six subsystem pills, daily error/cost/login charts, drilldown tabs (Infrastructure, People, Costs, ML, Ingredients, Activity, Cache).
**Files audited:** `src/app/dashboard/monitoring/layout.tsx`, `page.tsx`, `infrastructure/page.tsx`, `src/components/monitoring/bridge/system-health-strip.tsx`, `src/components/monitoring/bridge/tab-strip.tsx`, `src/components/monitoring/system-color.ts`.
**Scores:** Editorial fit 4/5 · Signal use 3/5 · Density 3/5

#### What works

- `SYSTEM_INK` / `STATUS_COLOR` system separates identity ink from status tone cleanly. Status uses `--ink-ledger` (ok), `--ink-ochre` (warn), `--accent` (danger) — semantic editorial tokens.
- Panels use `.inv-panel` consistently with `fraunces17` for serif table headers.
- `styles.ts:16–22` exports a `number` style with `fontVariantNumeric: "tabular-nums lining-nums"` — applied uniformly across panels.
- TabStrip uses `var(--accent)` only for the active border (`tab-strip.tsx:42`) — no generic Tailwind nav colors.

#### What's broken

- **Two-source-of-truth on color tokens.** `SYSTEM_INK` enum is defined in TypeScript (`system-color.ts:10–17`) referencing CSS custom properties (`--ink-stamp`, `--ink-terracotta`, etc.). If the CSS token name changes, the TS enum silently breaks at render — no compile error. This is a latent bug waiting to happen.
- **Database panel hardcodes accent ternary** (`database-panel.tsx:17–22`) using `"var(--accent-dark)"` and `"var(--accent)"` directly instead of delegating to a `STATUS_COLOR` helper. Same logic exists in tokens panel as `TONE_COLOR` — duplication.
- **No "data stale" vs "never collected" distinction in R2 panel** (`r2-bucket-panel.tsx:34–38`). Both render placeholder text. Should differentiate visually.
- **Tokens panel grid is non-responsive** (`gridTemplateColumns: "180px 1fr 110px 140px 200px"`) — horizontal scroll on mobile.

#### Top 3 moves

1. **Consolidate the system-color tokens.** Either move the enum into the CSS via `data-system="X"` attributes, or generate the TypeScript enum from the CSS token list at build time. Eliminates the two-source-of-truth fragility. **Effort: M.**
2. **Add an operational-context bar above TabStrip.** Planned maintenance windows, known provider incidents, current-headcount-vs-scheduled. This is the *only* dashboard route where weather has an *operational* read ("severe weather → expect throughput dip"). **Effort: M.**
3. **Distinguish stale vs absent data + extract `TONE_COLOR` helper.** Hygiene. **Effort: S.**

#### Signal-placement opportunity

Move #2 — operational signals strip — is the most novel use of weather/event data outside forecasts. Severe-weather windows that might affect deliveries, scheduled maintenance, headcount gaps — they all belong on this surface.

#### Density

SystemHealthStrip uses `minmax(160px, 1fr)` — fine on desktop, wraps on mobile. Tokens panel non-responsive (called out above). Otherwise clean.

---

### `/dashboard/stores`

**Purpose:** Store directory — location dossiers, COGS targets, commission rates, Yelp sync, per-store financial quick-links.
**Files audited:** `src/app/dashboard/stores/page.tsx`, `components/stores-directory.tsx`, `components/store-dossier.tsx`.
**Scores:** Editorial fit 4/5 · Signal use 1/5 · Density 4/5

#### What works

- Directory wraps in `.inv-panel inv-panel--flush` (`stores-directory.tsx:75`) — bordered without redundant padding.
- Row expand/collapse uses `role="listitem"` and `aria-expanded` (`stores-directory.tsx:112–114`) — screen-reader compatible.
- Footer buttons use `bg-(--accent) text-(--paper) hover:bg-(--accent-dark)` (`store-dossier.tsx:416`) — custom-property syntax, no generic Tailwind red.
- COGS target input validates 0–100% with visual feedback. Edit mode preserves form state across re-renders.

#### What's broken

- **Save button typography inherits defaults.** No explicit DM Sans 600 — leans on whatever the base button class gives you. Inconsistent with the docket's deliberate weight choices.
- **Fixed-cost summary line lacks `tabular-nums`.** `stores-directory.tsx:140–142` renders `Fixed · $X,XXX` as plain text — values misalign visually across rows.
- **Expansion animation uses default CSS timing.** No `dock-in` / `dock-in-N` stagger like orders / detail surfaces use. Less polished.
- **No per-store status badge.** Closed today / pending recount / high-variance — these states matter for an at-a-glance read; currently buried in dossier drilldown.

#### Top 3 moves

1. **Add a per-store status badge to the directory row.** Tiny chip: "Closed today", "Variance flag", "Sync stale". Three or four canonical states. Reads operationally without expanding any row. **Effort: M.**
2. **Add `tabular-nums` to the fixed-cost line + explicit DM Sans 600 to the Save button.** Hygiene pair. **Effort: XS.**
3. **Apply the `dock-in` stagger to expansion animation** for visual continuity with orders/detail. **Effort: S.**

#### Signal-placement opportunity

Per-store status badge (move #1) is the natural signal anchor — could include weather alerts ("Storm warning") or labor gaps. This route is *the* place to show "which stores need attention right now."

#### Density

Store rows expand inline with smooth height animation. Each dossier section is a 4-item file nav. Mobile collapses dossier full-width; at 640px+ it stays embedded. Good progressive disclosure.

---

### `/dashboard/chat`

**Purpose:** Two-column AI chat — left rail conversation history, right thread.
**Files audited:** `src/app/dashboard/chat/page.tsx`, `chat-page-client.tsx`, `chat-page.css`.
**Scores:** Editorial fit 5/5 · Signal use 1/5 · Density 4/5

#### What works

- Grid-based two-column layout (`chat-page.css:6`). Fraunces serif italic title with explicit `font-style: italic` + `font-variation-settings` (`chat-page.css:178–181`).
- Conversation rail uses DM Sans for list items (`chat-page.css:49`). All colors via CSS variables — no Tailwind tripwires.
- Custom keyboard focus + delete interactions with proper ARIA states and opacity transitions (`chat-page.css:58–61, 107–132`).
- Mobile collapses to single column cleanly (`chat-page.css:189–195`).

#### What's broken

- Genuinely little. Rail items show no last-activity timestamp despite the data being available.
- Thread loading state is a plain text placeholder (`chat-page.css:161`) — could use the editorial "syncing…" pattern from analytics.

#### Top 3 moves

1. **Show last-activity timestamp + a tiny live/thinking indicator on the active conversation.** Adds situational awareness without changing the layout. **Effort: S.**
2. **Use the editorial "syncing…" pattern on the thread loading state.** Consistency with analytics + monitoring. **Effort: XS.**
3. **Surface model uncertainty as a subtle side annotation on responses.** Hard to scope without seeing the AI response shape, but if the underlying model surfaces confidence, the chat should display it. **Effort: M.**

#### Signal-placement opportunity

Chat is conversational; weather/event signals don't fit. Skip.

#### Density

Rail is fixed 280px on desktop, collapses correctly. Threads render with appropriate breathing room. No issues.

---

## 3. Cross-cutting moves

### A. Build the External-Signals Strip once; use it everywhere

The single biggest lever in the codebase. `StoreWeatherSignal`, `StoreEventSignal`, and `StoreEventDetailSignal` are queried today *only* by `labor-staffing-actions.ts` — every other surface ignores them.

A reusable `<ExternalSignalsStrip storeId={...} dateRange={...} />` belongs above the fold on:
- `/dashboard/forecasts` — primary home
- `/dashboard/analytics` — context for the heatmap
- `/dashboard/labor` — context for variance
- `/dashboard/monitoring` — operational read on severe weather windows

The strip renders three rows in the editorial style:

- **Weather** — 7-day Open-Meteo summary (icon + JetBrains Mono WMO label per day, severity-tinted for codes 95/96/99).
- **PredictHQ events** — top 1–2 named events per day from `StoreEventDetailSignal` ordered by `localRank DESC` (the `(storeId, date, localRank DESC)` index already exists). Render as `"<title> · <attendance>k · ★<localRank>"` with a category chip. Per-day total `hospitalityImpact` from `StoreEventSignal` shown faintly to the right.
- **Labor pressure** — understaffed/balanced/overstaffed day-count summary from existing `LaborStaffingData.days[].staffingRisk`.

Same component, different `dateRange` prop per surface. Reuses `forecasts-briefing.tsx` typographic patterns; new query helper in `src/lib/external-signals.ts` that joins all three models in one round-trip per (store, dateRange).

**De-duplication note:** PredictHQ exposes severe-weather events as a category. Open-Meteo gives the same days as WMO codes. The Strip should treat Open-Meteo as the source of truth for the weather row and let PredictHQ severe-weather flow only into the events row's category chips — otherwise the same storm shows twice in different language. One source per visual row.

**No schema work needed.** All required tables and indexes exist. This is a single-week, single-engineer spec.

### B. Tokenize the row-hover red

Across 12+ files (forecasts cards, labor.css, etc.), the literal string `rgba(220, 38, 38, 0.045)` appears in hover styles. Add to `globals.css`:

```css
:root {
  --row-hover-bg: color-mix(in oklab, var(--accent) 4.5%, transparent);
}
```

Then sweep. This is hygiene, not a redesign — but it unlocks future palette shifts and removes a class of "I changed accent and the hovers didn't follow" bugs.

### C. Sweep shadcn destructive tokens

`operations-content.tsx:85,137`, `pnl-all-stores-client.tsx:85,137`, possibly others. `border-destructive`, `bg-destructive/10`, `text-destructive`, `text-muted-foreground` are shadcn defaults that pick up the wrong red and the wrong gray on the editorial canvas. Map them to the editorial tokens in a single PR. Add a `.inv-panel--alert` variant to formalize the "error state" treatment so future work has a canonical home.

### D. Number-rendering audit

Several routes get tabular-nums *almost* right (the Tailwind class but not the inline `font-variant-numeric` style, or one without the other). The two need to be paired everywhere because Tailwind's `tabular-nums` doesn't always cover `lining-nums`, and DM Sans needs the explicit weight (500–600) to render numbers cleanly.

Locations seen during this audit: `summary-kpis-section.tsx:27–49` (invoices KPIs), `order-detail-content.tsx:157–183` (order ledger + cents span), `stores-directory.tsx:140–142` (fixed-cost summary). Likely more in components not audited. Worth a one-day codemod with a regex sweep + manual review.

### E. Modal styling unification (recipes + ingredients)

Two inconsistent modal-overlay treatments coexist: one uses inline CSS var inheritance (clean), one uses hardcoded `bg-[#1a1613]/35 backdrop-blur` (dirty + decorative). Pick the inline-var approach, sweep the hardcoded sheets, document the chosen pattern in `docs/frontend-patterns.md` so the next modal author knows.

### F. The ribbon-vs-sidebar question for forecasts

The forecasts ribbon assumes 5 equal-weight tabs. Once the External-Signals Strip lands and Anomalies moves to the briefing, you have 4 tabs. At that point the ribbon's geometry (full-width, equal cells) reads cleaner. **Don't replace the ribbon with a sidebar** — sidebars on dense data routes increase eye-travel. The ribbon survives.

### G. Forecasts → other-route bridges

The forecasts page already computes per-menu-item demand, vendor reliability scores, waste clusters. Each of these has a natural home on another route:

- Menu-item demand → a `Demand` column on `/dashboard/menu`
- Vendor reliability → a flag on `/dashboard/invoices` and `/dashboard/ingredients`
- Waste clusters → a callout on `/dashboard/cogs`

Today these forecasts live in tabs that operators only visit deliberately. Surfacing the *output* on the surface where the *decision* gets made is one of the highest-value moves available.

---

## 4. Sequencing

If I were prioritizing the next four sprints based on user-value × effort, the order would be:

### Sprint 1 — External-Signals Strip + forecasts re-home

The single highest-leverage move. Build the `<ExternalSignalsStrip />` component, place it above the forecasts ribbon, move Anomalies out of the ribbon and into the briefing. Bundle with the row-hover tokenization sweep so the next sprints can build on a clean base.

**No schema or sync work required** — `StoreWeatherSignal`, `StoreEventSignal`, and `StoreEventDetailSignal` are populated nightly by `ml/external_signal_sync.py` against Open-Meteo and PredictHQ (`/v1/features/` and `/v1/events/`). The named-events-per-day index `(storeId, date, localRank DESC)` is already in place. Sprint 1 is purely a UI + query-helper sprint.

**Specs needed:** External-Signals Strip component spec; forecasts page restructure spec.

### Sprint 2 — Surface weather/event/labor on analytics + monitoring

Drop the Strip onto `/dashboard/analytics` (above heatmap) and `/dashboard/monitoring` (above TabStrip, with the operational read). Add the cell-overlay treatment to the revenue heatmap so individual days carry context.

**Specs needed:** Analytics heatmap overlay spec; monitoring operational-context bar spec.

### Sprint 3 — Cross-route bridges

Forecasts → Menu (Demand column), Forecasts → Invoices (vendor flag), Forecasts → COGS (waste cluster callout, ingredient price spike). Each is small but each connects two surfaces an operator currently has to flip between.

**Specs needed:** One per bridge — three small specs, can be parallelized.

### Sprint 4 — Hygiene sweeps

Number-rendering audit (codemod + manual review), shadcn-destructive token sweep (operations + pnl), modal-styling unification (recipes + ingredients), backdrop-blur removal (orders sticky headers, recipes/ingredients modals, invoices PDF toolbar). The kind of work that doesn't show up as a feature but compounds with every future change.

**Specs needed:** One sweep spec covering all four — they share the same review dimension and PR shape.

---

### What's NOT on the list

- No new design system, no new tokens (other than `--row-hover-bg`).
- No layout overhaul, no IA restructure beyond moving Anomalies out of the ribbon.
- No P&L momentum column, no menu demand sparkline, no cost-trend in recipes — these are all *good* moves listed in the per-route audits, but they're feature work, not redesign work. Slot them into the product backlog, not the redesign track.
- No mobile-specific work. Several routes have mobile clipping issues (cogs ledger, menu catalog horizontal scroll); they deserve a separate mobile pass.

The goal of this redesign track is to **let the new ML/signal investment finally show up in the UI**. Sprints 1–2 do that. Sprint 3 makes the forecasts surface earn its keep across the rest of the dashboard. Sprint 4 cleans the substrate so further work is faster and more consistent.
