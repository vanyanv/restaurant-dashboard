# Overview verification: `/dashboard` seen in a real browser

Task 4 of Plan 7 (2026-08-25-counter-overview). Unlike every prior
verification doc in this series, this is not a throwaway harness — `/dashboard`
is the real route, replacing `src/app/dashboard/page.tsx` in place. Method:
`npm run dev` on `http://localhost:3000`, driven with the Playwright MCP
browser (real Chromium), signed in through `/login` with the
`E2E_USER_EMAIL` / `E2E_USER_PASSWORD` credentials from `.env.test.local`.

## A real bug this session found and fixed

The very first load threw at runtime: `TypeError: params.get is not a
function` inside `readCounterParams`, both server- and client-side. Cause:
`page.tsx` (a Server Component) was passing a `URLSearchParams` **instance**
as a prop to `CounterOverviewClient` (a Client Component). Props crossing
that boundary go through React's Flight serialisation, which carries plain
values — strings, numbers, plain objects/arrays, `Date` — but not a class
instance's prototype. The object that actually arrived on the client had
none of `URLSearchParams`'s methods.

This is exactly the class of bug the unit test in `tests/app/
counter-overview.test.tsx` cannot see: it constructs `<CounterOverviewClient>`
directly with a JS object, with no serialisation boundary in between, so a
`params: new URLSearchParams()` prop worked fine there and broke immediately
in a real browser. Fixed by changing the client's `params` prop to a plain
`string` (the query string) and reconstructing `new URLSearchParams(...)`
client-side, where no serialisation is involved. `page.tsx` now passes
`params.toString()`. Both the adapter and the client test were updated
alongside this — see the commit for the full diff.

## A second real defect this session found and fixed

`Strip`'s grid is a fixed 2/4-column layout — it renders exactly as many
tracks as its CSS declares, regardless of how many cells are supplied. The
first render put a single Figure inside a `Strip` for the net-sales headline
(one cell in a 2/4-track grid) and three cells for Invoices (three cells in a
4-track grid). Both left the unused tracks showing the grid container's own
hairline background — a plain grey rectangle next to the real content, in
both themes.

Fixed two ways: the net-sales headline now renders a bare `Figure` with
`size="lead"` directly (no `Strip` — Figure's own doc comment says this is
exactly what `size="lead"` is for), and Invoices gained a fourth, real cell
("Avg invoice", from `InvoiceKpis.avgInvoiceTotal`, which the adapter had
been computing and then discarding) so its Strip fills all four tracks with
real data instead of one empty one. See the current screenshots below — no
grey boxes.

## What it looks like

Screenshots: `overview-light-2.png`, `overview-dark.png` (repo root, this
session — not committed; regenerate with the same Playwright session if
needed).

**Reads as a page an owner would use, with one significant caveat.** The
content itself — one headline figure, an honestly-labelled owed section, a
per-store ledger, an invoices strip, two more owed sections — reads as
real information an owner would check, not a component gallery. The owed
sections in particular read as *designed but not yet built* rather than
*broken*: each is a dashed-border card headed "Not computed yet" naming the
specific work owed ("sales per labour hour scoped to the selected range",
"alerts and decisions queue", "the model's call for this day") plus one
sentence explaining why nothing is shown instead. Nothing invites the
reader to mistake it for a zero.

