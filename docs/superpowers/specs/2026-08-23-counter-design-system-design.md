# Counter — design system and dashboard rebuild

Status: implemented (dashboardv2, Phase 0b onward); see §2.4 for one amendment against what was originally specced here
Branch: `dashboardv2`
Date: 2026-08-23
Prototype: [`docs/counter/counter-prototype.html`](../../counter/counter-prototype.html) (open directly in a browser)

---

## 1. What this is

Counter is a replacement design system and information architecture for the
dashboard. It is not a reskin. It changes the type, the colour model, the
radii, the navigation, the page inventory, and the way state is expressed.

The prototype is the specification. It draws 53 screens across both surfaces,
five states each, and carries a log of 51 numbered decisions explaining why
each thing is the way it is. Those note numbers are stable and are cited
throughout this document; the full text of each lives in the prototype.

### Counter against the current system

| | Current (`DESIGN.md`) | Counter |
|---|---|---|
| Display type | Fraunces serif italic | Bricolage Grotesque 600/700/800 |
| Body / figures | DM Sans, tabular | unchanged — DM Sans, tabular |
| Captions | JetBrains Mono | unchanged |
| Colour | warm hex cream, light only | oklch tokens, light **and dark** |
| Radius | 0–2px hairline | 8px (`--r`) / 5px (`--r-sm`) |
| Semantics | ink / paper / accent | + `signal`, `good`, `warn`, `bad`, channel scale, mix ramp, gross-profit ramp |
| Ask | `/dashboard/chat`, a page you go to | ⌘K overlay over every page, **plus** a page that keeps the thread |
| Rail | ~32 entries | 17 items in 5 groups (note 24) |
| Per-store pages | `/[storeId]` routes | store switcher + a second view on the parent (notes 25, 57) |
| State | ad hoc per page | six states, implemented once in the builders (note 22) |
| Motion | incidental | orchestrated, 330ms, fully disabled under `prefers-reduced-motion` (note 27) |

### Decisions taken before this document

| # | Decision |
|---|---|
| 1 | **Whole-branch rebuild.** `dashboardv2` replaces `/dashboard/**` and `/m/**` in place. No parallel route group, no feature flag, no incremental cutover. The branch merges to main when complete. |
| 2 | **Tailwind v4 `@theme`.** Counter tokens are real Tailwind utilities in one file, so shadcn inherits them. Component CSS only where a pattern is genuinely stateful. |
| 3 | **Shell first, real data second.** Sections the app cannot yet compute render as a first-class *owed* state, never as a fake number or a blank. |
| 4 | **Both surfaces together.** Desk and phone land in the same phase, page by page (note 17). This supersedes the standing "mobile stays a lean glance-and-do tool" rule, which is hereby renegotiated. |
| 5 | **Full dependency sweep first**, including TypeScript 7 and TanStack Table 9. One commit per major. |
| 6 | **Playwright screenshot baselines per state, plus a token lint** that turns the `CLAUDE.md` tripwires into a build failure. |
| 7 | **No rebase.** One merge at the end. A read-only drift watch runs at each gate. |

---

## 2. Architecture

### 2.1 The keystone: state lives in the builders

Note 22 is the load-bearing idea, and it is what makes 53 screens tractable.
Pages never branch on state. One discriminated union crosses every boundary:

```ts
// src/lib/counter/section-data.ts
export type SectionData<T> =
  | { status: "ready";        data: T }
  | { status: "stale";        data: T; lastGoodAt: Date }
  | { status: "loading" }
  | { status: "failed";       error: string; retryAction: string }
  | { status: "empty";        reason: "pre_open" | "no_match" }
  | { status: "not_computed"; owed: string }
```

`<Section>`, `<Strip>`, `<Chart>` and `<Table>` each accept `SectionData<T>` and
render the correct state internally. A page author writes `<Strip data={splh} />`
and gets all six states, correctly, with no opportunity to get them wrong —
there is no other way to pass data in.

Six states, not five. The prototype mandates five; `not_computed` is added here
to make decision 3 honest. Prime-cost cascade, the unmapped-revenue honesty
strip, the clock-in/out leak ledger, inventory coverage health and the P&L trust
panel each render as a named, tracked owed section. Each is one line in an
adapter, and swapping it for a real query later changes no page code.

`empty.reason` is two values because a pre-open store and a filter that matched
nothing need different next steps (note 23). Glendale and Van Nuys have no sales
because they have no customers; that is an empty state, not a bespoke screen.

### 2.2 Directory layout

