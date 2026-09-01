---
name: Chris Neddy's Restaurant Dashboard
description: Counter — one system across the desk and the phone.
tokens: src/styles/counter.css
prototype: docs/counter/counter-prototype.html
spec: docs/superpowers/specs/2026-08-23-counter-design-system-design.md
tokenTests: tests/styles/counter-tokens.test.ts
lint: scripts/counter-lint.ts (npm run tokens)
---

# Counter

Every colour, type size, radius and easing curve this system uses lives in
[`src/styles/counter.css`](src/styles/counter.css) and nowhere else — one
`:root` block, each colour a `light-dark(light, dark)` pair. This document
does not repeat those values, because a second copy is how six drifted
copies of `--ink-faint` happened to the previous system. It says what the
tokens mean and when to reach for each one; go to the file for the actual
number.

This branch (`dashboardv2`) is rebuilding the dashboard on Counter, page by
page. The pre-Counter design system — a serif italic display face, cream-
toned hex colours, hairline-bordered panels, a red hover-bar row pattern —
still runs on ~59 files under `src/app/dashboard/**` and the mobile shell,
because those pages haven't been rebuilt yet. It is being deleted phase by
phase as each page moves to Counter (see the spec's §6 phase table), not
replaced in one cutover. Don't extend it, and don't mistake its continued
presence in the tree for it still being the target design.

## Type

Two tiers, three faces on Counter pages — four are loaded overall. This is
unchanged from the old system's typography rule, with the display face
swapped. `src/app/layout.tsx` adds Bricolage Grotesque, but
`src/app/dashboard/(editorial)/layout.tsx`, `src/app/login/layout.tsx`,
`src/app/signup/layout.tsx` and `src/app/(mobile)/m/layout.tsx` all still
also load Fraunces — a deliberate, sound deviation, since removing it would
break the ~59 still-unrebuilt editorial pages that depend on it; it is
deleted in Phase F, once every route in the spec's §6 phase table has moved
to Counter.

| Role | Face | Rule |
|---|---|---|
| Page titles, the wordmark — **only these** | Bricolage Grotesque, weights 600/700/800 | `font-ct-display` |
| Every figure — KPI value, row total, chart tooltip amount, date range | DM Sans 500–600 | `tabular-nums lining-nums`, always |
| Prose | DM Sans 400 | |
| Captions, folios, SKUs, status labels | JetBrains Mono | |

Bricolage is loaded as a variable font restricted to 600/700/800 — it never
appears at body weight, and it never appears on a number. Crossing either
line is the same regression the old system called out under its "Two-Tier
Rule": a display face on a dollar amount, or a figure set in the display
face, both fail the system.

The scale is fixed px, ratio ~1.16, seven steps: `text-ct-micro` (10),
`text-ct-cap` (11.5), `text-ct-body` (13), `text-ct-mid` (15), `text-ct-lg`
(18), `text-ct-xl` (22), `text-ct-hero` (30). Values are the source-of-truth
file's `--ct-t-*` tokens, exposed as Tailwind text utilities via the `@theme
inline` block — don't hardcode a px value that happens to match one.

## Colour

Every colour on a Counter page is a `ct-` utility, sourced from
`counter.css`'s 33 colour tokens. There are no exceptions, and `npm run
tokens` fails the build on a hex, `oklch()`, `rgb()`/`rgba()`, `hsl()`/`hsla()`
literal, or a generic Tailwind palette class (`bg-sky-500` and every sibling)
anywhere under a Counter root.

**Surfaces** stack from lightest to darkest: `ct-surface` (a panel) sits
above `ct-paper` (the page), which sits above `ct-chrome`, which sits above
`ct-sunk`. No pure white and no pure black anywhere — every neutral is
warm-tinted (hue ~55–66 in both themes). The stack's monotonicity is asserted
by test, in both themes.

**Ink** has three weights — `ct-ink` (body text, totals, headings),
`ct-ink-2` (secondary prose, resting labels), `ct-ink-3` (captions, folios,
SKUs, the smallest type layer). In the light theme these are not evenly
spaced: `ct-ink-3` sits only 5.5 lightness points above `ct-ink-2` (52.5% vs
47%), where the prototype's own design put 8 points between them. That gap
was closed in two separate corrections, both to `--ct-ink-3` alone (hue and
chroma never moved) — the prototype's original value, 55% lightness, failed
WCAG AA (4.5:1) against `--ct-paper` at 4.356:1. The first correction
(55% → 53.5%) fixed the paper case but missed `--ct-chrome` — darker than
paper, and only found once every surface the token actually renders on was
audited, where it still failed at 4.396:1; the second correction
(53.5% → 52.5%) was solved against every real surface. This is a real
design cost — the muted-ink hierarchy reads flatter in light than the
prototype intended — taken deliberately for a hard compliance floor, not an
aesthetic call. The full before/after, including why 51.5% (which would have
also cleared `--ct-sunk`) was rejected, is in `counter.css`'s header comment.
A third correction in the same direction is flagged there as worth stepping
back on rather than repeating.

**The accent is earned.** `ct-accent` is the proofmark — the same "earn the
red" discipline the old system had. It marks state, not rest: a hover, a
selection, an active nav item, a flagged or over-target value. If it's
sitting on more than one element at rest on a screen, something's wrong. For
ordinary interaction feedback (a hovered row, a pressed control) reach for
`ct-sunk` or `ct-accent-wash` instead — the accent is not a general-purpose
hover colour.

**State** is `ct-good` / `ct-warn` / `ct-bad` / `ct-signal`, each paired with
its own `-wash` for the ground it sits on. These four (plus the proofmark)
were re-solved jointly across three fix rounds in the dark theme specifically
so `ct-accent` reads as the *stronger* red against `ct-bad`, matching the
light theme's relationship — see the long comment above `--ct-accent` in
`counter.css` if you're ever asked to touch any of these six tokens again;
they don't yield to changing one in isolation.

**Channel identity** (`ct-ch-house`, `ct-ch-dd`, `ct-ch-ue`, `ct-ch-gh`) marks
brand identity — a DoorDash icon, an in-house tag — and is always paired with
a text label. It is never used to carry data: measured as a set, the four
channel hexes clear only ΔE 8.5 apart, which is not separable enough for a
chart to lean on colour alone.

**Data bands** (`ct-mx-1…4`) are what a chart actually uses to show a
channel's numbers — separated by lightness, not hue, and fixed to the
channel rather than to its rank in a given chart. **Overshoot causes**
(`ct-gp-1…3`) are a second, distinct ramp for the same idea applied to "what
made a number go over" — colour the overshoot, not the whole measure: only
the distance past a reference point gets coloured.

### Both themes are asserted, not assumed

[`tests/styles/counter-tokens.test.ts`](tests/styles/counter-tokens.test.ts)
runs 154 assertions across both themes and four colour-vision models (normal,
protanopia, deuteranopia, tritanopia): WCAG contrast on 26 real
token/surface pairings (audited against the actual prototype markup, not just
the obvious cases — hover rows, pressed states, error rows are all in
there), CIEDE2000 adjacency on the `mx` and `gp` ramps, semantic distinction
between meaning-carrying pairs (the proofmark must stay visibly redder than
"this is wrong", a warning must stay visibly distinct from an
attention-seeking callout — even to someone with one of the three colour
vision deficiencies), and the surface-stack monotonicity described above. If
you change a token, this file is the judge, not a screenshot.

146 of the 154 pass. **8 are `it.skip`, not deleted** — every one is a light-
theme-only, inherited defect in the prototype's own claims about the colours
it drew, each carrying its measured value in the test title:

- `ct-gp-3` against `ct-surface` clears 2.980:1 against a 3:1 requirement
  the prototype itself makes for that ramp.
- The `ct-mx-1`/`ct-mx-2` adjacent pair clears 13.6–14.1 ΔE across all four
  vision models, against a 15 ΔE requirement.
- The `ct-gp-1`/`ct-gp-2` adjacent pair clears 13.2–15.3 ΔE under three of
  the four vision models, against a 16 ΔE requirement.

These are legibility trades, not compliance failures — WCAG doesn't govern
chart-band separation the way it governs text contrast — so they were a
judgment call, and the ruling on them was to leave the frozen light value
alone rather than distort the prototype's palette further to chase one more
tenth of a ΔE unit. The identical assertion on the *dark* side of each of
these three is not skipped; dark was authored for this project (see below)
and is held to the claim in full. A ninth near-miss, `ct-ink-3` against
`ct-paper`, is **not** on this list — it's the one that got fixed, not
skipped (see above).

Dark values were authored from scratch for this project — the prototype
never drew a dark theme — so nothing in dark carries an "inherited" excuse.

## Shape

Two radii, `rounded-ct` (8px) and `rounded-ct-sm` (5px). Nothing else — no
`rounded-md`, no `rounded-xl`.

## Motion

`counter.css` defines one easing curve, `--ct-ease` /
`cubic-bezier(0.22, 1, 0.36, 1)`, used everywhere something animates. The
system's motion model (spec §5.4): one orchestrated entry per screen,
sections rising in reading order 36ms apart and finished inside 330ms;
charts draw once (lines stroke in, bars grow from baseline); figures count
up to their final value over 480ms; everything is off under
`prefers-reduced-motion`. `npm run tokens`' `no-direct-motion-import` rule
already blocks a Counter-root page from importing `framer-motion` directly —
motion is meant to live behind primitives in `src/components/counter/motion/`
so `prefers-reduced-motion` is honoured in exactly one place, not
re-implemented per page. That directory doesn't exist yet; it and the rest
of `src/lib/counter/*` are Phase 1 (next plan), not this one.

## The browserslist entry is load-bearing, not clutter

`package.json` carries:

```json
"browserslist": ["chrome >= 123", "safari >= 17.5", "firefox >= 120", "edge >= 123"]
```

This looks like boilerplate and is not. Every colour token is declared once,
as `light-dark(light, dark)`. Below these versions, Lightning CSS (the build's
CSS transform) downlevels `light-dark()` into a media-query-only fallback,
because older engines don't support the function — and that fallback only
ever resolves against `prefers-color-scheme`. The moment that happens, a
user's *explicit* theme choice (light/dark override, not "match system") goes
silently inert: the toggle still runs, `localStorage` still records the
choice, but the page keeps following the OS setting regardless. Removing or
loosening this list to "be safe" is the single most plausible way to quietly
break theming for anyone not on system-default — do not touch it without
retesting explicit theme selection across the build output, not just in dev.

## The rules, and where they're enforced

Run `npm run tokens` (`scripts/counter-lint.ts`). It's a regex-over-text
check, not an AST, and fails the build on:

1. **`no-colour-literal`** — a hex, `oklch()`, `rgb()`/`rgba()`, or
   `hsl()`/`hsla()` literal outside `counter.css` itself.
2. **`no-tailwind-palette`** — `bg-sky-500` and every generic Tailwind
   palette colour, on any Tailwind property (`bg-`, `text-`, `border-`,
   `ring-`, `fill-`, `stroke-`, gradient stops, `outline-`, `shadow-`,
   `accent-`, `caret-`, `divide-`).
3. **`no-status-branch`** — a page checking `.status ===`/`!==` or
   switching on a `SectionData` status literal. That belongs to `surface/`
   and `state/` components, which render the status; a page that inspects it
   directly has broken the keystone that makes the six-state contract
   testable without a browser.
4. **`no-direct-data-import`** — a page importing `@/lib/prisma`,
   `@prisma/client`, or an `@/app/actions/*` server action directly (static
   or dynamic `import()`/`require()`). Pages call adapters in
   `src/lib/counter/adapters/`; adapters call the existing server code.
5. **`no-direct-motion-import`** — a page importing `framer-motion` (or
   `motion/react`) directly, static or dynamic. See Motion, above.
6. **`no-shell-in-page`** — a page or page client under
   `src/app/dashboard/**` or `src/app/(mobile)/m/**` importing or rendering
   `AppShell` or `PhoneShell`. After the streaming-architecture rebuild
   (Task 1) both belong to exactly one place each —
   `src/app/dashboard/(counter)/layout.tsx` and
   `src/app/(mobile)/m/(counter)/layout.tsx` — and a page that mounts its
   own is the regression the whole plan exists to repair (4 mount sites, 0
   layouts, measured before the fix). `layout.tsx` files are the rule's own
   exemption, not a legacy one.
7. **`no-route-without-loading`** — a directory under one of the two
   `(counter)` route groups that holds a `page.tsx` but no `loading.tsx`
   beside it. This is the one rule that is a directory check rather than a
   regex — the defect is an absence, and there is no line of text for a
   pattern to match against an absence. It never reaches the ~19 remaining
   editorial pages at all (they live outside both `(counter)` groups), so it
   needs no LEGACY exemption of its own.
8. **`no-awaited-sections-in-page`** — a `page.tsx` under one of the two
   `(counter)` route groups calling `await get<Anything>Sections(...)`
   instead of the not-awaited `get<Anything>SectionPromises(...)` shape Task 3
   of the streaming-architecture plan moved six of the eight Counter pages
   onto. Like rule 7, this walks `page.tsx` files under the two route groups
   directly rather than running as a per-file regex over everything else the
   other rules reach, and for the same reason needs no LEGACY exemption: the
   editorial pages live outside both `(counter)` groups. Two routes are
   exempted **by name**, not by pattern —
   `src/app/dashboard/(counter)/orders/[id]/page.tsx` and
   `src/app/(mobile)/m/(counter)/orders/[id]/page.tsx` — because ruling S-R5
   keeps both on a single `await getOrderSections(...)`: all seven of their
   sections come from one `getOrderDetail` load, so splitting it into seven
   promises resolving in the same tick would be a picture of streaming rather
   than streaming, and the page must resolve `head` before rendering at all,
   to decide its 404.

It checks `src/app/dashboard/**`, `src/app/(mobile)/m/**`,
`src/components/counter/**`, and `src/lib/counter/**`. Legacy files under the
first two roots are exempt *only* while their on-disk content is byte-
identical to what that path held at the gate's baseline commit — the moment a
legacy file is rewritten (onto Counter or for any other reason, including an
uncommitted edit), it loses the exemption and is linted for real. The
exemption can only shrink. Rules 7 and 8 are scoped narrower than the other
six (the two `(counter)` route groups, not the full first two roots) for
exactly the reason their own entries above give.

It's a regex, so it has known, documented holes — five of them, recorded in
`scripts/counter-lint.ts`'s module comment rather than only in a report: a
dynamic Tailwind class built from a template string or `cn()` concatenation
(`` `bg-${color}-500` ``) has no literal palette name to match;
a destructured `const { status } = section` bypasses the literal `.status`
accessor the rule looks for; a barrel re-export of `prisma` from a path
other than the exact specifiers it checks slips through; and a legitimate
dynamic `` `rgb(${r},${g},${b})` `` (a canvas pixel buffer, a runtime chart
gradient stop) still trips `no-colour-literal` with no way to tell it apart
from a real violation — that one doesn't have a home to allowlist yet,
because no Counter chart primitive needs it yet; don't pre-build one. A
fifth, narrower hole is in the comment-stripping step itself: a genuine
comment written inside a template-literal `${...}` expression isn't
stripped, because the scanner treats everything between backticks as opaque
string content. None of these are silent — a hole that's written down is a
limitation; one that isn't is a trap.

One more rule can't be linted, because it needs judgment: **a figure shown on
two pages must come from one function in `src/lib/counter/`.** The spec's
note 60 is the cautionary tale this rule exists to prevent: in the pre-Counter
dashboard, Overview read prime cost at 56.2% and the P&L read 57.9% for the
same range on the same store, because one counted hourly wages and the other
counted hourly cost. `src/lib/counter/prime-cost.ts` is where that
computation is meant to live going forward, as a Phase 1 deliverable — it
doesn't exist yet, and neither does the rest of `src/lib/counter/*`. Until
it lands, don't let a second page reimplement a number another page already
computes; when it lands, that's the file to import from, not to duplicate.

## Primitives

Import from `@/components/counter`. Never deeper — `state/` is private to
`surface/` on purpose.

**`Section` is the SOLE state renderer (R3).** It is the only primitive that
takes `SectionData<T>`. `Strip`, `Table`, `Meter` and `Cascade` are
presentational: they take their data directly — plain figures, rows, steps,
values — and have no loading/empty/failed branching of their own. The
six-state contract exists only where a `Section` wraps them; a `Strip` or
`Table` rendered outside a `Section` has no fallback for a state it cannot
see. This was a deliberate fork resolved during the fix wave that followed
Plan 2's review: the alternative (each primitive re-implementing all six
states so it works "nested or standalone") was half-built and had shipped a
real bug — a failed `Table` and an empty `Table` both rendered a header over
an empty `<tbody>`, pixel-identical, with no error, no reason, no retry. Sole
rendering closes that gap by construction: there is exactly one place in the
tree a state is ever rendered.

| Primitive | Enforces |
|---|---|
| `<Section>` | All six `SectionData` states — the only primitive that sees a `SectionData`. `children` is a function, so it cannot run without data. Renders "Ask about this" only when there is an answer (note 55). |
| `<Strip>` | Takes `cells: FigureProps[]` directly — no state, no `cellCount` (the count is just `cells.length`). Nest inside a `Section` for the em-dash/loading/failed shape. |
| `<Figure>` | Tabular lining numerals on every value. |
| `<Table>` | Takes `columns` and `rows` directly — no state. Rules only, sticky head, right-aligned figures. A row without `href` is not a link, not focusable, and wears no pointer (note 47). |
| `<Meter>` | Colours the overshoot, not the measure (note 35). |
| `<Cascade>` | Draws a statement as the sequence of subtractions it is, not a donut (note 52). |

`SectionData<T>` (from `@/lib/counter/section-data`) has six states: `ready`,
`stale`, `loading`, `failed`, `empty`, `not_computed`. A page never inspects
`.status` — `npm run tokens` fails the build if one does — and, with R3, a
`Strip`/`Table`/`Meter`/`Cascade` never inspects it either, because they
never receive it.

## Motion

All of it lives in `src/components/counter/motion/`, and nothing else in the
codebase may import `framer-motion` — `npm run tokens` fails the build if it does.

| What | Timing | Hook |
|---|---|---|
| Sections rise in reading order | 36ms apart, done by 330ms | `useEntry(index)` |
| Figures count up | 480ms, landing exactly on the value | `useCountUp(value)` |
| Lines stroke on | 720ms | `useChartDraw()` |
| Bars grow from the baseline | 26ms apart | `useChartDraw()` |
| Non-hovered bars dim | to 42% | `<Chart variant="bar">` |

Every one of them is off under `prefers-reduced-motion`, decided in a single
place — `useReducedMotion()` — which defaults to REDUCED when `matchMedia` is
unavailable. A missed animation is cosmetic; an unwanted one can cause harm.
Verified in a real browser: `docs/counter/motion-verification.md`.

The bar variant carries more internal wiring than the line variant: dimming
routes through `Cell` plus per-series mouse state, and the stagger through a
custom `shape` render prop, because Recharts animates a bar series on one shared
timer. Both sit behind the same `<Chart>` props — a page never learns which.

**`useEntry` compresses, then stops.** Sections 0–3 get the full 220ms rise;
sections 4–8 compress as their delay eats into the 330ms budget (index 6:
216ms delay, 114ms duration remaining; index 9: 324ms delay, 6ms duration);
index 10 and beyond appear instantly at the 330ms boundary, delay having
consumed the whole thing. That's
deliberate, not a bug: anything past index ~4 is below the fold on mount, so
there is no reason to spend animation budget making it rise slowly — it's
one `Math.min`/`Math.max` pair (see the doc comment on `useEntry`), not a
special case.

**Reduced motion was verified in a real browser, and a real hydration defect
it found is now fixed systemically.** `docs/counter/motion-verification.md`
records both media settings measured against a running `npm run dev`, not a
stubbed `matchMedia`. `useReducedMotion` deliberately does not read
`matchMedia` during render: its initial state is unconditionally `true` (the
safe, reduced default) on both server and client, full stop, and the
existing effect reads the real preference on mount and subscribes to
changes after that. That is what keeps SSR and the first client render in
agreement — every consumer, `useCountUp` included, paints the same *final*
value on the server and on hydration, and motion only switches on one frame
later once the effect confirms a real `no-preference` client. See
`docs/counter/motion-verification.md` for the measured before/after numbers,
including the post-fix real-browser run showing 0 console errors under both
media settings.

## Shell

`AppShell` (`src/components/counter/shell/app-shell.tsx`) is the frame every
Counter page sits inside: a skip link, a 212px rail column (`Wordmark` above
`Rail`), the topbar, and `<main id="ct-main">` for the page.

**A LAYOUT mounts it, not a page.** `src/app/dashboard/(counter)/layout.tsx`
renders it once around every rebuilt desk route; `PhoneShell`
(`shell/phone-shell.tsx`) does the same for the four rebuilt `/m` routes from
`src/app/(mobile)/m/(counter)/layout.tsx`. It used to be rendered inside each
page's client island — 4 desk mount sites and 4 phone ones, 0 layouts — and a
page does not survive a sibling navigation in the App Router while a layout
does, so clicking a rail item destroyed and rebuilt the rail, the topbar, the
store switcher and the ⌘K surface every time.

**That was cheap because the chrome is URL-driven.** The store switcher and
the date control both read `readCounterParams` and write `writeCounterParams`
— they were `useSearchParams()` consumers wearing callback props. In the
layout they read the URL and push their own changes, so `pathname`, `params`,
`presetId`, `onSelectPreset`, `selectedStoreId` and `onSelectStore`
disappeared from the interface rather than moving up it. `PageHead` stays with
the page: the title sentence, the sub-line and the date control are genuinely
page-specific, and they live inside `#ct-main`, which is the surface
`npm run fidelity` measures — so the DOM under it did not move.

Two smaller pieces carry what is left. `src/lib/counter/route-shape.ts`
answers what a ROUTE STRING can answer — whether the page has a window at all
(`nodate: true` in the prototype), where "pick a store" goes on a page that
`?store=` cannot re-scope, and the phone's back trail — on the server, in the
first render. `shell/page-chrome.tsx` carries what only a page's own DATA
knows, which today is three fields on `/dashboard/orders/<id>`: the crumb
leaf, the store the order belongs to, and the palette's questions. Those are
published in an effect, so they land on hydration rather than first paint;
all three sit outside `#ct-main` and none is a landmark class.

**Seventeen destinations, in five groups, declared once.** They live in
`src/lib/counter/nav.ts` as `NAV_GROUPS`, and nowhere else builds this list —
`Rail` only renders it. Note 24: "a rail item is a decision, not an
inventory." The pre-Counter dashboard had thirty-two entries, which is a
table of contents, not navigation. Seventeen is a deliberate cut, not an
oversight: pages that absorbed another page keep it as a *view* rather than
a rail item (Menu holds Items, Profit and Mix; COGS holds
theoretical-vs-actual), and a per-store page is the store switcher's
destination, not an eighteenth item. `docs/counter/shell-verification.md`
verified the payoff of that cut in a real browser: at a 900px viewport, all
seventeen items and their five captions render without the rail needing to
scroll internally — confirm this again rather than trusting it, the way
that file's Step 1 did, before adding an eighteenth destination.

**A destination stays lit for its children, because the route *is* the
hierarchy (note 48).** `isActive()` in `nav.ts` lights an item on an exact
match *or* a path-prefix match (`pathname === item.href ||
pathname.startsWith(item.href + "/")`), so `/dashboard/invoices/I28517` is
still Invoices. This is also where the breadcrumb and the phone's back
button come from — there is no separate hierarchy data structure to keep in
sync with the URL, because the URL already is the hierarchy.

**`aria-current="page"` — not colour — is what announces the current
destination.** `RailLink` sets both from the same `isActive()` call in the
same expression, so they cannot disagree: `aria-current={active ?
"page" : undefined}` alongside the `bg-ct-accent-wash` / `text-ct-accent-hi`
classes that give it colour. A screen reader never has to infer "current"
from an accent wash it can't see; a sighted user gets the wash as the fast
path to the same fact `aria-current` already carries.

**`EntryItem` exists because `Section` must stay a server component.**
`Section` (`surface/section.tsx`) is the sole renderer of `SectionData`'s
six states (R3) — if it called `useEntry` itself it would become a client
component, and every page's data rendering would cross the client boundary
with it, just for an entrance animation. `AppShell` owns the entry index
instead: a page (itself a server component) writes `<EntryItem
index={i}><Section .../></EntryItem>`, and only `EntryItem` — a thin client
wrapper around `useEntry` — crosses that boundary. `Section` never does.

Verified in a real browser, at real content size, in both themes:
`docs/counter/shell-verification.md`. That session's two findings — the
rail is not sticky, so it scrolls away with the page once a page is taller
than the viewport; and `border-ct-line` (and every other `border-ct-*`
utility, checked on the rail, `Section`, and `Table`) silently falls back to
a generic, non-theme-reactive grey instead of the design's hairline token,
in both themes — are open, not fixed by that task. Read them before
building on top of either.

## Controls

`StoreSwitcher` and `DateControl` (`src/components/counter/shell/`) are the
range and store pickers every page's figures are a claim about. `Topbar`
(`src/components/counter/shell/topbar.tsx`) wraps them in its children
slot, and derives its own breadcrumb from `pathname` against `NAV_GROUPS` —
see the Shell section above for that derivation; nothing about it repeats
here.

**The range and the store live in the URL, not component state.** A figure
an owner is looking at should survive a reload and be shareable — "look at
this week's prime cost" is a link to send, not a description of which
controls to click — and it means the back button works on a range change,
matching what a reader expects when a page's numbers changed underneath
them. `readCounterParams` / `writeCounterParams`
(`src/lib/counter/url-state.ts`) are the only place this happens: reading
treats the URL as untrusted (a hand-edited, stale, or truncated param falls
back to a sane default rather than throwing), and writing drops any param
that's already at its default, so a shared link stays as short as
`?range=d30` rather than `?range=d30&cmp=prev&store=`. Verified against a
real address bar, not just a `URLSearchParams` object, in
`docs/counter/controls-verification.md` — a preset, a comparison and a
store all round-trip through an actual page reload, and setting all three
back to their defaults empties the query string completely.

**Each of the twelve presets shows its own span, not the current
selection's.** The range menu's `· 30 days` / `· 7 days` caption beside
each preset name is that preset's own `dayCount(p.resolve(today))`
(`src/lib/counter/date-range.ts`), so a reader picks by span before they've
even committed to a name — "Last 30 days" and "Month-to-date" read as
30 days and ~24 days apart at a glance, before either is selected.

**Steppers walk by the span you're on, not a calendar unit.** `stepRange`
shifts both ends of the current range by exactly its own length
(`dayCount(r) * direction`) — a 7-day range steps 7 days, a 30-day range
steps 30. Stepping a "last 30 days" window by a calendar month would
silently change how many days it covers every time a reader clicked ‹; this
keeps the window's length invariant across every step, which is the only
way "previous period" means the same thing twice in a row.

**The weekday comparison is withheld past a week, not offered and left
empty.** `comparisonRange(range, "weekday")` returns `null` once the range
exceeds 7 days (see the doc comment on it in `date-range.ts` for why:
past a week, "the four preceding occurrences of this period" stops naming a
coherent window). `DateControl` filters the comparison menu by that same
function rather than re-deriving the 7-day cutoff itself, so the menu can
never drift from the rule the range logic actually enforces. An offered
comparison that renders empty reads as "no change happened"; withholding it
reads as "that question doesn't apply here," which is the true state.
Verified end to end — not just the unit test — in
`docs/counter/controls-verification.md`: the menu shows three options on a
30-day range and four, weekday included, on a 7-day one.

**The popover measures its own frame before it opens (note 21): "a popover
that leaves its frame is broken, not clever."** The range menu's natural
width (438px, ported verbatim from the prototype's own `place()`) is wider
than a 390px phone. Rather than fix a width and hope, `useFramePlacement`
measures the trigger's `getBoundingClientRect()` and `window.innerWidth` the
moment the menu opens, clamps the width to
`clamp(280, viewportWidth - 24, 438)`, and — only when right-anchoring at
that width would push the left edge past a 10px margin — pins an explicit
`left` offset instead of the CSS default. Measured in a real browser at
1440, 900 and 390px in `docs/counter/controls-verification.md`: the menu
stays fully on screen at all three, the 390px case included, with the flip
firing exactly where the arithmetic predicts it should.

## Ask

`AskSurface` (`src/components/counter/ask/ask-surface.tsx`) is the ⌘K
palette, mounted once in `AppShell` so every Counter page gets it without
opting in. It fixes two numbered defects from the prototype's own log —
note 46 ("two surfaces promised ⌘K and nothing opened... fourteen rules of
dead CSS behind an advertised shortcut") and note 55 (fifty `Section`
"Ask about this" buttons wired to nothing) — and answers note 43's finding
that Ask was the longest-held page in the product because it answered for a
store the reader was not looking at.

**⌘K opens it, from anywhere.** A `keydown` listener on `document` opens
the surface on `(metaKey || ctrlKey) && key === "k"`, preventing the
browser's own default for that combination, and closes it on `Escape`,
restoring focus to whatever held it before the surface opened. A bare `k`
does nothing, deliberately — it would otherwise fire while a reader is
typing anywhere else on the page.

**The context sentence is derived, never passed (note 43).**
`describeAskContext` (`src/lib/counter/ask-context.ts`) reads the same
`pathname` and `params` the page itself reads — the same `NAV_GROUPS` /
`isActive` the rail and the breadcrumb already use, the same `PRESETS` the
date control already uses — so the sentence above the input ("Answering
about P&L · Hollywood · Last 7 days") cannot name a different store or
range than the one on screen. A caller cannot pass a stale value because
there is no value to pass: `AskSurface` takes `pathname`/`params`/
`storeName`/`today`, the same inputs the page already has, and derives the
rest itself.

**`data-ask-about` reaches the surface by event delegation, not a prop
(note 55).** `Section` — the sole renderer of `SectionData`'s six states —
is deliberately not a client component (see the Shell section above). One
`click` listener on `document`, owned by `AskSurface`, walks up from the
click target looking for `[data-ask-about]`; when it finds one, it opens
the surface with that attribute's value pre-filled into the input. This is
why `Section`'s "Ask about this" button — rendered on every section that
has an answer, note 55's fifty dead buttons — needed no change here and
`Section` needed no `onAsk` prop: adding one would force `Section` client-
side and drag every page's data rendering across the boundary with it, just
to wire up a button.

Verified end to end in a real browser, not just the delegation unit test:
`docs/counter/ask-verification.md`. ⌘K and Ctrl+K both open the surface on
a real page; a real `Section`'s "Ask about this" button opens it pre-filled
with that section's title; the context sentence matched a real URL's store
and range and changed when the range did; both themes showed zero console
errors. That session also found that `page.screenshot({ scale: "css" })`
is not reliable evidence for `light-dark()`/`oklch()` backgrounds on this
headless Chromium build — `getComputedStyle` and `scale: "device"`
screenshots told the true story where a first-pass screenshot looked
suspiciously identical between themes.

## Pages

A Counter page is a server component that composes primitives. It calls
**exactly one adapter** and renders what comes back — it computes nothing
and reasons about nothing, because every place that needs to reason (is
this section empty, did it fail, is it owed) is already implemented once,
inside `Section` and the six state components under `src/components/
counter/state/`.

**The adapter contract** (`src/lib/counter/adapters/types.ts`) is the only
new server code a page needs. `classify(load, opts)` runs one loader and
turns whatever happens — a value, a thrown error, an empty result, an
explicitly `owed` section — into exactly one of the six `SectionData`
states, and never throws: a page that 500s because one query timed out
throws away every other figure the reader could still have used. An
adapter under `src/lib/counter/adapters/**` is the one place allowed to
import `@/lib/prisma` or `@/app/actions/**` directly and the one place
allowed to branch on ordinary values it constructs into `SectionData` —
`npm run tokens` enforces both restrictions everywhere else.

**A page never touches `.status`.** `Section` is the sole renderer of that
union; a page hands it a title and a `SectionData` and gets all six
renderings — loading, failed, empty, not-computed, stale, ready — with no
opportunity to get one wrong. `npm run tokens`'s `no-status-branch` rule
fails the build on a `.status ===` comparison anywhere under
`src/app/dashboard/**`, so this isn't a convention a page author has to
remember — it's enforced.

**`owed`, not a fake number.** A section the design calls for but no server
code computes yet renders `Owed` — a named, honest "not computed yet" card
— rather than a zero, which reads as a real measurement, or a silently
missing section, which reads as a design that never wanted one. Overview's
`splh` section is the first real instance of a subtler rule: when the only
data source for a figure *cannot* be scoped to the page's selected date
range at all, showing it anyway — even correctly labelled — answers a
different question under the same heading as the range-scoped figures
beside it. That is worse than an honest gap, so it is `owed` too, not shown
with a caveat.

**One adapter call, not one call per section.** `getOverviewSections`
returns a record of named `SectionData`s from a single `Promise.all`, so a
slow section never serialises a fast one — and derived figures (Overview's
`sales` total) are computed from a section's own already-loaded rows rather
than fetched a second time under a different name.

**A `URLSearchParams` instance does not survive the server→client
boundary.** A page passing one directly as a prop to a client island will
compile, typecheck and pass a unit test that constructs the client
component directly — and throw at runtime in a real browser, because
React's Flight serialisation carries plain values, not a class instance's
prototype. Pass the query string (`params.toString()`) and reconstruct
`new URLSearchParams(...)` inside the client component instead. Found
during Overview's own verification — see `docs/counter/
overview-verification.md`.

Overview (`/dashboard`, `src/app/dashboard/page.tsx` +
`src/app/dashboard/counter-overview-client.tsx`) is the first page built
this way — see `docs/counter/overview-verification.md` for what it looks
like end to end in a real browser, including a second real bug that
session found (`Strip`'s fixed 2/4-column grid leaves bare hairline
tracks when fed fewer cells than its layout expects) and the structural gap
found alongside it — `/dashboard` rendering inside two navigation shells at
once, with a ⌘K collision to match — which the `(editorial)` route group
below fixed.

## The `(counter)` and `(editorial)` route groups, and how a page migrates

`src/app/dashboard/(editorial)/` holds every page still on the pre-Counter
design — ~19 directories. Its `layout.tsx` carries the editorial chrome: the
cream `AppSidebarClient` sidebar, `ChatDrawerProvider`/`ChatDrawerClient` (the
"Owner Analyst" drawer and its own ⌘K listener), `WelcomeMarquee`, the four
editorial stylesheets, and Fraunces.

`src/app/dashboard/(counter)/` holds every desk page that HAS been rebuilt —
`/dashboard`, `/dashboard/orders`, `/dashboard/orders/<id>`, `/dashboard/pnl`
— and its `layout.tsx` carries the Counter chrome: `AppShell`, and the one
`getOverviewStores()` call the rail's switcher needs.
`src/app/(mobile)/m/(counter)/` is the same arrangement on the phone, for the
same reason: `src/app/(mobile)/m/layout.tsx` is shared with a dozen editorial
`/m` pages that have their own toolbar, so the Counter phone shell needs a
group of its own to sit above.

`src/app/dashboard/layout.tsx` — the parent of both groups — carries only what
every route under `/dashboard` needs regardless of design system: a session
read and `PageViewTracker`. Two route groups under one thin layout is the
shape: neither shell can reach the other's pages.

Two routes deliberately stay OUTSIDE `(counter)` even though a Counter page
links to them: `/dashboard/pnl/[storeId]` and `/m/pnl/[storeId]`. The first is
a `permanentRedirect` shim that renders nothing, and the second is still
editorial.

Parenthesised segments are a Next.js route group: they organise the file
tree without becoming a URL segment, so `(editorial)/orders/page.tsx` still
serves `/dashboard/orders`, not `/dashboard/(editorial)/orders` — verified
against the real `next build` route manifest, not assumed. This is also the
mechanism for the rest of the Counter migration: a page moves off the old
design by moving out of `(editorial)/` and into `(counter)/` (and, for a
`page.tsx`, being rewritten against the rules on this page) — no routing
change, no redirect, just `git mv` and a rewrite.
`ls src/app/dashboard/(editorial)` answers "what's still editorial" at any
point in the migration, and `ls src/app/dashboard/(counter)` answers the
other half of the same question.

Before this split, `/dashboard` rendered inside two navigation shells at
once — Counter's own `AppShell` nested inside the pre-Counter
`AppSidebarClient` sidebar, because the one `dashboard/layout.tsx` wrapped
every route, Counter's new Overview page included. The same layout also
mounted `ChatDrawerClient`, whose own ⌘K listener fired alongside Counter's
`AskSurface` on every route, Counter's included — pressing ⌘K on
`/dashboard` opened both dialogs at once. Moving the chrome into
`(editorial)/layout.tsx` fixes both: Counter routes no longer mount
`AppSidebarClient` or `ChatDrawerClient` at all, so there is exactly one
shell and one ⌘K target per route, editorial or Counter. See
`docs/counter/overview-verification.md` for what was measured after the
fix (route manifest, browser screenshots, ⌘K on each kind of route,
console errors, bundle size).

A legacy page moved into `(editorial)/` without being rewritten keeps its
`npm run tokens` LEGACY exemption: `scripts/counter-lint.ts`'s baseline
comparison tolerates the route-group segment in the file path and the
mechanical `@/app/dashboard/(editorial)/...` import-path rewrite the move
itself forces on the handful of files that reach a moved sibling by
absolute import — see `stripRouteGroups` and
`normalizeRouteGroupImports` in that file for the exact mechanism, and why
`git cat-file`, not `git show`, is used for the baseline lookup (a
dynamic-route folder like `[id]` is valid pathspec glob syntax, and `git
show <rev>:<path>` silently returns an empty, successful result for a
non-existent bracketed path instead of failing).

## Speed, and how it is measured

Two instruments, both walking `e2e/fidelity/routes.ts` so a page cannot be
rebuilt into existence without also being timed. Both want a PRODUCTION build
(`npm run build && npx next start -p 3100`) — a development server answers a
different question.

```
npm run perf:sweep                       # timings, bytes, CLS, blocking time
PERF_CPU=4 npm run perf:sweep -- --phone # the same on a phone-class CPU
npm run perf:queries                     # database round trips per page
```

`perf:sweep` splits the two halves of server time, and the split is the point:
**ttfb** is the shell — the layouts above the page, and the first byte a reader
waits on — while **stream** is every Suspense boundary resolving as its
`get*SectionPromises` settle. A page whose ttfb is 10ms and whose stream is 4s
is a fast shell over a slow loader, and nothing in the fidelity gate can see
either number.

**Timings and bytes come from different loads, on purpose.** `perf:sweep` loads
each route three times: once in a fresh context, then twice in a shared one. The
timings are the faster of the two warm loads, because a cold load carries the
server's module loading and an unprimed query plan. The BYTES are the cold
load's, because the warm ones are served from the memory cache and report
`encodedBodySize` 0 for everything already fetched. Reading bytes off a warm
load is how this sweep printed `0kB font` for all 108 route/surface pairs
through an entire pass while every screen was downloading 234kB of it — and the
font filter was also gated on `initiatorType === "css"`, which next/font's
preload-fetched files never are. Both are fixed. The lesson is that a harness
reporting a suspiciously round zero is reporting a bug in itself.

`perf:queries` needs `PRISMA_TRACE=1` on the server (see `src/lib/prisma.ts`);
it reads the round trips straight out of the server's own log. **Count is the
number that survives the move to Vercel.** This machine talks to Neon over the
open internet, so one query costs ~85ms here and ~2ms from the deployment
beside it — a local millisecond total says almost nothing, while forty round
trips are forty round trips anywhere.

Three rules came out of the first pass, each measured rather than assumed:

- **No network round trip in a layout body.** A layout's own `await` blocks its
  PARENT's flush, so until it resolves the browser has not been handed the
  `<head>` and cannot start fetching the stylesheet or the ~20 script preloads
  it is about to need. The desk waited on Neon for the rail's store list (85ms
  to first byte) and the phone waited on Upstash for a welcome flag (31ms);
  both now flush in ~11ms, with the work inside a `<Suspense>` or below a
  segment `loading.tsx`. Both fixes are ~15 lines and neither changed total
  page time — only when the browser was allowed to start.
- **One store query per request.** `cache()` memoises per FUNCTION, so forty
  helpers each holding their own `store.findMany` are forty round trips for the
  same three rows — `Store.findMany` ran between one and six times on every
  page in the product, `/dashboard/forbidden` included. `@/lib/account-stores`
  holds the one query; new code reads from it rather than asking again.
- **Ask the smaller question.** The Orders strip's comparison ran all eight of
  `getOrdersList`'s queries to read two numbers off the result. Before adding a
  loader to a page, check what the section actually reads.
- **A font declared in `not-found.tsx` is declared on every route.** Next puts
  the root not-found in every route's entry graph, so `next/font` emitted a
  preload hint for the editorial serif — Fraunces, three axes, 118kB, larger
  than Bricolage, DM Sans and JetBrains Mono put together — on every screen in
  the product. A preload hint is not lazy the way an unused `@font-face` is:
  the browser fetches the file whether or not anything paints with it. Measured
  with a cold cache, `/login`, `/dashboard/pnl`, `/dashboard/orders`, `/m`,
  `/m/orders`, `/m/settings`, `/dashboard/stores` and `/dashboard/chat` each
  downloaded it while reporting zero elements computing to Fraunces. All four
  Fraunces declarations now carry `preload: false`. The two screens that do
  paint it — `/m/count` and the 404 — still get it, on demand, and `display:
  swap` makes that a swap rather than a block. Font bytes per screen: 234kB to
  116kB.

One measurement trap, since it cost a wrong conclusion once: **do not check for
font preloads by grepping the `<head>`.** On any route with a `loading.tsx` the
page segment renders after the shell has flushed, so React delivers its font
hints as `HL[...]` entries in the flight stream rather than as `<link
rel="preload">` tags. `/login` shows four `as="font"` tags and `/dashboard/pnl`
shows none, and both start fetching the same font files at ~160ms. The tags
were never the difference; the hints are.

What the same pass found and deliberately did NOT change, so it is not
re-litigated: layout shift is ~0 product-wide (worst 0.034); total blocking
time is 0 on every route at 4× CPU throttling except `/m/ask`, whose 32ms is
the AI SDK it exists to run; the ~350kB desk bundle is react-dom, the App
Router runtime, 68kB of Counter components and sonner, with recharts and the AI
SDK correctly absent from Counter routes; and the 112kB core-js chunk in the
HTML is served `noModule`, so no modern browser fetches it.
