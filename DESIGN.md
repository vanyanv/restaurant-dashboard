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
`src/app/dashboard/layout.tsx`, `src/app/login/layout.tsx`,
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

It checks `src/app/dashboard/**`, `src/app/(mobile)/m/**`,
`src/components/counter/**`, and `src/lib/counter/**`. Legacy files under the
first two roots are exempt *only* while their on-disk content is byte-
identical to what that path held at the gate's baseline commit — the moment a
legacy file is rewritten (onto Counter or for any other reason, including an
uncommitted edit), it loses the exemption and is linted for real. The
exemption can only shrink.

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

A sixth rule can't be linted, because it needs judgment: **a figure shown on
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
`Rail`), an optional topbar slot, and `<main id="ct-main">` for the page.

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