```
src/styles/counter.css              @theme tokens, light + dark. The only colour source.

src/lib/counter/
  section-data.ts                   the union above, plus constructors
  date-range.ts                     12 presets · steppers · bucket selection · comparison
  prime-cost.ts                     ONE definition (note 60)
  channels.ts                       CVD-safe channel scale (notes 36, 41)
  format.ts                         tabular currency / percent / delta
  adapters/<page>.ts                the only new server code — see 3.1

src/components/counter/
  shell/    AppShell · Rail · RailGroup · Topbar · StoreSwitcher · DateControl · Wordmark
  surface/  Section · Strip · Chart · Table · Figure · Meter · Cascade · Toast
  state/    Skeleton · Failed · Empty · Stale · Owed      consumed by surface/, never by pages
  ask/      AskSurface (⌘K) · AskAboutThis
  motion/   useEntry · useCountUp · useChartDraw          all reduced-motion aware

src/app/dashboard/**                page shells: compose, never style
src/app/(mobile)/m/**               same primitives, phone composition
```

### 2.3 Rules, and how they are enforced

These replace the five `CLAUDE.md` tripwires, which are rewritten in Phase 0b.
All four are checked by `npm run tokens`, a static gate (see 4.2).

1. **No colour literal outside `counter.css`.** No hex, no `oklch(` , no
   `bg-sky-*` / `text-emerald-*` / `border-violet-*` anywhere under
   `src/app/dashboard/**`, `src/app/(mobile)/m/**` or `src/components/counter/**`.
2. **No `status ===` in a page.** State branching belongs to `surface/`.
   A page that inspects `SectionData.status` has broken the keystone.
3. **No page imports Prisma or a server action directly.** Pages call adapters.
4. **No page imports `framer-motion`.** Motion comes from `motion/` so that
   `prefers-reduced-motion` is honoured in exactly one place.

A fifth rule is enforced by review rather than lint, because it needs judgment:
**a figure shown on two pages comes from one function in `src/lib/counter/`.**
Note 60 is the cautionary tale — Overview read prime cost at 56.2% and the P&L
read 57.9% for the same range, because one counted hourly wages and the other
counted hourly cost. `prime-cost.ts` exists so that cannot recur.

### 2.4 Type and colour

Fraunces is removed from all four layouts that load it
(`dashboard`, `(mobile)/m`, `login`, `signup`). Bricolage Grotesque replaces it,
self-hosted via `next/font/google` exactly as the others are. Net font families:
three, unchanged.

Bricolage is used on page titles and the wordmark only. Every figure is DM Sans
with `tabular-nums lining-nums`. Captions, folios, SKUs and status labels stay
JetBrains Mono. This is the two-tier rule the current system already has, with
the display face swapped.

The channel colours are not the brand hexes. Run DoorDash, Uber Eats, Grubhub
and in-house through a CVD check and they fail as a set — DoorDash and Grubhub
sit ΔE 8.5 apart in normal vision (notes 36, 41). `channels.ts` separates them by
lightness and every band is named on itself, so the chart is legible without the
legend and without colour vision.

Dark mode follows the system by default, with an explicit override persisted in
settings — but not the way originally specced here.

**Amendment (2026-08-23, during implementation):** this section originally
prescribed tokens defined on bare `:root`, redefined under
`@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`,
and again under `:root[data-theme="dark"]`. That was not built. Every
`counter.css` token is instead a single `light-dark(light, dark)` value,
declared once, and dark mode is driven by the standard `color-scheme`
property rather than a duplicated token block:
`tests/styles/counter-tokens.test.ts` fails the build if a second `:root`
block or a `prefers-color-scheme` media query appears at all, precisely to
block the pattern this section used to prescribe.

The `light-dark()` approach is better on its own terms: one declaration
site per token instead of three, so there is nothing to keep in step —
exactly the failure this document elsewhere blames for six drifted copies
of `--ink-faint` in the old system. `color-scheme` is also what
`CounterThemeProvider` (`src/components/counter/theme-provider.tsx`) sets
directly: "system" stamps nothing and falls back to `:root`'s own
`color-scheme` declaration; an explicit choice sets `style.colorScheme`
inline on `<html>`, which overrides `:root` in both directions with no
class-stamping and no media query involved.

One deliberate deviation from that mechanism, found in the branch's final
review: `:root` currently pins `color-scheme: light` rather than
`color-scheme: light dark`, so "system" always resolves light rather than
following the OS. That is not part of this amendment — it is a stopgap
documented at the declaration itself in `counter.css`, because most of the
app is still the pre-Counter editorial design (light-only, frozen shadcn
tokens) and following the OS into dark half-inverts it. It reverts to
`light dark` once every route is Counter.

