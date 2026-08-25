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

**The caveat: `/dashboard` currently renders inside TWO navigation shells at
once.** `src/app/dashboard/layout.tsx` — untouched by this plan, out of
scope per the brief ("delete nothing") — still wraps every `/dashboard/*`
route in the old editorial `AppSidebarClient` (the cream sidebar: "Chris N
Eddy's" wordmark, "Vol. 04 · No. 25", the old nav list). Counter's own
`AppShell` then renders *inside* that, with its own wordmark and its own
17-item rail. The result, visible in both screenshots, is two sidebars side
by side with two different navigation structures and two different sets of
labels for the same destinations (the old sidebar's "Decisions"/"Alerts"
have no Counter-rail equivalent yet; Counter's "Needs you" has no
old-sidebar equivalent). This is not a regression this task introduced —
it is the expected, structural state of "first Counter page, legacy layout
still standing" that the plan's own "Next plan" note anticipates clearing
page by page — but it is the single most significant thing that does *not*
yet read as a finished page, and it is worth being explicit that a reader
seeing this today would reasonably ask which sidebar is real.

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
The one thing that stays light in dark mode is the OLD editorial sidebar
(cream, unchanged) — a known, already-documented issue (see the `C1`
regression comment in `tests/app/counter-theme.test.tsx`: shadcn tokens
under the legacy layout are frozen at light HSL values and never respond to
`.dark`/`data-theme`). Expected, not new, but visible in the dark screenshot
as the one part of the page that stays cream.

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

**One thing worth flagging plainly:** pressing ⌘K opens Counter's
`AskSurface` **and** the old editorial "Owner Analyst · Ask" chat drawer
simultaneously — the old drawer's own footer also reads "⌘K to toggle · Esc
to close". Both are real dialogs, stacked. This is a collision between the
new surface and layout.tsx's pre-existing chat drawer, not something this
page's own code causes directly, but it is a real, visible defect a reader
would hit immediately.

## Console errors

Zero console errors in either theme, on every navigation exercised above
(initial load, range change, store change, ⌘K, reload). One benign warning,
present in both themes and unrelated to this page — a Next.js dev-mode
resource-preload warning for a proxy/middleware CSS chunk that is not used
on this route (`__00_mw8_._.css`); it repeats once per navigation and is not
new here.

## Bundle size

`npm run bundle:check` against `docs/counter/baseline-bundles.txt`:

| | Baseline (editorial `/dashboard`) | Now (Counter `/dashboard`) | Change |
|---|---|---|---|
| Uncompressed | 1056.7 KB | 750.6 KB | **−306.1 KB (−29.0%)** |
| Gzipped | 323.4 KB | 231.3 KB | **−92.1 KB (−28.5%)** |

Lighter, not heavier — the Counter page replaces a heavier editorial one and
comes in under budget (1562.5 KB uncompressed budget for this route).

## Gate

`npm test && npm run tokens && npx tsc --noEmit && npm run build` — all
green. `npm test`: 192 files, 2079 passed, 8 skipped (unchanged skip count).
