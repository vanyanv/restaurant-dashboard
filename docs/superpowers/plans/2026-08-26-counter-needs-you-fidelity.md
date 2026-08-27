# Counter — "Needs you" (Decisions + Alerts) Fidelity Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the two prototype pages that share the rail entry "Needs you" — `P.decisions` ("The week ahead") and `P.alerts` ("Open right now") — on both surfaces, matching `docs/counter/counter-prototype.html` landmark for landmark, and flip the fidelity gate on for all four.

**Architecture:** Two adapters under `src/lib/counter/adapters/` translate the two existing loaders (`getDecisionsView`, `getAlertInbox`) into `SectionData`. Four pages consume only their adapter. Four new presentational primitives cover the prototype classes that are already in the ported stylesheet but have no React component yet. One new shared module, `src/lib/counter/forecast-generation.ts`, owns the single most dangerous computation on the page.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7/Postgres, Vitest 4, RTL 16, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-23-counter-design-system-design.md`

**Prototype:** `docs/counter/counter-prototype.html` — `P.decisions` at line 4677, `P.alerts` at line 4771.

---

---

## Working mode — BUILD VELOCITY (set 2026-08-26, overrides the step structure below)

**Owner's decision: skip writing tests; build the product.**

Every task in this plan is written with a TDD cycle — write the failing test,
run it red, implement, run it green, mutate to prove it. **Those steps are now
optional and should be skipped by default.** Implement directly.

The test code is left in the plan text deliberately: it is a precise
specification of the intended behaviour, and it is the fastest reading of what
each piece must do. **Read it as the spec. Do not write it as a test.**

### What you still run before every commit

```
npx tsc --noEmit     types
npm run tokens       the design-system rules, which are build failures
npm run build        it compiles
npm run fidelity     Playwright against the prototype — the only check left
                     that looks at the rendered page