**FIXED 2026-08-25: the double navigation shell.** `/dashboard` used to
render inside TWO navigation shells at once — `src/app/dashboard/
layout.tsx` wrapped every `/dashboard/*` route in the old editorial
`AppSidebarClient` (the cream sidebar: "Chris N Eddy's" wordmark, "Vol. 04
· No. 25", the old nav list), and Counter's own `AppShell` then rendered
*inside* that, with its own wordmark and its own 17-item rail. Fixed by
moving the editorial chrome — `AppSidebarClient`, `SidebarProvider`/
`SidebarInset`, `ChatDrawerProvider`/`ChatDrawerClient`, `WelcomeMarquee`,
the editorial stylesheets, Fraunces — into a new
`src/app/dashboard/(editorial)/layout.tsx`, and moving every still-editorial
page directory (~19 of them) into that route group alongside it.
`src/app/dashboard/layout.tsx` now holds only what both worlds need: a
session read and `PageViewTracker`. Route groups don't change the URL, so
`/dashboard/orders` still serves from `(editorial)/orders/page.tsx` — a
Counter page (starting with Overview, `src/app/dashboard/page.tsx`, left
outside the group) now gets *only* the shared layout, with no editorial
chrome mounted at all. Verified in a real browser post-fix: `/dashboard`
shows exactly one sidebar (Counter's), `/dashboard/orders` and
`/dashboard/analytics` still show the old cream sidebar unchanged, and the
`next build` route manifest lists every editorial route at its original
URL. See DESIGN.md's "`(editorial)` route group" section for the mechanism
and `.superpowers/sdd/2026-08-25-counter-overview/shell-separation-report.md`
for the full verification.

**The two lead numbers, per note 30.** Net sales ($7,122 for Yesterday · All
stores) is the first thing under the topbar — a bare `Figure` at `size="lead"`,
the largest text on the page. Sales per labour hour is immediately below it,
honestly `not_computed` rather than showing the wrong (trailing-14-day)
number next to a range-scoped net sales figure (R1, Plan 7). So today only
one of the "two numbers an owner checks" is actually shown; the layout keeps
its place for the day `getSplhSeries` gains a range parameter.

**The per-store ledger reads at a glance.** Store / Net sales / COGS % / vs
target, four columns, right-aligned tabular figures. Glendale and Van Nuys
(both pre-open) show `$0` / `0.0%` / `—` rather than being hidden — an
honest "nothing happened here" rather than a filtered-out row, and the em-dash
for "vs target" (no target set is not the same as "on target").

**Nothing disappeared in dark.** See "Corroboration" below — every Counter
surface (topbar, sections, table, owed cards) re-rendered with light text on
a dark background and passed a computed-style check, not just a screenshot.
At the time this was written, the one thing that stayed light in dark mode
was the OLD editorial sidebar (cream, unchanged) — a known,
already-documented issue (see the `C1` regression comment in `tests/app/
counter-theme.test.tsx`: shadcn tokens under the legacy layout are frozen
at light HSL values and never respond to `.dark`/`data-theme`). That was
visible on `/dashboard` specifically because of the double-shell bug fixed
2026-08-25 (see below) — the editorial sidebar was rendering on the Counter
route at all. Post-fix, `/dashboard` no longer mounts `AppSidebarClient`,
so there is nothing cream left on that route in either theme; `C1` itself
is unrelated to the shell split and remains open on editorial routes, where
the old sidebar was always light-only by design.

## Corroboration (not just the screenshot)

Per the standing note that `scale: "css"` screenshots are not reliable
evidence for `light-dark()`/`oklch()` backgrounds on this headless Chromium
build, dark mode was confirmed with `getComputedStyle`, not just a
screenshot, and *scoped to `#ct-main`* — a first pass queried
`document.querySelectorAll('section')` and found dark text on a dark
background, which turned out to be a `<section>` belonging to the OLD
editorial layout outside Counter's tree, not a bug in this page:

| Query | Light | Dark |
|---|---|---|
| `document.documentElement` `data-theme` | *(absent under system, forced via `localStorage`)* | `dark` |
| `document.documentElement` computed `color-scheme` | `light` | `dark` |
| `--ct-paper` (declared) | `light-dark(oklch(96.2% .006 60), oklch(19% .007 60))` | *(same declaration; used value below)* |
| AppShell wrapper (`bg-ct-paper`) computed background | — | `oklch(0.19 0.007 60)` (matches the dark half above) |
| A `Section` inside `#ct-main` computed background | — | `oklch(0.22 0.006 66)` |
| That `Section`'s `<h3>` computed colour | — | `oklch(0.93 0.01 60)` (light ink, correctly contrasted against the dark surface) |
| Net-sales `[data-figure-value]` computed colour | — | `oklch(0.93 0.01 60)` |

Screenshots were taken at `scale: "device"` (not the default `"css"`) as a
second line of evidence, matching both the computed-style numbers above.

## Controls exercised on the real page

| Control | Action | Result |
|---|---|---|
| Range menu | Opened, selected "Last 7 days" | URL → `/dashboard?range=d7`. Net sales `$7,122` → `$43,598`; ledger and invoices figures updated to match; the "Stores" section's meta caption updated from "Yesterday" to "Last 7 days". |
| Store switcher | Opened, selected "Chris N Eddys - Hollywood" | URL → `/dashboard?range=d7&store=<hollywood-id>`. Trigger label updated to the store name; the per-store ledger collapsed from 3 rows to 1 (Hollywood only); invoices strip re-scoped to Hollywood's own figures. |
| ⌘K | Pressed | Counter's own `AskSurface` opened (`role="dialog"`, `aria-label="Ask a question"`) with the sentence **"Answering about Overview · Chris N Eddys - Hollywood · Last 7 days"** — page, selected store and range in effect, all correct and matching the URL at the time. |
| Reload | Hard navigation to `/dashboard?range=d7&store=<hollywood-id>` | Store switcher and range control both restored to "Chris N Eddys - Hollywood" / "Last 7 days" on load; net sales rendered `$43,598` immediately (no flash of the default "Yesterday · All stores" state). |
| `not_computed` reachability | Observed on every load | "Sales per labour hour", "Needs you" and "The model's call" all rendered the dashed "Not computed yet" card with their specific owed-work sentence — no zero anywhere. |

**FIXED 2026-08-25: the ⌘K collision.** Pressing ⌘K used to open Counter's
`AskSurface` **and** the old editorial "Owner Analyst · Ask" chat drawer
simultaneously — the old drawer's own footer also read "⌘K to toggle · Esc
to close". Both were real dialogs, stacked. Cause was the same shared
`dashboard/layout.tsx` that caused the double sidebar: it mounted
`ChatDrawerProvider`, whose keydown listener fires on every `/dashboard/*`
route regardless of design system. Fixed by the same `(editorial)` route
group move above — `ChatDrawerProvider`/`ChatDrawerClient` now mount only
inside `(editorial)/layout.tsx`, so Counter routes never register that
listener. Re-verified in a real browser: ⌘K on `/dashboard` opens only
Counter's `AskSurface` (`role="dialog"`, "Answering about..."); ⌘K on
`/dashboard/orders` opens only the old "Owner Analyst · Ask" drawer, full
quick-question grid and all — no cross-contamination either direction.

## Console errors

Zero console errors in either theme, on every navigation exercised above
(initial load, range change, store change, ⌘K, reload). One benign warning,
present in both themes and unrelated to this page — a Next.js dev-mode
resource-preload warning for a proxy/middleware CSS chunk that is not used
on this route (`__00_mw8_._.css`); it repeats once per navigation and is not
new here.

## Bundle size

`npm run bundle:check` against `docs/counter/baseline-bundles.txt`:

| | Baseline (editorial `/dashboard`) | After Counter Overview shipped | After the `(editorial)` shell split | Change (split only) |
|---|---|---|---|---|
| Uncompressed | 1056.7 KB | 750.6 KB | 606.5 KB | **−144.1 KB (−19.2%)** |
| Gzipped | 323.4 KB | 231.3 KB | 183.8 KB | **−47.5 KB (−20.5%)** |

Lighter still. `/dashboard` was already lighter than the editorial baseline
once Counter Overview shipped, but it was still loading the editorial
chrome's own bundle (sidebar, chat drawer, Fraunces, editorial CSS)
alongside Counter's, because of the double-shell bug — that's the extra
144.1 KB the `(editorial)` route group split removed. All 74 routes stayed
under budget after the split (`npm run bundle:check`: "all 74 routes under
budget"); no route regressed.

## Gate

`npm test && npm run tokens && npx tsc --noEmit && npm run build` — all
green, both when Overview first shipped and again after the 2026-08-25
`(editorial)` shell-separation split. `npm test`: 192 files, 2079 passed,
8 skipped (unchanged skip count both times).