### 2.5 Performance

Page shells stay server components. Only `DateControl`, `StoreSwitcher`,
`AskSurface`, `Chart` and `Table` are `"use client"`.

The existing per-route budget gate (`npm run bundle:check`, wired to
`.github/workflows/bundle-budget.yml`) applies from the first Counter commit.
Budgets are captured from the current editorial routes at the head of Phase 0b,
so Counter cannot ship a route slower than the one it replaces.

Note 62 is a standing instruction: five and a half kilobytes of styling for
components that no longer exist was found in the prototype alone. Every phase
deletes the editorial CSS and components its page made dead. Nothing is
hoarded for a cutover — there is no cutover.

---

## 3. Data

### 3.1 Adapters: nothing server-side is rewritten

The 30 modules under `src/app/actions/` and everything in `src/lib/` stay as
they are. Counter reaches them through one thin new layer.

```
src/app/dashboard/pnl/page.tsx            server component, composes only
   └── src/lib/counter/adapters/pnl.ts    the only new server code
         ├── existing actions / lib                     (unchanged)
         ├── src/lib/counter/prime-cost.ts              (note 60)
         └── src/lib/monitoring/staleness.ts            drives status:"stale"
       returns { header, sections: Record<string, SectionData<…>> }
```

An adapter's entire job is: call what exists, and classify the result into one
of the six states. That buys three things at once.

- **The six states are testable without a browser.** Vitest asserts
  "sync 4h stale → `status:'stale'` carrying `lastGoodAt`", "pre-open store →
  `status:'empty', reason:'pre_open'`", "no server code for the leak ledger →
  `status:'not_computed'`". This is how 53 screens × 6 states get proven cheaply.
- **`not_computed` becomes a to-do list the type system keeps.** Every owed
  section is one adapter line and one Vitest assertion.
- **Rule 3 has somewhere to point.** Pages import adapters, adapters import
  everything else.

### 3.2 Sections the app cannot yet compute

Confirmed absent from `src/lib` and `src/app/actions` at the time of writing:

| Owed section | Page | Note |
|---|---|---|
| Prime-cost cascade vs. the 60% ceiling | P&L | 52, 60 |
| Unmapped-revenue honesty strip | Menu → Profit | — |
| Clock-in / clock-out leak ledger | Labor | — |
| Inventory coverage health | Inventory | — |
| P&L trust panel (measured / prorated / rate / unposted) | P&L | 44 |
| Per-store deep-dive sections with no group form | Analytics, Labor, COGS | 57 |

Confirmed present and wired directly: sales per labour hour
(`splh-actions.ts`), labour productivity (`labor-productivity-actions.ts`),
staleness (`src/lib/monitoring/staleness.ts`), store lifecycle
(`src/lib/store-lifecycle.ts`).

Each owed section becomes a tracked follow-up with its own spec and its own
tests. None of them blocks a Counter page from shipping.

### 3.3 Store lifecycle

The model has three stages — pre-open, warming up, trading — and only two were
ever expressible in the interface (note 58). Counter expresses all three: the
rail tag, the store file's lifecycle row, and a caption on a warming store's
forecast naming whose shape it borrowed. Hollywood trades; Glendale and Van Nuys
are pre-open.

---

## 4. Verification

### 4.1 The gate, run at the end of every phase

```
git diff main --stat -- src/app src/components src/styles   # drift watch, read-only
npm test                    # vitest — adapters, date-range, prime-cost, channels, primitives
npm run tokens              # NEW — see 4.2
npx tsc --noEmit
npm run build && npm run bundle:check
npm run e2e                 # Playwright baselines: every state × desk + phone
```

The drift watch exists because decision 7 declined rebasing. It interrupts
nothing and costs nothing. Its only job is to detect early if main starts
touching `src/app`, `src/components` or `src/styles` — as opposed to the
`src/lib/ml`, `scripts/` and `prisma/` it has been touching — because that is
the single condition that makes a no-rebase branch expensive. If that number
starts climbing, we revisit decision 7 rather than discover it at merge time.

### 4.2 `npm run tokens`

A new static check, roughly 80 lines, living in `tests/styles/` alongside the
existing style tests. It fails the build on any violation of rules 1–4 in §2.3.
It is written and proved against a deliberately-failing fixture in Phase 0b,
before there is any Counter code for it to check.

### 4.3 Screenshot baselines