```

`npm test` still runs the EXISTING suite and must stay green — do not break what
is already there, and do not delete tests to make it pass.

### The one carve-out

**Money arithmetic keeps its assertions.** Pure functions that compute a figure
an owner reads — signs, ticket/fee/net, rates, totals, coverage ratios — get a
handful of plain assertions. Not a TDD cycle, not fixtures, not mocks: a few
`expect` lines on real values.

This is not principle, it is this codebase's measured failure mode. Three money
bugs this month were invisible to reading, to types and to review: discounts and
commissions stored NEGATIVE (0 of 40,055 rows matched the shape every fixture
used), one order printing two different tickets on one page, and promo ROI
returning an empty set in production because `d.discount > 0` is false for every
row. None crashed. None looked wrong.

### Where the risk now sits, stated once

Skipping tests moves the cost of a regression from "a red test in 40 seconds" to
"a wrong number on a page nobody checked". `npm run fidelity` catches structure
and appearance. **Nothing left catches a wrong figure that renders beautifully.**
That is the accepted trade, recorded here so it is a decision and not a surprise.

---

## Global Constraints

Every task's requirements implicitly include this section.

- `npm run tokens` enforces, on `src/app/dashboard/**`, `src/app/(mobile)/m/**`, `src/components/counter/**` and `src/lib/counter/**`: no colour literal outside `src/styles/counter.css`; no generic Tailwind palette colour; **no page branching on a `SectionData` status**; **no page importing Prisma or a server action directly** (`.tsx` only — an adapter in `src/lib/counter/` may and does import an action module); no page importing `framer-motion` directly.
- **A figure shown on two pages comes from ONE function in `src/lib/counter/`.** The linter cannot check this. It is the rule this plan is most exposed to, because the week's forecast total appears on the desk headline, the desk strip, the desk week picker and the phone strip.
- `Section` is the sole state renderer for `SectionData<T>`. Pages never read `.status`.
- **A gated Counter page can never render an empty section.** `Empty` renders a `.empty` landmark; the prototype has none; an EXTRA landmark is never forgivable by an absence allowance (ruling F-R8). Where our data is empty and the prototype's is not, the section must still render its own shell.
- `npm run tokens`, `npm test`, `npx tsc --noEmit` and `npm run build` all pass at the end of every task. **Playwright e2e sits OUTSIDE that gate** — a task that touches `e2e/` runs `npx playwright test e2e/` explicitly.
- Never `prisma migrate dev`. This plan introduces **no schema change at all**; if one appears necessary, that is a plan defect — stop and say so rather than reaching for `db push`.
- Commits must not carry a `Co-Authored-By: Claude` line.
- Don't split or restructure a file over 400 lines without reading `docs/refactor-playbook.md`.

---

## The data, measured before the plan was written

Every number below came from counting rows on 2026-08-26, not from reading the schema. Several prototype elements have no data behind them, and the plan's shape follows from that.

### Alerts — `Alert`, 87 rows

| Fact | Measured |
|---|---|
| Total rows | 87 |
| Sources present | `ANOMALY_EVENT` — **87 of 87** |
| Sources absent | `PRICE_DELTA`, `HARRI_VARIANCE`, `QUANTITY_SPIKE`, `NEW_PRODUCT` — **0 rows each** |
| Targets present | `MENU_ITEM` 82, `REVENUE` 5 |
| Targets absent | `INGREDIENT`, `LABOR`, `REFUNDS`, `PRICE`, `PRODUCT` — 0 each |
| Status | `OPEN` 77, `DISMISSED` 10, **`ACKNOWLEDGED` 0**, `EXPLAINED` 0 |
| Severity | `CRITICAL` 40, `WATCH` 46, `INFO` 1 |
| `body` non-null | **0 of 87** |
| `explanation` non-null | **0 of 87** |
| `metadata` non-null | 87 of 87 |
| Stores | Hollywood only — 87 of 87 |
| History | 2026-08-17 → 2026-08-26, **9 days** |
| Per-day opened | 08-17=10 08-18=5 08-21=22 08-22=11 08-23=10 08-24=9 08-25=11 08-26=9 (**no rows at all on 08-19 and 08-20**) |
| `acknowledgedAt` non-null | 10 — and all 10 are the `DISMISSED` rows |
| Time from `detectedAt` to `acknowledgedAt` | n=10, min 0.6 h, **median 1.8 h**, max 1.8 h |
| `AlertPreference` | **0 rows** |

Four consequences the tasks below are built around:

1. **The prototype's five source toggles have one live source.** `P.alerts` renders five and its own comment says "five is what gets stored — an alert is raised by an anomaly, a price move, a labour variance, a quantity spike or a new product, and nothing else." The schema does store five. The database holds one. Four toggles that can only ever return zero rows are not "a control present and inert" (note 46) — they are a control that lies about what it filters.
2. **"Acknowledged 12" cannot be printed.** No row has ever reached `ACKNOWLEDGED`. The 10 rows carrying an `acknowledgedAt` are `DISMISSED` — something on the write path stamps the timestamp without moving the status, so an "acknowledged" count sourced from `acknowledgedAt` would report dismissals as acknowledgements.
3. **"Median time to close 1.4 days ▼ 0.6 on last month" cannot be printed.** There is no last month: the table is 9 days old. The median that does exist is **1.8 hours**, not 1.4 days, and it describes dismissals.
4. **"Muted 2 · by rule" has no source.** `AlertPreference` is empty, so the `Muted` segment has nothing behind it.

### Decisions — the loaders are already rich, the ledger is empty

| Fact | Measured |
|---|---|
| `DecisionLog` | **0 rows** |
| `GrowthOpportunity` | 3,203 rows; 41 at the latest `asOfDate` (2026-08-26) |
| …by type at latest | `menu_engineering` 27, `reprice` 14 |
| `impactP25` null | 3,105 of 3,203 overall; **27 of 41 at the latest `asOfDate`** |
| …and the 27 nulls are | every `menu_engineering` row — i.e. the 6 largest raw impacts ($795, $747, $684, $615, $536, $421) |
| `reprice` raw impacts | $0, $1, $0, $3, $0, $35, $0, $0 — with `impactP25` of −1, −1, −0, −0 |
| `DecisionVerdict` | 5 rows, newest 2026-08-24 (**2 days stale**), `scopeKey` `ALL` only, model `gpt-4.1-mini` |
| `MlForecastEvaluation` | 331 rows, carrying `intervalCoverage80`, `sampleSize`, `modelVersion`, `horizonDay` |
| `HarriShift` | 3,800 rows, 2025-07-28 → 2026-08-30; **47 on or after today** |
| `ForecastDailyRevenue` | 1,442 rows, 2026-05-09 → 2026-09-08 |
| `horizonDay` populated | **70 of 1,442** — null on 1,372 |

### The forecast has many generations per day, and the dedupe is worth 12.7×

`ForecastDailyRevenue` holds one row per (store, date, **model generation**). Measured over `hourBucket: 0`, 2026-08-26 → 2026-09-08:

```
2026-08-26: 16 rows   newest $6,269   spread $5,654–$6,771
2026-08-27: 15 rows   newest $6,456   spread $5,949–$7,054
2026-08-28: 14 rows   newest $7,312   spread $6,736–$8,113
2026-08-29: 13 rows   newest $8,451   spread $7,820–$9,004
2026-08-30: 12 rows   newest $8,796   spread $8,052–$10,098
2026-08-31: 11 rows   newest $6,963   spread $5,847–$6,963
2026-09-01: 10 rows   newest $6,506   spread $6,166–$7,117
...                    16 distinct generations in the window
```

The seven-day total, three ways:

```
newest generation per day   $50,754     <- correct
oldest generation per day   $47,164
every row, no dedupe       $646,442     <- 12.7x, and it looks like a number
```

`$646,442` is the failure this page is one missing `.sort()` away from. It is not a crash and not an obviously silly figure on a page whose other numbers are five digits — it is the same failure mode as the orders ticket bug, at a larger scale.

The existing `freezeForecast` in `decision-log-actions.ts` dedupes correctly, and its `take: FREEZE_HORIZON_DAYS * 4` cap was checked against the real distribution: **the cap starves no date**, because the newest generation writes all 14 dates at one `generatedAt`. That is a property of the current nightly, not of the query. Task 3 makes it explicit and tested rather than incidental.

**`horizonDay` is null on 95% of rows.** Any query that filters on it returns almost nothing. Do not add one.

---

## File Structure

**Create**

| Path | Responsibility |
|---|---|
| `src/lib/counter/forecast-generation.ts` | `newestGenerationPerDay()` — the one function that turns many generations into one series. Pure; takes rows, returns rows. |
| `src/components/counter/surface/briefing.tsx` | `Briefing` / `BriefingLine` — `.briefline` (numbered lead, prose, right-hand figure). |
| `src/components/counter/surface/dots.tsx` | `Dots` — `.dots`, the 4-slot confidence meter. |
| `src/components/counter/surface/tag.tsx` | `Tag` (`.mtag`) and `StatusPill` (`.statuspill`). |
| `src/components/counter/surface/week-picker.tsx` | `WeekPicker` — `.wk` / `.wkd`, forecast-vs-actual day cells, one selected. |
| `src/components/counter/surface/record.tsx` | `Record` — `.record`, the hit/miss run used by the accuracy panel. |
| `src/lib/counter/adapters/decisions.ts` | `getDecisionsSections()` |
| `src/lib/counter/adapters/alerts.ts` | `getAlertsSections()` |
| `src/app/dashboard/(counter)/decisions/page.tsx` + `counter-decisions-client.tsx` + `loading.tsx` | Desk — the week ahead |
| `src/app/(mobile)/m/(counter)/decisions/page.tsx` + `counter-phone-decisions-client.tsx` + `loading.tsx` | Phone — the week ahead |
| `src/app/dashboard/(counter)/alerts/page.tsx` + `counter-alerts-client.tsx` + `loading.tsx` | Desk — open right now |
| `src/app/(mobile)/m/(counter)/alerts/page.tsx` + `counter-phone-alerts-client.tsx` + `loading.tsx` | Phone — open right now |
| `docs/counter/fidelity/decisions.md`, `docs/counter/fidelity/alerts.md` | Gate reports |

**Modify**

| Path | Change |
|---|---|
| `src/components/counter/index.ts` | Export the five new primitives. |
| `src/middleware.ts` | Add `/dashboard/decisions` → `/m/decisions` and `/dashboard/alerts` → `/m/alerts` to the phone rewrite map. Unaffected by the route-group rewrite below — `MOBILE_ROUTES` maps URL paths, and `(counter)` never appears in a URL. |
| `scripts/counter-lint.ts` | `AWAITED_SECTIONS_ALLOWED` gains the four new page paths (Tasks 5, 6, 8, 9) — each of those four is a single-load page in the order-detail shape, not the streaming-pages shape. See Task 5's rewrite note. |
| `e2e/fidelity/manifest.ts` | Flip `decisions` and `alerts` to `status: "counter"` with measured baselines. |
| `src/app/actions/alerts/inbox-actions.ts` | Add the lifecycle counts the page needs (Task 7) — no behaviour change to existing callers. |

**Delete** (at the task that replaces each, exactly as the orders pages did)

- `src/app/dashboard/(editorial)/decisions/**` — 10 components, 13 lib modules, `decisions.css`
- `src/app/dashboard/(editorial)/alerts/**`

**Do not touch**

- `src/app/actions/decisions/get-decisions-view.ts` (917 lines) — it is the loader, it is correct, and it is over 400 lines. Read it; do not restructure it.

---

## Rulings made before execution

These settle the conflicts the measurements above surface. Each is recorded here so a reviewer can reject the ruling rather than rediscover the conflict.

**N-R1 — Four dead source toggles are rendered, labelled with their true count, and not silently empty.**
The prototype's five toggles stay, because the schema does store five sources and the page is a filter over that schema. But each toggle carries its live row count from the same query that fills the table, so a source with no rows reads `Price moves 0` rather than looking like a filter that might do something. A toggle at zero is rendered disabled. *Cost if wrong:* the page shows four zeroes an owner does not care about; the alternative — hiding them — makes four landmarks vanish and needs an absence allowance that goes stale the day the first price alert lands.

**N-R2 — "Acknowledged" is sourced from `status = ACKNOWLEDGED`, and it will read 0.**
Not from `acknowledgedAt`, which is stamped on dismissals. The strip cell reads `Acknowledged · 0 · none yet`. *Cost if wrong:* a strip cell showing zero looks like a bug; sourcing it from `acknowledgedAt` would instead report 10 dismissals as acknowledgements, which is the worse error and the one already in the data.

**N-R3 — The prototype's "▼ 0.6 on last month" delta is not rendered on the time-to-close cell.**
There is no last month. The cell shows the median that exists — over dismissals, labelled as such — with no comparison. This is prototype note 39's rule applied in reverse: a delta is the difference between two things we have, and we have one. *Cost if wrong:* one strip cell has no delta where the prototype has one. `.blt`/`.band`/`.sp` are the landmarks a strip cell can owe and the prototype passes no reference here either, so this costs no landmark.

**N-R4 — The "Muted" segment renders with an empty table shell, not an `Empty`.**
`AlertPreference` has no rows, so the muted list is empty. A `.tbl` with a header and no body rows carries the same landmarks as one with rows (`tbl` is a landmark; `tr` is not). The `Empty` state is forbidden here by the standing constraint. *Cost if wrong:* an owner sees an empty table instead of a sentence explaining why. Recorded as a Phase F follow-up.

**N-R5 — "What you decided" renders its table shell over zero rows, for the same reason.**
`DecisionLog` is empty. The section renders `.sec` / `.sec__head` / `.sec__body` / `.tbl` and no rows, which is landmark-identical to the prototype's four-row table. *Cost if wrong:* same as N-R4. This one resolves itself the first time an owner commits a decision.

**N-R6 — The desk queue renders the prototype's three items, not the loader's five.**
`buildActionCards` ranks and caps at 5; `P.decisions` renders 3 and its section head says "3 open". `qitem` IS a landmark, so five items against three is two EXTRA landmarks and a red gate. The head reports the true open count (`3 of 41`), so the cap is visible rather than hidden. *Cost if wrong:* two ranked opportunities are one click away instead of on the page.

**N-R7 — The ranking defect is reported, not fixed, in this plan.**
`buildActionCards` scores on `impactP25` where present and on `estimatedDollarImpact × confidenceWeight` where not. At the latest `asOfDate` that means the 14 `reprice` rows are scored on a measured downside of about −$1 to $18, while the 27 `menu_engineering` rows — every one of the six largest — are scored on a confidence-weighted raw figure. The two branches are not on the same scale, so the comparison between them is not meaningful. **This is a real defect in a file this plan does not own.** Task 4 writes a characterisation test that pins today's ordering so the defect is visible and any future fix is deliberate; it does not change the ranking. *Cost if wrong:* the queue's order is arguably wrong on a page we are gating, and we gate it anyway. Fixing a 917-line loader's ranking mid-rebuild is a bigger change than this plan should make, and it needs its own before/after measurement.

**N-R8 — Both pages stay owner-gated on the alerts side and open on the decisions side, matching today.**
`getAlertInbox` already requires `hasOwnerAccess`; `getDecisionsView` does not. Do not change either. *Cost if wrong:* a manager sees the week ahead and not the alert inbox, which is the behaviour that ships today.


**N-R13 — the decisions adapter returns a promise PER SECTION, even though one
loader resolves them all today.**

Task 5/6's rewrite proposed a single justified `await`, on the reasoning that
`getDecisionsView` is one loader returning one value — the same argument that
earned the order-detail routes their exemption (S-R5). That argument is true of
`getAlertInbox`, which really is one `findMany` plus a `groupBy`. **It is not
true of `getDecisionsView`, which runs NINE independent queries across nine
tables in a single `Promise.all`:**

```
storeWeatherSignal   storeEventSignal      harriShift
forecastHourlyOrders otterHourlySummary    forecastDailyRevenue
decisionLog          otterDailySummary     mlForecastEvaluation
```

Those feed genuinely different sections. The accuracy scorecard comes from
`mlForecastEvaluation`; the ledger from `decisionLog`; the week picker from
`forecastDailyRevenue`; the labor gap from `harriShift` + `forecastHourlyOrders`.
A single `await` makes the scorecard wait on the weather signals.

*Ruling:* the adapter exposes a promise per section — derived from ONE shared
`getDecisionsView()` promise for now, so nothing resolves faster today and no
query is duplicated. **The point is the page's shape, not today's timing.** When
`getDecisionsView` is later decomposed into per-concern loaders, the sections
begin streaming for free and **the page does not change**. A single `await`
would make that later decomposition a page rewrite as well as a loader one.

`getAlertInbox` keeps its single `await` and its named exemption in
`AWAITED_SECTIONS_ALLOWED` — one query is one query.

*Cost if wrong:* the decisions adapter carries a promise-per-section API that
buys nothing until the loader is split. That is a shape, not a cost.

---

## Task 1: The four flat primitives

**Files:**
- Create: `src/components/counter/surface/briefing.tsx`, `src/components/counter/surface/dots.tsx`, `src/components/counter/surface/tag.tsx`
- Modify: `src/components/counter/index.ts`
- Test: `tests/components/counter-briefing.test.tsx`, `tests/components/counter-dots.test.tsx`, `tests/components/counter-tag.test.tsx`

**Interfaces:**
- Produces: `Briefing`, `type BriefingLine`, `Dots`, `Tag`, `StatusPill` — consumed by Tasks 4, 5, 6, 7, 8, 9.

The CSS for all three is already in `src/styles/counter-components.css` (`.briefline` ×6 rules, `.dots` ×3, `.mtag` ×6, `.statuspill` ×4). **That file is GENERATED — do not edit it.** These tasks add React, not styles.

Prototype markup to match exactly:

```html
<!-- .briefline, P.decisions line ~4697 -->
<div class="briefline"><span class="g">1</span><p><b>Saturday is eleven hours short.</b> …</p><span class="n">$6,480</span></div>

<!-- .dots, inside a queue item's body -->
<span class="dots"><i class="on"></i><i class="on"></i><i class="on"></i><i></i></span>

<!-- .mtag -->
<span class="mtag good">Holding</span>   <span class="mtag bad">Open</span>   <span class="mtag warn">Watching</span>   <span class="mtag">Acknowledged</span>

<!-- .statuspill, alerts severity column -->
<span class="statuspill REJECTED">Critical</span>  <span class="statuspill REVIEW">Warning</span>  <span class="statuspill APPROVED">Info</span>
```

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/counter-dots.test.tsx
import { render } from "@testing-library/react"
import { Dots } from "@/components/counter"

describe("Dots", () => {
  it("always renders four slots, filling the first n", () => {
    const { container } = render(<Dots filled={3} />)
    const all = container.querySelectorAll(".dots i")
    expect(all).toHaveLength(4)
    expect(container.querySelectorAll(".dots i.on")).toHaveLength(3)
  })

  // A confidence meter that renders three slots at low confidence and four at
  // high is a meter whose LENGTH encodes the value twice. The prototype always
  // draws four.
  it("renders four slots at zero", () => {
    const { container } = render(<Dots filled={0} />)
    expect(container.querySelectorAll(".dots i")).toHaveLength(4)
    expect(container.querySelectorAll(".dots i.on")).toHaveLength(0)
  })

  it("clamps out-of-range input rather than rendering a fifth slot", () => {
    const { container } = render(<Dots filled={9} />)
    expect(container.querySelectorAll(".dots i")).toHaveLength(4)
    expect(container.querySelectorAll(".dots i.on")).toHaveLength(4)
  })
})
```

```tsx
// tests/components/counter-briefing.test.tsx
import { render, screen } from "@testing-library/react"
import { Briefing } from "@/components/counter"

const LINES = [
  { key: "labor", lead: <b>Saturday is eleven hours short.</b>, body: " The forecast wants 214 orders.", figure: "$6,480" },
  { key: "beef", lead: <b>Beef is still climbing.</b>, body: " $4.86 a pound.", figure: "−$116" },
]

describe("Briefing", () => {
  it("numbers the lines from one, in order", () => {
    const { container } = render(<Briefing lines={LINES} />)
    const gutters = [...container.querySelectorAll(".briefline .g")].map((e) => e.textContent)
    expect(gutters).toEqual(["1", "2"])
  })

  it("renders one .briefline per line with its figure", () => {
    const { container } = render(<Briefing lines={LINES} />)
    expect(container.querySelectorAll(".briefline")).toHaveLength(2)
    expect(screen.getByText("$6,480")).toHaveClass("n")
  })

  // A briefing line with no figure still numbers correctly — the gutter is the
  // position in the list, not a count of lines that happen to carry a number.
  it("keeps numbering when a line carries no figure", () => {
    const { container } = render(
      <Briefing lines={[{ key: "a", lead: <b>A</b>, body: "", figure: null }, LINES[0]]} />,
    )
    expect([...container.querySelectorAll(".briefline .g")].map((e) => e.textContent)).toEqual(["1", "2"])
    expect(container.querySelectorAll(".briefline .n")).toHaveLength(1)
  })
})
```

```tsx
// tests/components/counter-tag.test.tsx
import { render } from "@testing-library/react"
import { Tag, StatusPill } from "@/components/counter"

describe("Tag", () => {
  it.each([
    ["good", "mtag good"],
    ["bad", "mtag bad"],
    ["warn", "mtag warn"],
  ])("renders tone %s as %s", (tone, expected) => {
    const { container } = render(<Tag tone={tone as "good" | "bad" | "warn"}>Holding</Tag>)
    expect(container.firstElementChild?.className).toBe(expected)
  })

  it("renders a toneless tag as a bare .mtag", () => {
    const { container } = render(<Tag>Acknowledged</Tag>)
    expect(container.firstElementChild?.className).toBe("mtag")
  })
})

describe("StatusPill", () => {
  // The prototype reuses the invoice pill classes for alert severity. The map
  // is CRITICAL->REJECTED, WATCH->REVIEW, INFO->APPROVED, and it is not
  // guessable from the names — assert it.
  it.each([
    ["CRITICAL", "Critical", "statuspill REJECTED"],
    ["WATCH", "Warning", "statuspill REVIEW"],
    ["INFO", "Info", "statuspill APPROVED"],
  ])("renders %s as %s", (severity, label, expected) => {
    const { container } = render(<StatusPill severity={severity as "CRITICAL" | "WATCH" | "INFO"} />)
    expect(container.firstElementChild?.className).toBe(expected)
    expect(container.firstElementChild?.textContent).toBe(label)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/components/counter-dots.test.tsx tests/components/counter-briefing.test.tsx tests/components/counter-tag.test.tsx`
Expected: FAIL — `Dots`, `Briefing`, `Tag`, `StatusPill` are not exported from `@/components/counter`.

- [ ] **Step 3: Implement**

```tsx
// src/components/counter/surface/dots.tsx
/**
 * The four-slot confidence meter, `.dots`.
 *
 * Four slots always. A meter whose length changed with its value would encode
 * the value twice and read as three-of-three at low confidence.
 */
