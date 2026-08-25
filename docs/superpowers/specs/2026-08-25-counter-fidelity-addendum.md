# Counter fidelity — addendum to the design spec

**Amends:** `docs/superpowers/specs/2026-08-23-counter-design-system-design.md`
**Date:** 2026-08-25
**Status:** binding. Where this contradicts the original spec, this wins.

---

## Why this exists

The Overview shipped in Plan 7 does not look like the prototype. Not "close but
off" — structurally different. Rendered side by side at 1440px:

| The prototype's Overview | What shipped |
|---|---|
| Dispatch line: needs-you count · orders trading · sync age · "Open the queue" | absent |
| Duo head block: net sales AND sales-per-labour-hour, with a floor meter under the second | one figure in a bordered card; the second is a grey "not computed" box |
| Verdict block: a state chip and a sentence naming the one thing that is wrong, with a link to it | absent |
| Strip of six, each cell carrying value + delta + sparkline + bullet meter + band words | a four-cell strip of plain figures, on invoices only |
| Moving block: range · what is not in the figures · labour posted | absent |
| Ask bar with three suggested questions | absent (⌘K only) |
| Two charts side by side, with a comparison series and prose under each | absent |
| Needs-you queue: three entries, each a lead figure, a body and an action | grey "not computed" box |
| Per-store **cards**, each with its own stage, sparkline and sub-figures | a four-column **table** whose empty rows are em-dashes |
| Channel breakdown: four rows, keeps-vs-commission bars, prose, two actions | absent |
| Invoices panel and guest ratings | a four-figure strip; ratings absent |

Sixteen elements against six bordered cards.

## What actually went wrong

Three things, and only the first is about effort.

**1. Composition was never scheduled.** Every plan said "the page composes
primitives." The primitives were built to a fraction of the prototype's
capability and no plan ever said "and here is the composition, element for
element." The six-state spine, the tokens and the lint are correct and stay;
they were mistaken for the deliverable.

**2. The adapters under-fetched.** `needsYou` and `modelCall` were marked
`not_computed` — owed work — without checking whether the server code existed.
It does:

```
src/app/actions/alerts/inbox-actions.ts        the needs-you queue
src/app/actions/decisions/get-decisions-view.ts
src/app/actions/forecasts/                     the model's call
src/app/actions/ratings/                       guest ratings
src/app/actions/splh-actions.ts                sales per labour hour
```

Orders, average ticket, food cost, labour, prime cost, marketplace fees,
channel mix, per-store build-out state and the invoice panel are all derivable
from queries already in the tree. The page is thin because it asked for four
numbers, not because the database holds four numbers.

**3. The shipped per-store table is the thing the design explicitly deleted.**
Prototype note 33: *"three of the rows were em-dashes … the ledger printed
twelve em-dashes and called it a store list. They are cards now."* We shipped
that table, em-dashes included, and `npm run tokens` passed it — because the
lint checks colour literals and status branching, and has no opinion about
whether a page matches its design.

## The decision

**Counter's CSS is ported from the prototype, not re-derived from it. Every
Counter component emits the prototype's own DOM structure and class names.**

The prototype is not a picture to imitate. It is a working stylesheet: 1030
rules, 100.7 KB, 452 class names, self-contained, already written in `oklch()`
against the same tokens `counter.css` carries. Reproducing that with Tailwind
utilities means re-deriving 452 classes' worth of decisions by eye, and the
Overview is what re-deriving by eye produces. Porting it makes fidelity the
default state rather than an achievement, and makes every page after it
mechanical.

Measured, not assumed — `scripts/extract-prototype-css.ts` (Task 1) separates
the prototype's own documentation-site chrome from the application's CSS:

```
style blocks      : 12
rules kept        : 1030   (35 @-rules)
rules dropped     : 52     (.masthead, .scene, .idx, .pchip, .notes, … doc chrome only)
distinct classes  : 452
output            : 100,734 chars
```

The port reads 46 custom properties and defines 45 of them itself. Only
fifteen must be supplied, and none is a colour we do not already have:

| Needed | Supplied by |
|---|---|
| `--sans` `--display` `--mono` | the three `next/font` variables already loaded |
| `--ease` | one cubic-bezier constant |
| `--t-small` | one type-scale value read from the prototype |
| `--len` `--pc` `--qc` | set inline, per element, at runtime (chart lengths, bar percentages) |
| `--page-bg` `--page-surface` `--page-line` `--page-ink` `--page-ink-2` `--page-ink-3` `--page-accent` | mapped to their `--ct-*` equivalents |

### Theming survives the port

The prototype's `.frame` block defines its tokens light-only. `counter.css`
defines all 33 colours as `light-dark()` pairs and is asserted by test in both
themes. So the port **strips the `.frame` token declarations** and replaces
them with an alias layer — `--ink: var(--ct-ink)`, `--line: var(--ct-line)`,
and so on. The prototype's rules port unchanged, `counter.css` remains the
only colour source (rule 1 intact), and dark mode keeps working.

### What this costs

`src/components/counter/**` is rewritten. The components become markup
emitters over ported CSS instead of Tailwind compositions. They get smaller,
not larger. The six-state contract, `SectionData`, the adapters, `format.ts`,
`date-range.ts`, `url-state.ts`, `prime-cost.ts` and the motion hooks are
unaffected — none of them is a stylesheet.

`npm run tokens` rule 1 ("no colour literal outside `counter.css`") widens to
"outside `src/styles/*.css`", because the ported component CSS is a stylesheet,
not a component. Rules 2–5 are untouched and matter more than before.

## The new rule, and how it is enforced

**A page is not done until it has been diffed against the prototype's own
render of that page.** `npm run tokens` cannot see a missing dispatch line or a
table that should be cards. So Task 2 builds a fidelity harness: it renders the
prototype's page and our route at the same viewport, extracts the element
inventory and computed styles for both, and reports what is missing, extra or
different. Every page ships with that report committed beside it, the way
`docs/counter/*-verification.md` already works.

## Phases, replacing §5 of the original spec

| # | Ships |
|---|---|
| **A** | The CSS port and the fidelity harness. No visual change yet. |
| **B** | Every primitive rebuilt as a faithful port: strip · figure · bullet · spark · section · table · queue · chart · cascade · head block · say · floor meter · dispatch · moving · ask bar · store cards · channel rows · gap bar · drill · rail · topbar · date control, plus the phone set (`mstrip`, `mlist`, `money`, `mtab`). |
| **C** | Pages, in the prototype's own order, each desk and phone, each with a committed fidelity report. Overview first — it is the page that proved the problem. |

Plan 8's Tasks 3–8 are withdrawn. `prime-cost.ts` (Task 2) and the URL's
custom ranges (Task 1) survive — both are correct and Phase C needs them. The
P&L is rebuilt in Phase C like every other page, from the prototype's own
`P.pnl.desk()` rather than from my description of it.

## What "pixel perfect" means where the data is fiction

The prototype's figures are invented: 142 guest reviews, "3 need you", "synced
12 min ago", a $4.12→$4.86 beef price. Matching those literally would mean
printing invented numbers on a real restaurant's dashboard.

So: **layout and behaviour match the prototype exactly; numbers come from the
database.** Every element is built in its real shape and wired to the real
query. Where a figure genuinely cannot be computed, the owed treatment lands
**in that cell**, in the cell's own shape — never as a grey box swallowing the
section that should have contained it. That is the one place this project
departs from the prototype, and it departs in the direction the prototype's own
notes already argue for.
