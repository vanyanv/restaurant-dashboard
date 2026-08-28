# Menu profit — measured before anything is built

Probed 2026-08-28, trailing 30 days of `DailyCogsItem`.

## Most of this page is already built server-side

`getMenuEngineering` (`src/app/actions/forecasts/menu-engineering-actions.ts`)
already publishes everything the quadrant chart needs and nothing has to be
re-derived: `medianVelocity` and `medianUnitMargin` (the two splits),
`rows`, `counts: Record<MenuQuadrant, number>` for the four legend figures,
`totalContribution`, and a `coverage` block built for exactly the honesty
section the prototype draws.

The scatter's CSS is already in the generated sheet — 17 rules across `.mtx`,
`.mdot`, `.qbtn`, `.qlegend`, `.ql`, `.gl` — with **nothing rendering them**,
the same situation `.donut` was in before the COGS plan. The `askBars` used by
the honesty strip has rules too. So this page needs one new primitive and no
CSS.

## The honesty strip is about the WRONG THING here, and the right thing is worse

The prototype's section is "What these figures did not see": 6 unmapped items
carrying 7.1% of revenue, with *"an unmapped item costs $0 until a recipe is
mapped to it, so every margin on this page is optimistic by some part of that"*.

Measured, over 30 days:

| | revenue | share |
|---|---:|---:|
| costed (the classifier saw it) | $265,388 | **99.8%** |
| unmapped | **$62** | 0.02% |
| missing cost | $428 | 0.16% |
| **partial cost** — costed, but flagged an UNDERSTATEMENT | **$26,690** | **10.1%** |

**Coverage is 99.8%, not 92.9%.** The unmapped gap the prototype is worried
about barely exists here: sixty-two dollars.

**But 10.1% of costed revenue walks a recipe that reported at least one line
uncosted** (`DailyCogsItem.partialCost`). Those items are IN the quadrants and
their margins are optimistic — which is precisely the claim the prototype's
section makes, aimed at the wrong column. An owner reading "99.8% costed"
would conclude the page is trustworthy; the honest headline is that one dollar
in ten is understated.

**So the section keeps its shape and changes its subject.** It reports partial
cost, names the $26,690, and says what "partial" means — the recipe walked but
did not price every line. Unmapped and missing-cost stay in the bars because
they are real, just small.

This is the third time in this rebuild that a prototype section pointed at a
gap this account does not have while a bigger one sat beside it — Labor's SPLH
floor, COGS' waste, and now this.

## The two strip figures come from where every other page gets them

The prototype says so itself, in a comment: *"Revenue and food cost were
$141,200 and $44,340 — a whole month, under a header showing the selected
range. They are the same two figures every other page reads, from the same
place."*

So: Revenue is the statement's Total Sales and Food cost is the statement's
COGS line, exactly as the COGS page reads them (C-R1). Blended margin stays on
menu revenue and says so, as the Menu hub's does.

## Still to decide when the page is built

The prototype's "What to do about it" queue is three hand-written cards
(feature the milkshake, the 2 Slider Combo, jalapeño poppers). None of those
items exist here. The section has to be derived from the quadrant rows or
dropped — and derived is possible: a DOG with real volume, the thinnest combo,
the highest-margin low-volume item are all computable from `rows`. Decide it
against the data, not from the fixture.