export function Dots({ filled }: { filled: number }) {
  const on = Math.max(0, Math.min(4, Math.round(filled)))
  return (
    <span className="dots">
      {[0, 1, 2, 3].map((i) => (
        <i key={i} className={i < on ? "on" : undefined} />
      ))}
    </span>
  )
}
```

```tsx
// src/components/counter/surface/briefing.tsx
import type { ReactNode } from "react"

export type BriefingLine = {
  key: string
  /** The bolded first clause — what the line is about. */
  lead: ReactNode
  /** The rest of the sentence. */
  body: ReactNode
  /** The right-hand figure, or null when the line has no number to show. */
  figure: string | null
}

/**
 * `.briefline` — the numbered week briefing.
 *
 * The gutter number is the line's POSITION, taken from the array, never a
 * counter that skips lines without figures.
 */
export function Briefing({ lines }: { lines: BriefingLine[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div className="briefline" key={l.key}>
          <span className="g">{i + 1}</span>
          <p>
            {l.lead}
            {l.body}
          </p>
          {l.figure === null ? null : <span className="n">{l.figure}</span>}
        </div>
      ))}
    </>
  )
}
```

```tsx
// src/components/counter/surface/tag.tsx
import type { ReactNode } from "react"

export type TagTone = "good" | "bad" | "warn"

/** `.mtag` — a small status word. A toneless tag is the neutral grey one. */
export function Tag({ tone, children }: { tone?: TagTone; children: ReactNode }) {
  return <span className={tone ? `mtag ${tone}` : "mtag"}>{children}</span>
}

export type PillSeverity = "CRITICAL" | "WATCH" | "INFO"

/**
 * `.statuspill` — alert severity.
 *
 * The prototype reuses the invoice-status pill classes, so the class name and
 * the word do not match: CRITICAL wears REJECTED, WATCH wears REVIEW and INFO
 * wears APPROVED. That is the prototype's palette decision, not a mistake, and
 * the map lives here so no page repeats it.
 */
const PILL: Record<PillSeverity, { cls: string; label: string }> = {
  CRITICAL: { cls: "REJECTED", label: "Critical" },
  WATCH: { cls: "REVIEW", label: "Warning" },
  INFO: { cls: "APPROVED", label: "Info" },
}

export function StatusPill({ severity }: { severity: PillSeverity }) {
  const { cls, label } = PILL[severity]
  return <span className={`statuspill ${cls}`}>{label}</span>
}
```

Append to `src/components/counter/index.ts`:

```ts
export { Briefing, type BriefingLine } from "./surface/briefing"
export { Dots } from "./surface/dots"
export { Tag, StatusPill, type TagTone, type PillSeverity } from "./surface/tag"
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/components/counter-dots.test.tsx tests/components/counter-briefing.test.tsx tests/components/counter-tag.test.tsx`
Expected: PASS.

- [ ] **Step 5: Whole-project gate, then commit**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
git add src/components/counter tests/components
git commit -m "feat(counter): the briefing line, the confidence dots and the two tags"
```

---

## Task 2: The week picker and the record strip

**Files:**
- Create: `src/components/counter/surface/week-picker.tsx`, `src/components/counter/surface/record.tsx`
- Modify: `src/components/counter/index.ts`
- Test: `tests/components/counter-week-picker.test.tsx`, `tests/components/counter-record.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `WeekPicker`, `type WeekDay`, `Record`, `type RecordMark` — consumed by Tasks 4 and 5.

`.wk` and `.wkd` are already styled (1 and 14 rules). Prototype markup, `P.decisions` line ~4710:

```html
<div class="wk">
  <div class="wkd is-hit is-sel" data-day-pick="Sat 29">
    <span class="dn">Sat 29</span>
    <span class="fv">$8,451</span>
    <span class="av">actual $8,300</span>   <!-- or "forecast" when the day is still ahead -->
    <span class="bar"><i style="width:98%"></i></span>
  </div>
  …