Every Counter page commits a Playwright baseline per state per surface. Baselines
start at **Phase 2**, not Phase 1 — the primitives must settle first, or the
churn is unmanageable. `e2e/desktop` and `e2e/mobile` already exist and are the
home for these.

---

## 5. Information architecture

### 5.1 The rail — 17 items, 5 groups

| Group | Items |
|---|---|
| Today | Overview · Ask · Needs you · Orders |
| Money | Analytics · P&L · COGS · Labor |
| Menu | Menu · Recipes |
| Stock and suppliers | Invoices · Inventory · Ingredients · Vendors |
| Admin | Stores · Settings · Monitoring |

Seventeen fits in one glance without scrolling. Thirty-two is a table of
contents, not navigation (note 24).

### 5.2 Route map

Existing consolidation is already underway on main: `operations/recipes`,
`operations/costs` and `menu` are redirect shims today. Counter continues that
direction rather than reversing it.

| Counter page | Absorbs | Mechanism |
|---|---|---|
| Overview | `dashboard/` | per-store ledger; SPLH lead against the $68.00 floor (notes 30–33, 39) |
| Needs you | `alerts` + `decisions` | one queue at two speeds; filters on severity × the five sources that raise an alert |
| Orders | `orders`, `orders/[id]` | row opens record |
| Analytics | `analytics`, `analytics/[storeId]` | store view via switcher (notes 25, 57); mix shift drawn as share, not four dollar lines (note 40) |
| P&L | `pnl`, `pnl/[storeId]` | cascade not donut (note 52); eight pressable weeks (note 53); prorated fixed costs shown as arithmetic (note 20); trust panel (note 44) |
| COGS | `cogs`, `cogs/[storeId]`, `operations/product-usage`, `operations/costs` | theoretical vs actual as tabs; worst-margin items |
| Labor | `labor`, `labor/[storeId]` | verdict, day-by-day week, staffing curve, leak ledger (owed), twelve-week trend |
| Menu | `menu`, `menu/catalog`, `menu/catalog/[id]`, `menu-profit`, `product-mix` | three tabs — Items · Profit · Mix; honesty strip (owed); one menu array so a price cannot disagree with a margin (note 49) |
| Recipes | `recipes`, `operations/recipes` | eight-line builder, live cost panel, uncosted line says so |
| Invoices | `invoices`, `invoices/[id]` | scan beside extraction (note 63); no fake coordinates (note 64); the failure designed for is a *missing* line (note 65); approve gated at zero gap |
| Inventory | `operations/inventory`, `counts`, `counts/[id]`, `count/new` | one page; the adjustment, so variance reaches shrink not food cost; coverage health (owed) |
| Ingredients | `ingredients`, `ingredients/prices` | tabs; review inbox; modifier mapping table |
| Vendors | `operations/vendors`, `operations/packaging` | tabs |
| Stores | `stores`, `stores/[id]`, `[id]/edit`, `new` | store file: four cadenced inputs, six fixed expenses matching `StoreFixedExpense`, commission rates, COGS target, prorate arithmetic shown |
| Settings | `settings`, `account`, `notifications`, `preferences` | tabs |
| Monitoring | `admin/monitoring` + 7 subroutes | eight tabs; five currently missing, including Costs, which caught a live bug (note 56) |
| Ask | `chat` | ⌘K over every page, saying what it answers about before you type; the page keeps the thread, its history and its cost (notes 43, 46, 55) |

**Deleted:** the `operations/` hub — it only relinked.

**Built but unreachable by design:** login (note 18), invite, maintenance, 404, 403.

**Dead routes 301 rather than vanish.** `/dashboard/menu-profit` →
`/dashboard/menu?view=profit`, `/dashboard/alerts` → `/dashboard/needs-you`, and
so on — roughly ten one-line `redirect()` files so existing bookmarks survive the
merge. They are deleted in a follow-up once the access logs go quiet.

### 5.3 Cross-cutting behaviour

- **A row opens its record**, on the desk and on the phone. A row that leads
  nowhere does not wear a pointer (note 47).
- **The route is the hierarchy.** `/dashboard/invoices/I28517` makes Invoices the
  parent, and that is where the breadcrumb and the phone's back button come from.
  Nothing is hand-wired (note 48).
- **A tab is a destination.** A link to Catalog opens Menu on its Items tab; a
  page that lives in a tab strip is never shown without one.
- **Every section head's "Ask about this" works.** It was rendered on fifty pages
  and wired on none (note 55).
