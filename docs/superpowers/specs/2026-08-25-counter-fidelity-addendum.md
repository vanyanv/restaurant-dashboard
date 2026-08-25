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

**A page is not done until Playwright has compared it against the prototype's
own render of that page, twice, and found nothing.**

`npm run tokens` cannot see a missing dispatch line or a table that should be
cards. Nothing in this repo could, which is why the gap survived seven plans
and a permanently green gate. So fidelity becomes a Playwright project, not a
script somebody remembers to run — `e2e/fidelity/`, reusing the authentication
and the two device profiles `playwright.config.ts` already defines.

For every page it runs **two independent passes**:

1. **Structure.** The ordered sequence of structural landmarks — dispatch,
   head block, strip, section, queue, store cards, channel rows, charts — must
   match the prototype's. Fails by naming every missing and every extra
   element. This is the pass that would have caught a table where note 33
   specifies cards.
2. **Rendering.** For every landmark present on both sides, the computed value
   of sixteen checked properties (`font-family`, `font-size`, `color`,
   `background-color`, `border-radius`, `grid-template-columns`, …) must
   agree.

**Light mode is compared against the prototype. Dark mode is not.** The
prototype's application tokens are declared light-only; dark mode is this
project's own design (brainstorm decision 8), and `counter.css` carries all 33
colours as `light-dark()` pairs. So the rendering pass compares our light
render to the prototype's, and asserts dark mode separately — for internal
consistency rather than against a reference that does not exist:

- every colour a landmark renders resolves through a `--ct-*` token, never a
  literal, so it actually changes with the theme;
- text keeps its contrast against whatever it sits on.

This distinction is not pedantry. The ported stylesheet carries 35 colour
literals inherited from the prototype, and at least 13 are solid `color:` or
`background:` declarations. `.qbtn[aria-pressed="true"]` sets its background to
`var(--ink)` — which themes to near-white in dark — while its `.n` child keeps
a hardcoded light grey, giving invisible text. A gate that compared dark mode
against the prototype would call that a perfect match, because the prototype
does exactly the same thing.

Two passes rather than one because they fail for different reasons and want
different fixes. "You did not build this element" and "you built it and it
looks wrong" collapse into a single unreadable failure otherwise.

Both passes run on both device projects: desktop at 1440×900 against the
prototype's `desk()` composition, and a Pixel 7 against its `phone()` one.

**Compared by structure, never by pixel.** The prototype's numbers are
invented and ours come from a real database, so an image diff is pure noise. A
missing `.dispatch` is signal. Text is therefore compared for *presence* only:
an element that should carry text and carries none is a defect; an element
carrying a different number is not.

**Inherited literals are fixed by the task that first emits their class.**
Not in one sweep. The task building `.qbtn` is the only one positioned to
choose the right token and see the result in both themes, and its own fidelity
run is what proves it. A page may not flip its manifest entry to `"counter"`
while any class it emits still resolves a colour to a literal.

**And the check is run twice.** Once while building, against the dev server;
once more after the final fix, against a cold `npm run build && npm run start`.
Dev-mode rendering has hidden fidelity defects on this project twice already —
the doubled navigation shell and the dead `border-ct-*` utilities both looked
correct until a production build.

`e2e/fidelity/manifest.ts` lists all 53 pages with a status. A page is
`"editorial"` — skipped, not failed — until its rebuild lands, and flips to
`"counter"` in the same commit that rebuilds it. That makes `npm run fidelity`
a live count of how much of the design is genuinely built, and makes it
impossible to call a page done without turning its own gate on.

**The harness is itself under test.** A comparison that finds nothing on either
side would report "no differences" and pass forever — a worse outcome than no
gate at all, because it would be believed. `compareLandmarks` is unit-tested
against hand-written fixtures, including the case where both sides are empty,
which throws rather than passing.

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