</div>
```

`is-hit` when actual ≥ forecast × 0.97; `is-miss` when an actual exists and falls short; **neither class when the day has no actual yet**. The bar's width is `actual / forecast` clamped to 100, and **0 when there is no actual**.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/counter-week-picker.test.tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { WeekPicker } from "@/components/counter"

const WEEK = [
  { key: "2026-08-24", label: "Mon 24", forecast: 6609, actual: 7522 },
  { key: "2026-08-25", label: "Tue 25", forecast: 6200, actual: 5800 },
  { key: "2026-08-26", label: "Wed 26", forecast: 6269, actual: null },
]

describe("WeekPicker", () => {
  it("renders one .wkd per day inside a single .wk", () => {
    const { container } = render(<WeekPicker days={WEEK} selected="2026-08-26" onSelect={() => {}} />)
    expect(container.querySelectorAll(".wk")).toHaveLength(1)
    expect(container.querySelectorAll(".wkd")).toHaveLength(3)
  })

  it("marks a day that beat 97% of forecast as a hit, and one that missed as a miss", () => {
    const { container } = render(<WeekPicker days={WEEK} selected="2026-08-26" onSelect={() => {}} />)
    const cells = container.querySelectorAll(".wkd")
    expect(cells[0].className).toContain("is-hit")
    expect(cells[1].className).toContain("is-miss")
  })

  // The day still ahead is the one this is really about. A day with no actual
  // is neither a hit nor a miss, and calling it a miss would paint every
  // future day red every morning.
  it("leaves a day with no actual unmarked, and labels it forecast", () => {
    const { container } = render(<WeekPicker days={WEEK} selected="2026-08-24" onSelect={() => {}} />)
    const wed = container.querySelectorAll(".wkd")[2]
    expect(wed.className).not.toContain("is-hit")
    expect(wed.className).not.toContain("is-miss")
    expect(wed.querySelector(".av")?.textContent).toBe("forecast")
    expect(wed.querySelector(".bar i")?.getAttribute("style")).toContain("width:0%")
  })

  it("marks exactly one day selected", () => {
    const { container } = render(<WeekPicker days={WEEK} selected="2026-08-25" onSelect={() => {}} />)
    const sel = container.querySelectorAll(".wkd.is-sel")
    expect(sel).toHaveLength(1)
    expect(sel[0].querySelector(".dn")?.textContent).toBe("Tue 25")
  })

  it("reports the day key that was pressed", async () => {
    const onSelect = vi.fn()
    render(<WeekPicker days={WEEK} selected="2026-08-24" onSelect={onSelect} />)
    await userEvent.click(screen.getByRole("button", { name: /Tue 25/ }))
    expect(onSelect).toHaveBeenCalledWith("2026-08-25")
  })

  // A bar wider than its track reads as "beat forecast by a lot" no matter how
  // far past 100 it goes, and overflows the cell.
  it("clamps the bar at 100%", () => {
    const { container } = render(
      <WeekPicker days={[{ key: "d", label: "Sat", forecast: 100, actual: 400 }]} selected="d" onSelect={() => {}} />,
    )
    expect(container.querySelector(".bar i")?.getAttribute("style")).toContain("width:100%")
  })

  // Guarding the division, not the display: a zero forecast is a real state
  // for a store that is not trading yet.
  it("does not divide by a zero forecast", () => {
    const { container } = render(
      <WeekPicker days={[{ key: "d", label: "Sat", forecast: 0, actual: 500 }]} selected="d" onSelect={() => {}} />,
    )
    expect(container.querySelector(".bar i")?.getAttribute("style")).toContain("width:0%")
  })
})
```

```tsx
// tests/components/counter-record.test.tsx
import { render } from "@testing-library/react"
import { Record } from "@/components/counter"

describe("Record", () => {
  it("renders one mark per day, in order, tagged hit or miss", () => {
    const { container } = render(<Record marks={["hit", "hit", "miss", "hit"]} />)
    const marks = container.querySelectorAll(".record i")
    expect(marks).toHaveLength(4)
    expect([...marks].map((m) => m.className)).toEqual(["hit", "hit", "miss", "hit"])
  })

  it("renders an empty record without crashing", () => {
    const { container } = render(<Record marks={[]} />)
    expect(container.querySelectorAll(".record")).toHaveLength(1)
    expect(container.querySelectorAll(".record i")).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/components/counter-week-picker.test.tsx tests/components/counter-record.test.tsx`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

```tsx
// src/components/counter/surface/week-picker.tsx
"use client"

export type WeekDay = {
  /** Stable id — an ISO day. What `onSelect` reports. */
  key: string
  /** What the cell prints: "Sat 29". */
  label: string
  forecast: number
  /** null while the day is still ahead. NOT zero — zero is a real revenue. */
  actual: number | null
}

/**
 * `.wk` / `.wkd` — the week read as forecast against actual, one cell a day.
 *
 * A day with no actual is neither a hit nor a miss. Treating a null actual as
 * zero would paint every day of the coming week as a miss, which is the state
 * the page is in for four days out of seven.
 */
export function WeekPicker({
  days,
  selected,
  onSelect,
}: {
  days: WeekDay[]
  selected: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="wk">
      {days.map((d) => {
        const settled = d.actual !== null
        const pct =
          settled && d.forecast > 0
            ? Math.min(100, Math.round((d.actual! / d.forecast) * 100))
            : 0
        const outcome = settled ? (d.actual! >= d.forecast * 0.97 ? " is-hit" : " is-miss") : ""
        return (
          <button
            type="button"
            className={`wkd${outcome}${d.key === selected ? " is-sel" : ""}`}
            key={d.key}
            onClick={() => onSelect(d.key)}
            aria-pressed={d.key === selected}
          >
            <span className="dn">{d.label}</span>
            <span className="fv">{money(d.forecast)}</span>
            <span className="av">{settled ? `actual ${money(d.actual!)}` : "forecast"}</span>
            <span className="bar">
              <i style={{ width: `${pct}%` }} />
            </span>
          </button>
        )
      })}
    </div>
  )
}
```

Import `money` from `@/lib/counter/format` — do NOT write a second currency formatter.

```tsx
// src/components/counter/surface/record.tsx
export type RecordMark = "hit" | "miss"

/**
 * `.record` — the forecast's run of days, one mark each, oldest first.
 *
 * Deliberately not a chart: the question it answers is "how often", and thirty
 * marks answer it faster than thirty bars.
 */
export function Record({ marks }: { marks: RecordMark[] }) {
  return (
    <div className="record">
      {marks.map((m, i) => (
        <i className={m} key={i} />
      ))}
    </div>
  )
}
```

Append to `src/components/counter/index.ts`:

```ts
export { WeekPicker, type WeekDay } from "./surface/week-picker"
export { Record, type RecordMark } from "./surface/record"
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/components/counter-week-picker.test.tsx tests/components/counter-record.test.tsx`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
git add src/components/counter tests/components
git commit -m "feat(counter): the week read as forecast against actual"
```

---

## Task 3: One generation per day

**Files:**
- Create: `src/lib/counter/forecast-generation.ts`
- Test: `tests/lib/counter-forecast-generation.test.ts`

**Interfaces:**
- Produces: `newestGenerationPerDay<T>(rows: T[]): T[]` — consumed by Task 4.

This is the page's `order-signs.ts`. `ForecastDailyRevenue` holds one row per (store, date, model generation); the window this page reads held **121 rows across 14 dates, 16 distinct generations**. Summing without deduplicating produces **$646,442** where the answer is **$50,754**.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/counter-forecast-generation.test.ts
import { newestGenerationPerDay } from "@/lib/counter/forecast-generation"

const row = (date: string, gen: string, predicted: number, storeId = "s1") => ({
  storeId,
  forecastDate: new Date(`${date}T00:00:00Z`),
  generatedAt: new Date(gen),
  predictedRevenue: predicted,
})

describe("newestGenerationPerDay", () => {
  it("keeps one row per store-day — the newest generation", () => {
    const out = newestGenerationPerDay([
      row("2026-08-26", "2026-08-24T10:42:00Z", 6238),
      row("2026-08-26", "2026-08-26T10:41:00Z", 6269),
      row("2026-08-26", "2026-08-25T10:39:00Z", 6301),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].predictedRevenue).toBe(6269)
  })

  /*
   * The measurement this function exists for. Sixteen generations wrote the
   * same fortnight; the seven-day total is $50,754 deduped and $646,442 raw.
   * A test that only checked "returns fewer rows" would pass against a
   * function that dropped the wrong ones.
   */
  it("turns many generations into the newest one's total, not their sum", () => {
    const rows = []
    for (let day = 26; day <= 30; day++) {
      for (let g = 0; g < 12; g++) {
        rows.push(
          row(
            `2026-08-${day}`,
            `2026-08-${String(14 + g).padStart(2, "0")}T10:00:00Z`,
            1000 + g, // the newest generation is g=11 -> 1011
          ),
        )
      }
    }
    const total = newestGenerationPerDay(rows).reduce((a, r) => a + r.predictedRevenue, 0)
    expect(total).toBe(5 * 1011)
    // and emphatically not the raw sum
    expect(rows.reduce((a, r) => a + r.predictedRevenue, 0)).toBe(5 * 12 * 1000 + 5 * 66)
  })

  it("does not merge two stores on the same day", () => {
    const out = newestGenerationPerDay([
      row("2026-08-26", "2026-08-26T10:41:00Z", 6269, "hollywood"),
      row("2026-08-26", "2026-08-26T10:41:00Z", 40, "glendale"),
    ])
    expect(out).toHaveLength(2)
    expect(out.reduce((a, r) => a + r.predictedRevenue, 0)).toBe(6309)
  })

  // Rows arrive from Prisma in whatever order the caller asked for. The
  // function must not depend on that — a caller who forgets `orderBy` gets the
  // same answer, or this is just an assertion about the query.
  it("does not depend on input order", () => {
    const a = row("2026-08-26", "2026-08-26T10:41:00Z", 6269)
    const b = row("2026-08-26", "2026-08-20T10:41:00Z", 5900)
    expect(newestGenerationPerDay([a, b])[0].predictedRevenue).toBe(6269)
    expect(newestGenerationPerDay([b, a])[0].predictedRevenue).toBe(6269)
  })

  it("returns days in ascending date order whatever it was given", () => {
    const out = newestGenerationPerDay([
      row("2026-08-28", "2026-08-26T10:41:00Z", 7312),
      row("2026-08-26", "2026-08-26T10:41:00Z", 6269),
      row("2026-08-27", "2026-08-26T10:41:00Z", 6456),
    ])
    expect(out.map((r) => r.predictedRevenue)).toEqual([6269, 6456, 7312])
  })

  it("returns an empty array unchanged", () => {
    expect(newestGenerationPerDay([])).toEqual([])
  })

  // Two rows written in the same millisecond is not hypothetical — the nightly
  // writes a whole fortnight at one `generatedAt`. Within one store-day it
  // should still collapse to one row rather than returning both.
  it("collapses a tie to a single row", () => {
    const out = newestGenerationPerDay([
      row("2026-08-26", "2026-08-26T10:41:00Z", 6269),
      row("2026-08-26", "2026-08-26T10:41:00Z", 6270),
    ])
    expect(out).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/lib/counter-forecast-generation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/counter/forecast-generation.ts

/**
 * One forecast per store per day, from a table that keeps every generation.
 *
 * `ForecastDailyRevenue` is append-only across model generations: the nightly
 * writes the whole forward window each run and never deletes the last one. On
 * 2026-08-26 the fourteen-day window held 121 rows from 16 distinct
 * generations — sixteen for the nearest day, one for the furthest.
 *
 * So a `findMany` over a date range does NOT return a series. It returns a
 * series per generation, interleaved, and summing it is wrong by whatever
 * number of generations happen to be on file:
 *
 *     newest generation per day   $50,754     <- the week's forecast
 *     every row, no dedupe       $646,442     <- 12.7x, and five digits either way
 *
 * That is the whole reason this function exists rather than an `orderBy` in
 * each caller. The failure has no symptom: it is not a crash, and on a page
 * whose other figures are five digits it is not obviously silly.
 *
 * Newest wins, keyed on (storeId, forecastDate). Output is sorted by date
 * ascending so a caller can chart it directly.
 */
export function newestGenerationPerDay<
  T extends { storeId: string; forecastDate: Date; generatedAt: Date },
>(rows: T[]): T[] {
  const best = new Map<string, T>()
  for (const r of rows) {
    const key = `${r.storeId}|${r.forecastDate.toISOString().slice(0, 10)}`
    const held = best.get(key)
    // `>=` rather than `>`: on a tie the later row in the input wins, which
    // keeps the function total. `>` would leave the earlier one, which is just
    // as arbitrary but reads as if a rule were being applied.
    if (held === undefined || r.generatedAt.getTime() >= held.generatedAt.getTime()) {
      best.set(key, r)
    }
  }
  return [...best.values()].sort(
    (a, b) => a.forecastDate.getTime() - b.forecastDate.getTime(),
  )
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/lib/counter-forecast-generation.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Prove the dedupe is load-bearing**

Delete the `Map` and return `rows` sorted. Re-run. The second test must fail with a total of `60,330` against an expected `5,055`. **Restore the implementation.** Record the observed failure message in the task report — a test that passes before the fix is not a test.

- [ ] **Step 6: Gate and commit**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
git add src/lib/counter/forecast-generation.ts tests/lib/counter-forecast-generation.test.ts
git commit -m "feat(counter): one forecast per day, from a table that keeps every generation"
```

---

## Task 4: The decisions adapter

**Files:**
- Create: `src/lib/counter/adapters/decisions.ts`
- Test: `tests/lib/counter-adapter-decisions.test.ts`

**Interfaces:**
- Consumes: `newestGenerationPerDay` (Task 3); `getDecisionsView`, `type DecisionsView`, `DecisionDay`, `DecisionAction`, `DecisionRecord` from `@/app/actions/decisions/get-decisions-view`; `Briefing`/`BriefingLine`, `Dots`, `Tag`, `WeekPicker`/`WeekDay`, `Record`/`RecordMark` (Tasks 1-2).
- Produces: `getDecisionsSections(input: { storeId?: string }): Promise<DecisionsSections>` — consumed by Tasks 5 and 6.

Read `src/app/actions/decisions/get-decisions-view.ts` before writing anything. It is 917 lines, it already computes almost everything this page needs, and **it is not yours to restructure** (over 400 lines; see the refactor playbook rule). The adapter translates; it does not recompute.

`DecisionsSections` mirrors the prototype's sections, each a `SectionData`:

```ts
export interface DecisionsSections {
  head: SectionData<DecisionsHead>       // headline figure + verdict sentence + the one action
  strip: SectionData<StripCell[]>        // four cells
  briefing: SectionData<BriefingLine[]>  // the numbered week briefing
  week: SectionData<WeekDay[]>           // the day picker
  day: SectionData<DayDetail>            // "<day> in detail" — math lines
  accuracy: SectionData<Accuracy>        // "How well we have been calling it"
  ledger: SectionData<LedgerRow[]>       // "What you decided" — EMPTY TODAY, see N-R5
  queue: SectionData<QueueItem[]>        // "What to do this week" — three, see N-R6
  /**
   * "3 of 5" — what the queue shows against what the loader ranked. A plain
   * string beside the sections rather than a field inside one: `SectionData`
   * carries the section's DATA, and this is the meta the page prints in
   * `.sec__head`. See N-R6.
   */
  queueMeta: string
}
```

- [ ] **Step 1: Write the failing tests**

Mock `getDecisionsView` with `vi.mock`, exactly as `tests/lib/counter-adapter-orders.test.ts` mocks `order-actions`. Read that file first for the mocking shape.

```ts
// tests/lib/counter-adapter-decisions.test.ts
import { getDecisionsSections } from "@/lib/counter/adapters/decisions"
import { getDecisionsView } from "@/app/actions/decisions/get-decisions-view"
import { dataOf } from "@/lib/counter/section-data"

vi.mock("@/app/actions/decisions/get-decisions-view", () => ({
  getDecisionsView: vi.fn(),
}))

const VIEW = {
  asOf: "2026-08-26",
  storeName: "Hollywood",
  storeId: "hollywood",
  isAggregate: false,
  confidence: 3,
  potUsdPerWeek: 1240,
  days: [
    { date: "2026-08-24", weekdayShort: "MON", monthDayShort: "AUG 24", predictedRevenue: 6609, p10: 5367, p90: 7850, /* … */ },
    { date: "2026-08-26", weekdayShort: "WED", monthDayShort: "AUG 26", predictedRevenue: 6269, p10: 5654, p90: 6771, /* … */ },
  ],
  actions: [
    { id: "a1", title: "Cover Saturday 2-6pm", impactUsdPerWeek: 6480, dots: 3, confidence: "high", /* … */ },
    { id: "a2", title: "Raise the six ground-beef recipes", impactUsdPerWeek: -116, dots: 2, confidence: "medium", /* … */ },
    { id: "a3", title: "Push the Milkshake", impactUsdPerWeek: 41, dots: 3, confidence: "high", /* … */ },
    { id: "a4", title: "A fourth", impactUsdPerWeek: 12, dots: 1, confidence: "low", /* … */ },
    { id: "a5", title: "A fifth", impactUsdPerWeek: 8, dots: 1, confidence: "low", /* … */ },
  ],
  decisions: [],
  scorecard: { insideInterval: 24, sampleSize: 30, expectedAt80: 24, avgErrorPct: 8.4, /* … */ },
  briefing: [ /* four lines */ ],
  vitals: { /* … */ },
  verdict: { line: "One decision cannot wait.", sources: [], model: "gpt-4.1-mini" },
}
// Fill every elided field from the real interfaces in get-decisions-view.ts —
// a fixture that omits a field the adapter reads is a test that proves nothing.

describe("getDecisionsSections", () => {
  beforeEach(() => vi.mocked(getDecisionsView).mockResolvedValue({ ok: true, data: VIEW as never }))

  /*
   * N-R6. `buildActionCards` caps at five; the prototype's queue holds three,
   * and `.qitem` is a landmark, so five against three is two EXTRA landmarks
   * and a red gate that no absence allowance can forgive.
   */
  it("renders three queue items, not the loader's five", async () => {
    const s = await getDecisionsSections({})
    expect(dataOf(s.queue)).toHaveLength(3)
  })

  it("reports the true open count beside the cap, so the cap is visible", async () => {
    const s = await getDecisionsSections({})
    expect(s.queue.status).toBe("ready")
    // On the sections object, NOT inside `head` — the meta belongs to the
    // queue, and `SectionData` carries data, not the head a page renders.
    expect(s.queueMeta).toBe("3 of 5")
  })

  /*
   * N-R5. DecisionLog is empty in production. The ledger must be READY with an
   * empty array, never `empty()` — `Empty` renders a `.empty` landmark the
   * prototype does not have, and an extra landmark is never forgivable.
   */
  it("renders the ledger ready-and-empty rather than in the empty state", async () => {
    const s = await getDecisionsSections({})
    expect(s.ledger.status).toBe("ready")
    expect(dataOf(s.ledger)).toEqual([])
  })

  /*
   * The one-function rule. The headline pot, the strip cell and the phone strip
   * all print the week's forecast; they must be the same number, which means
   * one computation.
   */
  it("prints one week total in the headline and the strip", async () => {
    const s = await getDecisionsSections({})
    const head = dataOf(s.head)!
    const cell = dataOf(s.strip)!.find((c) => c.label === "This week's pot")!
    expect(cell.value).toBe(head.figure.value)
  })

  /*
   * `buildActionCards` already normalises every horizon to a week (1 day for
   * reprice, 30 for menu engineering). The adapter must PRINT that, not
   * re-normalise it — doing the division twice is what turned a 30-day figure
   * into "+$10,839/wk" before the loader was fixed.
   */
  it("prints the loader's weekly figure unchanged, with a /wk unit", async () => {
    const s = await getDecisionsSections({})
    const items = dataOf(s.queue)!
    expect(items.map((q) => q.lead)).toEqual(["$6,480", "-$116", "$41"])
    expect(items.map((q) => q.unit)).toEqual(["/wk", "/wk", "/wk"])
  })

  it("surfaces a loader failure as failed sections, not as an empty page", async () => {
    vi.mocked(getDecisionsView).mockResolvedValue({ ok: false, error: "no_stores" })
    const s = await getDecisionsSections({})
    expect(s.head.status).toBe("failed")
    expect(s.queue.status).toBe("failed")
    // `empty` would tell the reader there is nothing to decide. There might be
    // plenty; we could not load it.
  })

  it("selects the day the caller asked for, and today when it did not", async () => {
    const s = await getDecisionsSections({ day: "2026-08-24" })
    expect(dataOf(s.day)?.date).toBe("2026-08-24")
    const d = await getDecisionsSections({})
    expect(dataOf(d.day)?.date).toBe("2026-08-26")
  })

  // A day key from a URL is untrusted, exactly as `readCounterParams` treats
  // every other param. An unknown day must fall back, not throw.
  it("falls back to today when asked for a day that is not in the week", async () => {
    const s = await getDecisionsSections({ day: "1999-01-01" })
    expect(dataOf(s.day)?.date).toBe("2026-08-26")
  })

  /*
   * N-R7 — the characterisation test. This pins TODAY'S ordering so the
   * ranking defect in `buildActionCards` is visible and any future change to
   * it is deliberate. It asserts what the code does, not what it should do,
   * and it must say so.
   */
  it("CHARACTERISATION: keeps the loader's order, defect and all (see N-R7)", async () => {
    const s = await getDecisionsSections({})
    expect(dataOf(s.queue)!.map((q) => q.key)).toEqual(["a1", "a2", "a3"])
  })

  it("shows the accuracy panel's record as one mark per evaluated day", async () => {
    const s = await getDecisionsSections({})
    expect(dataOf(s.accuracy)?.record).toHaveLength(30)
  })

  // The scorecard is null until the evaluator has run. That is a real state,
  // and it is not-computed rather than failed: nothing broke.
  it("marks accuracy not_computed when the evaluator has not run", async () => {
    vi.mocked(getDecisionsView).mockResolvedValue({ ok: true, data: { ...VIEW, scorecard: null } as never })
    const s = await getDecisionsSections({})
    expect(s.accuracy.status).toBe("not_computed")
  })
})
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run tests/lib/counter-adapter-decisions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/counter/adapters/decisions.ts`**