- **The date control regenerates the data,** not the label — series, totals,
  bucket size and tooltips all follow (note 19). Buckets follow the span: days up
  to a month, weeks up to four months, months beyond. A single day unlocks
  single-day panels; widening replaces them rather than faking them.
- **The comparison is part of the range,** not a separate setting, and appears in
  every chart tooltip. It is encoded once, not three times — a ribbon behind the chart, a delta on
  six figures and a table of its own are three encodings of one relationship
  (note 54).
- **Popovers measure their own frame** and flip when there is no room; the range
  picker is 438px wide, which is wider than a phone (note 21).
- **Charts are interrogable:** hover anywhere, nearest reading wins, crosshair
  plus dot plus a card naming the day, every series and the comparison. Bars dim
  to 42% except the one under the pointer. Touch drags the same card (note 16).
- **Colour the overshoot, not the measure** — only the distance past a reference
  is coloured (note 35).
- **Every screen ends in a decision.** If a page has nothing to act on, it says so.

### 5.4 Motion

One orchestrated entry per screen: sections rise in reading order, 36ms apart,
finished inside 330ms (note 27). Charts draw once — lines stroke over 720ms, bars
grow from the baseline 26ms apart, meters and cost bars fill from the left.
Figures count up to what they already say over 480ms, keeping currency and
decimals. Consequential buttons answer with a toast. One thing loops: the dot
beside "3 need you", and only while something needs you.

All of it off under `prefers-reduced-motion`, counters and toasts included.

---

## 6. Phases

Each phase ends in the §4.1 gate. Phases 3+ are independently revertable and
nothing after Phase 2 blocks anything else after Phase 2.

| # | Ships |
|---|---|
| **0a** | Dependency sweep. One commit per major, gated between each: minors + patches → `npm audit fix` → recharts 3 → react-day-picker 10 → framer-motion 13 → lucide 1.x → tanstack-table 9 → typescript 7 → shadcn 4. Includes a spike proving recharts 3 can do hover-anywhere, 42% dim and touch-drag. |
| **0b** | `counter.css` `@theme` tokens, light + dark. Fraunces removed from four layouts, Bricolage added. `npm run tokens` written and proved against a failing fixture. Bundle budgets captured from current editorial routes. `DESIGN.md` and the `CLAUDE.md` tripwires rewritten. |
| **1** | `src/lib/counter/*` and every primitive in `src/components/counter/*`, both surfaces. No pages. Vitest + RTL only — baselines start next phase. |
| **2** | **Overview**, desk and phone, all six states. First page on the new system; Playwright baselines begin here. |
| **3+** | One rail item per phase, in order: **P&L → Orders → Needs you → Analytics → Labor → COGS → Menu → Invoices → Inventory → Ingredients → Recipes → Vendors → Stores → Monitoring → Settings → Ask**. Each phase deletes the editorial code its page made dead. |
| **F** | The five unreachable screens, the ~10 redirect shims, a final sweep for dead editorial CSS and components, then merge `dashboardv2` → `main`. |

P&L is first after Overview because it is the highest-value screen and because
note 60's two conflicting prime-cost definitions are best resolved before four
other pages inherit the ambiguity.

---

## 7. Risks

| Risk | Handling |
|---|---|
| TypeScript 7 and TanStack Table 9 surface errors across 865 source files | Separate commits. If TS 7 exceeds a day of work it is deferred and the sweep continues — reported, not ground through. |
| Recharts 3 may not support hover-anywhere / 42% dim / touch-drag | Answered by a spike in Phase 0a, before any primitive depends on it. If it cannot, `<Chart>` gets a thin custom SVG layer behind the same props; pages never learn the difference. |
| No rebase against an active main (decision 7) | Read-only drift watch at every gate. Escalate only if main touches `src/app`, `src/components` or `src/styles`. |
| Several hundred screenshot baselines churning | Baselines start at Phase 2, after the primitives settle. |
| The mobile lean-tool rule is renegotiated by decision 4 | Stated explicitly here; the stored preference is updated once the phone surface is real, not before. |
| `next-auth` carries a CRITICAL advisory and is a direct dependency; `next` and `prisma` carry HIGH | All three report non-breaking fixes. Cleared in Phase 0a's first two commits. |

---

## 8. Open, deliberately

- The six owed sections in §3.2 each need their own spec. None blocks Counter.
- Whether the phone surface keeps all 17 rail items or a subset is decided in
  Phase 1 against the real primitives, not in advance.
- Deleting the redirect shims is a follow-up gated on access logs, not on a date.