Follow `src/lib/counter/adapters/orders.ts` for structure: one exported entry point, a `build*` function per section, `classify` from `./types` for the ready/empty/failed decision, no `.status` branching escaping into the return value. Every money string comes from `money()` in `@/lib/counter/format`; every count from `count()`.

The week series comes from `view.days`, which `getDecisionsView` already deduped — but the adapter must not assume that. Where it reads `ForecastDailyRevenue` directly (it should not need to), it goes through `newestGenerationPerDay`. If a later reviewer finds the adapter summing raw forecast rows, that is a bug regardless of what the loader did.

- [ ] **Step 4: Run and watch pass**

Run: `npx vitest run tests/lib/counter-adapter-decisions.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
git add src/lib/counter/adapters/decisions.ts tests/lib/counter-adapter-decisions.test.ts
git commit -m "feat(counter): the week ahead, as sections"
```

---

## Task 5: The week ahead, on the desk

**Files:**
- Create: `src/app/dashboard/(counter)/decisions/page.tsx`, `src/app/dashboard/(counter)/decisions/counter-decisions-client.tsx`, `src/app/dashboard/(counter)/decisions/loading.tsx`
- Modify: `scripts/counter-lint.ts` (`AWAITED_SECTIONS_ALLOWED` — see Step 3)
- Delete: `src/app/dashboard/(editorial)/decisions/**` (10 components, 13 lib modules, `decisions.css`)
- Test: `tests/app/counter-decisions.test.tsx`

**Interfaces:**
- Consumes: `getDecisionsSections` (Task 4), every primitive from Tasks 1-2.

### Rewritten 2026-08-26 against the shell Tasks 1-4 of the streaming-architecture plan landed

This task was written before that plan existed and describes the pattern it replaced: a page under `src/app/dashboard/` that awaits everything and hands one object to one client component rendering `AppShell`. Four things change here; **the six sections below, the day-picker rule and every ruling (N-R1 through N-R8) are unchanged** — only composition and fetching are:

- **Route group.** The page lives at `src/app/dashboard/(counter)/decisions/page.tsx`, not `src/app/dashboard/decisions/page.tsx` — a page rebuilt on Counter graduates into `(counter)`, exactly as `orders` and `pnl` did. `npm run tokens`' `no-route-without-loading` then requires the sibling `loading.tsx` this file list now includes.
- **No shell in the page or the client.** Neither file imports `AppShell`. The client returns a `<>` holding `PageHead` (title, sub, the day picker's own actions if any) followed by the six sections — the rail, the topbar, the store switcher and the ⌘K surface are `(counter)/layout.tsx`'s, already mounted before this page renders. `npm run tokens`' `no-shell-in-page` fails the build on an `AppShell` import here.
- **The single await is correct here, and must be named to the linter.** `getDecisionsSections` (Task 4) is ONE resolved `Promise<DecisionsSections>` built from ONE `getDecisionsView` load — every section is derived from that same value, exactly as `getOrderSections` is for `src/app/dashboard/(counter)/orders/[id]/page.tsx`. There is nothing to isolate with a promise per section, so the page keeps `await getDecisionsSections(...)` rather than adopting the `getXSectionPromises` shape the streaming pages use — but `npm run tokens`' `no-awaited-sections-in-page` does not know that reasoning, only the two order-detail paths it is told about. This page's path must be added, by name, to `AWAITED_SECTIONS_ALLOWED` in `scripts/counter-lint.ts` in the same commit, or the gate reds on a page that is correctly written.
- **The store list, if this page's own content needs it, is fetched alongside the adapter call, not before it.** `getOverviewStores()` is no longer fetched "for the switcher" — the switcher reads it from the layout already. If the client needs the full store list for its own content (check what it actually renders before assuming it does), fetch it with `Promise.all([getOverviewStores(), getDecisionsSections({...})])`: the two calls are independent, and a sequential pair here would be exactly the waterfall Task 5 of the streaming-architecture plan closed on the order-detail pages.

Page composition, in the prototype's order (`P.decisions.desk`, line 4682):

1. `HeadBlock` — `.headline` with `.fig` (the week's pot + delta) and `.say` (state pill, the verdict paragraph, a `.linkact` button)
2. `Strip` — four cells: this week's pot, forecast accuracy, labor gap, sales per labor hour
3. `Section` "The briefing" / "what the week turns on" → `Briefing`
4. `Section` "The call this week" / "forecast against actual · click a day" → `WeekPicker` + a `.mono` line
5. `<div className="split">` holding two `Section`s: "<day> in detail" (`MathLines`) and "How well we have been calling it" (`MathLines` + `Record` + a `.mono` line)
6. `<div className="split">` holding two `Section`s: "What you decided" (`Table`) and "What to do this week" (`Queue`)

The day picker writes to the URL, not to component state — same rule as every other Counter control (`src/lib/counter/url-state.ts`). Add a `day` key there if it is not present; treat it as untrusted, exactly as `readChannels` treats `channels`.

- [ ] **Step 1: Write the failing tests**

Model on `tests/app/counter-orders.test.tsx` **as it stands today**: that file's own `CounterOrdersClient` test wrapper renders `AppShell` around the island, because `AppShell` is the layout's now and a bare island has no `main#ct-main` to assert against. Copy that wrapper shape, not an older one. Assert:

```tsx
it("renders the six prototype sections in order", async () => { /* … */ })

it("never renders an .empty landmark", () => {
  // The standing constraint. Every section on this page must render its own
  // shell over zero rows rather than the empty state.
  expect(container.querySelectorAll(".empty")).toHaveLength(0)
})

// N-R12. `Table` takes only `columns` and `rows` — it has no caption and no
// aria-label, so it has NO accessible name and `getByRole("table", { name })`
// cannot find it. Scope through the section, which is the house convention:
// `tests/app/counter-orders.test.tsx:196` and `:405` do exactly this.
it("shows the ledger's table header with no rows", () => {
  const sections = container.querySelectorAll(".sec")
  const ledger = [...sections].find((s) => s.textContent?.includes("What you decided"))!
  const tbl = ledger.querySelector("table.tbl")!
  expect(tbl.querySelectorAll("thead th")).toHaveLength(4)
  expect(tbl.querySelectorAll("tbody tr")).toHaveLength(0)
})

it("moves the selected day into the URL, not into state", async () => { /* … */ })

it("prints the same week total in the headline and the strip", () => { /* … */ })
```

- [ ] **Step 2: Run and watch fail.** `npx vitest run tests/app/counter-decisions.test.tsx`

- [ ] **Step 3: Implement the page and client, and name the exemption.**

The page is a server component: session, then either `await getDecisionsSections({...})` alone or `Promise.all([getOverviewStores(), getDecisionsSections({...})])` if the client needs the store list (see above), and render the client with a `loading.tsx` beside it. Add `src/app/dashboard/(counter)/decisions/page.tsx` to `AWAITED_SECTIONS_ALLOWED` in `scripts/counter-lint.ts` in this step — the array is a hardcoded allowlist, so `npm run tokens` cannot pass without it. The client is a `<>` of `PageHead` plus the six sections, no `AppShell`. No `.status` reads anywhere in either file.

- [ ] **Step 4: Run and watch pass.**

- [ ] **Step 5: Delete the editorial route.**

```bash
git rm -r "src/app/dashboard/(editorial)/decisions"
```

Then grep for imports of anything under it — `src/app/(mobile)/m/**` and `src/lib/mobile/**` included, per the refactor playbook's explicit mobile-import check:

```bash
grep -rn "(editorial)/decisions" src/ e2e/ tests/ || echo "no references"
```

- [ ] **Step 6: Gate and commit**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
git add -A src/app/dashboard scripts/counter-lint.ts tests/app
git commit -m "feat(counter): the week ahead, on the desk"
```

---

## Task 6: The week ahead, on a phone

**Files:**
- Create: `src/app/(mobile)/m/(counter)/decisions/page.tsx`, `src/app/(mobile)/m/(counter)/decisions/counter-phone-decisions-client.tsx`, `src/app/(mobile)/m/(counter)/decisions/loading.tsx`
- Modify: `src/middleware.ts`, `scripts/counter-lint.ts` (`AWAITED_SECTIONS_ALLOWED`)
- Test: `tests/app/counter-phone-decisions.test.tsx`

**Interfaces:**
- Consumes: `getDecisionsSections` (Task 4) — **the same call, with the same arguments, as the desk**. Two surfaces asking two loaders what the week holds is how one restaurant gets two answers.

### Rewritten 2026-08-26, against the same shell contract as Task 5

Same four changes as Task 5's own rewrite note, applied to the phone surface: the page lives under `src/app/(mobile)/m/(counter)/decisions/` with a sibling `loading.tsx`; neither the page nor the client imports `AppShell` (the phone shell — rail-equivalent nav, topbar, ask — is `(mobile)/m/(counter)/layout.tsx`'s); the page keeps its single `await getDecisionsSections(...)` and this page's path is added to `AWAITED_SECTIONS_ALLOWED` alongside Task 5's desk entry; `getOverviewStores()` is fetched with `Promise.all` alongside the adapter call only if the phone client's own content needs the store list. `PageHead` carries `.mtitle`/`.msub`; the URL-driven `day` param is identical to the desk's, per the "same call, same arguments" rule above — a phone reading a different day than the desk for the same link is the same failure mode as two surfaces reading two ranges.

The middleware change below is unaffected by any of this: `MOBILE_ROUTES` maps URL paths, and a route group never appears in a URL.

Prototype (`P.decisions.phone`, line 4762): `.mtitle` + `.msub`, an `mstrip` of two cells, a `Section` "The call this week" holding a bar chart, a `Section` "What to do" holding an `mlist` of three, and one `.mbtn.mbtn--primary`.

Add to the `MOBILE_ROUTES` map in `src/middleware.ts`:

```ts
"/dashboard/decisions": "/m/decisions",
```

- [ ] **Step 1: Write the failing tests** — including:

```tsx
// The rule the linter cannot check, asserted at the only place it can be.
it("asks the same adapter as the desk, with the same arguments", async () => { /* … */ })

it("never renders an .empty landmark", () => { /* … */ })
```

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement**, under `(counter)`, with no `AppShell` in either file, and add this page's path to `AWAITED_SECTIONS_ALLOWED` in `scripts/counter-lint.ts`.
- [ ] **Step 4: Run and watch pass.**
- [ ] **Step 5: Gate and commit**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
git add -A "src/app/(mobile)" src/middleware.ts scripts/counter-lint.ts tests/app
git commit -m "feat(counter): the week ahead, on a phone"
```

---

## Task 7: The alerts adapter, and what the inbox can honestly say

**Files:**
- Create: `src/lib/counter/adapters/alerts.ts`
- Modify: `src/app/actions/alerts/inbox-actions.ts`
- Test: `tests/lib/counter-adapter-alerts.test.ts`

**Interfaces:**
- Consumes: `getAlertInbox`, `type InboxAlert`, `AlertInboxData` from `@/app/actions/alerts/inbox-actions`; `StatusPill`, `Tag` (Task 1).
- Produces: `getAlertsSections(input: AlertsQuery): Promise<AlertsSections>` — consumed by Tasks 8 and 9.

This task carries rulings N-R1, N-R2 and N-R3. Read the measured table at the top of this plan before starting; the tests below encode it.

`getAlertInbox` today returns `counts: { open, critical, watch, info }`. The page needs three more: `acknowledged`, `dismissed`, and the per-source tallies for the toggles.

**And one field on the row itself.** `InboxAlert` does not carry `acknowledgedAt`, and the time-to-close median cannot be computed without it. Add `acknowledgedAt: Date | null` to `InboxAlert` and to the `select` that fills it.

All four additions are additive — no existing caller's behaviour changes, and `npx tsc --noEmit` is what proves it.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/counter-adapter-alerts.test.ts
import { getAlertsSections } from "@/lib/counter/adapters/alerts"
import { getAlertInbox } from "@/app/actions/alerts/inbox-actions"
import { dataOf } from "@/lib/counter/section-data"

vi.mock("@/app/actions/alerts/inbox-actions", () => ({ getAlertInbox: vi.fn() }))

/*
 * The fixture is the SHAPE OF THE DATABASE, not a convenient shape. Measured
 * 2026-08-26: one live source, no ACKNOWLEDGED row anywhere, no body, no
 * explanation, and every `acknowledgedAt` sitting on a DISMISSED row.
 */
const INBOX = {
  alerts: [
    { id: "1", source: "ANOMALY_EVENT", severity: "CRITICAL", status: "OPEN", title: "Revenue -4,965 below forecast", body: null, explanation: null, target: "REVENUE", detectedAt: new Date("2026-08-18T09:00:00Z"), /* … */ },
    { id: "2", source: "ANOMALY_EVENT", severity: "WATCH", status: "DISMISSED", title: "Soda — -56 units below forecast", body: null, explanation: null, target: "MENU_ITEM", detectedAt: new Date("2026-08-26T04:00:00Z"), acknowledgedAt: new Date("2026-08-26T05:48:00Z"), /* … */ },
  ],
  counts: { open: 77, critical: 40, watch: 46, info: 1, acknowledged: 0, dismissed: 10 },
  bySource: { ANOMALY_EVENT: 87, PRICE_DELTA: 0, HARRI_VARIANCE: 0, QUANTITY_SPIKE: 0, NEW_PRODUCT: 0 },
  stores: [{ id: "hollywood", name: "Chris N Eddys - Hollywood" }],
}

describe("getAlertsSections", () => {
  beforeEach(() => vi.mocked(getAlertInbox).mockResolvedValue({ ok: true, data: INBOX as never }))

  /* N-R1 */
  it("renders all five source toggles, each carrying its live count", async () => {
    const s = await getAlertsSections({})
    const togs = dataOf(s.filters)!.sources
    expect(togs).toHaveLength(5)
    expect(togs.find((t) => t.id === "PRICE_DELTA")).toMatchObject({ count: 0, disabled: true })
    expect(togs.find((t) => t.id === "ANOMALY_EVENT")).toMatchObject({ count: 87, disabled: false })
  })

  /*
   * N-R2. The single most dangerous line on this page. 10 rows carry an
   * `acknowledgedAt` and every one of them is DISMISSED, so an "acknowledged"
   * count sourced from the timestamp reports dismissals as acknowledgements.
   */
  it("counts acknowledged from the status, and reads zero", async () => {
    const s = await getAlertsSections({})
    const cell = dataOf(s.strip)!.find((c) => c.label === "Acknowledged")!
    expect(cell.value).toBe("0")
    expect(cell.value).not.toBe("10")
    expect(cell.note).toBe("none yet")
  })

  /* N-R3 */
  it("prints the time-to-close median with no month-over-month delta", async () => {
    const s = await getAlertsSections({})
    const cell = dataOf(s.strip)!.find((c) => c.label === "Median time to close")!
    expect(cell.value).toBe("1.8 h")
    expect(cell.delta).toBeNull()   // there is no last month — nine days of history
    expect(cell.note).toBe("over dismissals")
  })

  /* N-R4 */
  it("renders the muted list ready-and-empty, never in the empty state", async () => {
    const s = await getAlertsSections({ segment: "muted" })
    expect(s.table.status).toBe("ready")
    expect(dataOf(s.table)).toEqual([])
  })

  // Every alert row has a null body and a null explanation. A row that renders
  // "null" or an empty paragraph is worse than one that renders the title
  // alone.
  it("renders a row with no body without printing an empty one", async () => {
    const s = await getAlertsSections({})
    expect(dataOf(s.table)![0].body).toBeNull()
  })

  it("maps severity to the prototype's pill classes through one function", async () => {
    const s = await getAlertsSections({})
    expect(dataOf(s.table)![0].severity).toBe("CRITICAL")
    // the class map lives in StatusPill (Task 1) and nowhere else
  })

  it("surfaces unauthorized as failed, not as an empty inbox", async () => {
    vi.mocked(getAlertInbox).mockResolvedValue({ ok: false, error: "unauthorized" })
    const s = await getAlertsSections({})
    expect(s.table.status).toBe("failed")
    // An owner-only page shown to a manager must not say "no alerts".
  })

  // The opened-per-day chart has two days with no rows at all (08-19, 08-20).
  // A series that skips them draws a 6-day week; one that reads them as zero
  // draws the truth.
  it("fills a day with no alerts as zero rather than dropping it", async () => {
    const s = await getAlertsSections({})
    const series = dataOf(s.chart)!.series[0].data
    expect(series).toHaveLength(10)  // 08-17 .. 08-26 inclusive
    expect(series[2]).toBe(0)        // 08-19
    expect(series[3]).toBe(0)        // 08-20
  })
})
```

- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement the adapter and the additive `inbox-actions` counts.**
- [ ] **Step 4: Run and watch pass.**

- [ ] **Step 5: Prove the acknowledged test is a test**

Change the adapter to count `acknowledgedAt !== null`. The test must fail with `expected '10' to be '0'`. **Restore.** Record the message in the report.

- [ ] **Step 6: Gate and commit**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
git add src/lib/counter/adapters/alerts.ts src/app/actions/alerts/inbox-actions.ts tests/lib/counter-adapter-alerts.test.ts
git commit -m "fix(counter): the inbox called ten dismissals an acknowledgement"
```

---

## Task 8: Open right now, on the desk

**Files:**
- Create: `src/app/dashboard/(counter)/alerts/page.tsx`, `src/app/dashboard/(counter)/alerts/counter-alerts-client.tsx`, `src/app/dashboard/(counter)/alerts/loading.tsx`
- Modify: `scripts/counter-lint.ts` (`AWAITED_SECTIONS_ALLOWED` — see Task 5's note)
- Delete: `src/app/dashboard/(editorial)/alerts/**`
- Test: `tests/app/counter-alerts.test.tsx`

### Rewritten 2026-08-26, against the same shell contract as Task 5

The same four changes apply here as on Task 5's decisions page, and for the same reason: `getAlertsSections` (Task 7) is ONE resolved `Promise<AlertsSections>` built from ONE `getAlertInbox` load, so this page is structurally the order-detail shape, not the streaming-pages shape. Concretely: the page lives at `src/app/dashboard/(counter)/alerts/page.tsx` with a sibling `loading.tsx`; neither file imports `AppShell` — `PageHead` is the client's, the rail/topbar/switcher/ask are `(counter)/layout.tsx`'s; the page keeps its single `await getAlertsSections(...)` and this path is added to `AWAITED_SECTIONS_ALLOWED` in the same commit; `getOverviewStores()`, if the page's own content needs it, is fetched with `Promise.all` alongside the adapter call rather than a sequential `await` before it. N-R8's owner gate is unaffected — it is a redirect the page issues before any of this, exactly as `/dashboard/pnl` and `/dashboard/decisions`'s absence of one are unaffected by their own rewrites.

Composition (`P.alerts.desk`, line 4775): `Strip` of four → a `.sec` holding TWO `.filters` rows (severity toggles + search + count; then a source row labelled `Source`) and a `Table` → `Section` "Alerts opened" holding a bar chart.

The second `.filters` row carries `style="border-top:0"` in the prototype. That is an inline style on a layout property, which `npm run tokens` permits (the colour rule matches hex/oklch/rgb/hsl only) — but prefer the ported class if `counter-components.css` already carries one.

Both filter rows write to the URL through `writeCounterParams`. Reuse the Orders page's settled-search machinery — and read the comment above `committed` in `counter-orders-client.tsx` before touching the debounce, which cost a full fix round on that page.

- [ ] **Step 1: Write the failing tests** — including the two that matter most:

```tsx
it("renders five source toggles and disables the four with no rows", () => { /* … */ })

it("never renders an .empty landmark, in any segment", () => { /* … */ })
```

- [ ] **Step 2-4:** fail → implement (page under `(counter)`, no `AppShell`, path added to `AWAITED_SECTIONS_ALLOWED`) → pass.
- [ ] **Step 5: Delete `src/app/dashboard/(editorial)/alerts`, then grep for references** exactly as Task 5 does.
- [ ] **Step 6: Gate and commit**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
git add -A src/app/dashboard scripts/counter-lint.ts tests/app
git commit -m "feat(counter): open right now, on the desk"
```

---

## Task 9: Open right now, on a phone

**Files:**
- Create: `src/app/(mobile)/m/(counter)/alerts/page.tsx`, `src/app/(mobile)/m/(counter)/alerts/counter-phone-alerts-client.tsx`, `src/app/(mobile)/m/(counter)/alerts/loading.tsx`
- Modify: `src/middleware.ts`, `scripts/counter-lint.ts` (`AWAITED_SECTIONS_ALLOWED`)
- Test: `tests/app/counter-phone-alerts.test.tsx`

### Rewritten 2026-08-26, against the same shell contract as Task 5

Same four changes as Tasks 5, 6 and 8's own rewrite notes, on the phone surface of the alert inbox: page and client live under `src/app/(mobile)/m/(counter)/alerts/` with a sibling `loading.tsx`; neither imports `AppShell`; the single `await getAlertsSections(...)` stays and this path joins `AWAITED_SECTIONS_ALLOWED`; `getOverviewStores()`, if needed, is `Promise.all`'d alongside it. The middleware change below is unaffected — `MOBILE_ROUTES` maps URL paths, and `(counter)` is a route group, invisible to the URL.

Prototype (`P.alerts.phone`, line 4820): `.mtitle` "Alerts", `.msub` "3 open · 12 acknowledged", a `Section` "Open" with an `mlist` of three, a `Section` "Acknowledged" with an `mlist` of two.

**The subtitle is the page's own version of N-R2.** "3 open · 12 acknowledged" must become the live counts, which today are `77 open · 0 acknowledged`. And the "Acknowledged" section has zero rows: it renders its `mlist` shell over an empty array (`mlist` is a landmark, its items are not), never the empty state.

Add `"/dashboard/alerts": "/m/alerts"` to `MOBILE_ROUTES`.

- [ ] **Step 1: Write the failing tests**, including:

```tsx
it("asks the same adapter as the desk, with the same arguments", async () => { /* … */ })
it("renders the acknowledged mlist over zero rows, not an .empty", () => { /* … */ })
it("prints the live counts in the subtitle", () => { /* '77 open · 0 acknowledged' */ })
```

- [ ] **Step 2-4:** fail → implement (page under `(counter)`, no `AppShell`, path added to `AWAITED_SECTIONS_ALLOWED`) → pass.
- [ ] **Step 5: Gate and commit**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
git add -A "src/app/(mobile)" src/middleware.ts scripts/counter-lint.ts tests/app
git commit -m "feat(counter): open right now, on a phone"
```

---

## Task 10: Flip the gate

**Files:**
- Modify: `e2e/fidelity/manifest.ts`
- Create: `docs/counter/fidelity/decisions.md`, `docs/counter/fidelity/alerts.md`

**e2e sits outside the standard gate.** This task runs `npx playwright test e2e/` in full, not only the fidelity project — an earlier plan landed an e2e spec guarding a component it had just deleted, and the standard gate did not notice.

- [ ] **Step 1: Run the gate with both pages still `editorial`, and read the report**

```bash
npm run fidelity -- --grep "decisions|alerts"
npx tsx scripts/fidelity-report.ts
```

- [ ] **Step 2: Count the landmarks on each surface**

Both baselines are **measured, never chosen**. Record the prototype's count and ours, per surface, in the report file.

- [ ] **Step 3: Budget absences only for landmarks that are genuinely missing**

Re-read the manifest comment on the `orders` entry before writing any `absentLandmarks`. An allowance that forgives FEWER than it budgets fails as **stale**, so an absence written from reasoning rather than from a run is itself a gate failure. On the orders pages that mechanism caught the plan author's own error.

Expected to need none — but expectations are what step 2 is for.

- [ ] **Step 4: Flip both entries to `status: "counter"` with the measured baselines**, carrying a comment that explains each number and each absence.

- [ ] **Step 5: Run everything**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
npx playwright test e2e/
```

If `auth.setup.ts` fails with *"Sign-in failed — Something went wrong on our end"*: this is the known cold-server race, documented in the orders ledger. **Do not retry blindly.** Check whether the database recorded a `LoginEvent` at the failing timestamp — if it did, sign-in succeeded server-side and the client was shown a generic error. Warm the server and re-run.

- [ ] **Step 6: Write the two fidelity reports and commit**

```bash
git add e2e/fidelity/manifest.ts docs/counter/fidelity
git commit -m "test(fidelity): the week ahead and the alert inbox are gated"
```

---

## Self-review

**Spec coverage.** Every section of both prototype pages maps to a task: decisions head/strip/briefing/week/day/accuracy/ledger/queue → Tasks 4-6; alerts strip/filters/table/chart → Tasks 7-9; primitives → Tasks 1-2; the forecast dedupe → Task 3; the gate → Task 10.

**Placeholder scan.** Tasks 5, 6, 8 and 9 give test *names* and assertions rather than complete test bodies, and Task 4's fixture elides fields with `/* … */`. That is deliberate and bounded: the page tests are long and their shape is fixed by two landed examples (`tests/app/counter-orders.test.tsx`, `tests/app/counter-phone-orders.test.tsx`) which the briefs point at. The assertions that carry a ruling are written out in full. **Every elision in a fixture must be filled from the real interface** — a fixture that omits a field the adapter reads is a test that proves nothing, and Task 4 says so at the point of the elision.

**Type consistency.** `WeekDay` (Task 2) is produced by Task 4 and consumed by Task 5. `BriefingLine` (Task 1) likewise. `StripCell` is imported from `@/lib/counter/adapters/pnl`, as the orders adapter does — not redefined. `PillSeverity` (Task 1) is the `AlertSeverity` enum's three members and must stay in step with it.

**The risk this plan carries.** N-R7 gates a page whose queue ordering comes from a scoring function comparing two incompatible scales. The characterisation test makes the defect visible; it does not fix it. If a reviewer judges that shipping a visibly-ordered queue on a wrong ranking is not acceptable, the fix belongs in its own plan against `get-decisions-view.ts`, with a before/after measurement over the 41 live opportunities.
