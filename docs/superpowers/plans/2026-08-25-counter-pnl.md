# Counter P&L Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/dashboard/pnl` on Counter — prime cost as the headline against a 60% ceiling, a cascade instead of a donut, eight pressable weeks, the statement with a same-length comparison, and an honest trust panel — with `src/lib/counter/prime-cost.ts` and `src/lib/counter/statement.ts` arriving as the single definitions that Overview switches to in the same change.

**Architecture:** One loader (`statement.ts`) calls `getAllStoresPnL` once per window and reduces its result to a shape both pages consume; one pure calculator (`prime-cost.ts`) turns that shape into a prime-cost reading against the ceiling. `adapters/pnl.ts` classifies six sections out of them; the page composes primitives and never sees a `.status`. Custom ranges enter the URL so a pressed week and a stepped period are both real, shareable navigations.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Vitest 4 + RTL 16, Tailwind v4 + `counter.css` tokens, date-fns.

**Spec:** `docs/superpowers/specs/2026-08-23-counter-design-system-design.md`

## Global Constraints

- Branch is `dashboardv2`. No rebase; one merge at the end.
- `npm run tokens` is a build failure, not advice. On `src/app/dashboard/**`,
  `src/app/(mobile)/m/**`, `src/components/counter/**`, `src/lib/counter/**`:
  no colour literal outside `counter.css`; no generic Tailwind palette colour;
  no page branching on a `SectionData` status; no page importing Prisma or a
  server action directly; no page importing `framer-motion` directly.
- **A figure shown on two pages comes from one function in `src/lib/counter/`.**
  This plan is the one that makes that rule real (note 60).
- Whole-project gate: `npm test && npm run tokens && npx tsc --noEmit && npm run build`.
  There is no ESLint in this repo and `next lint` was removed in Next 16.
- Delete `.next` before trusting a red `tsc` — a stale build directory reports
  ~122 phantom errors in generated `routes.d.ts` (standing rule R6).
- **A test that passes before the fix is not a test.** Every task that fixes a
  defect must show the test failing against the unfixed code first, and say so
  in its report.
- `Section` is the sole state renderer (ruling R3, Plan 6). `Strip`, `Chart`,
  `Table`, `Cascade`, `Meter` take plain `T` and know nothing about states.
- Prices, percents and deltas are formatted **only** by `src/lib/counter/format.ts`.
- Never run `prisma migrate dev`. This plan changes no schema.
- **Tests live in a top-level `tests/` tree, mirroring `src/` — never in a
  `__tests__/` folder beside the code.** `vitest.config.mts` is the authority.
  `src/lib/counter/statement.ts` is tested by `tests/lib/counter/statement.ts`;
  `src/components/counter/shell/app-shell.tsx` by
  `tests/components/counter/shell/app-shell.test.tsx`. Before adding cases to
  an existing file, read it: module-level constants there may already own the
  names you were about to declare.

---

## Prior rulings this plan inherits

- **R1 (Plan 7):** SPLH is `not_computed` because `getSplhSeries` cannot be
  scoped to a range. Untouched here.
- **R3 (Plan 6):** `Section` is the sole state renderer.
- **R6:** stale `.next` invalidates a `tsc` run.

## Rulings made while writing this plan

**R1 (Plan 8) — the prime-cost cascade ships computed, not owed.**
Spec §3.2 lists "Prime-cost cascade vs. the 60% ceiling" under *sections the
app cannot yet compute*. That was true when the spec was written: nothing in
`src/lib` or `src/app/actions` computed prime cost. It is no longer a reason to
mark the section owed, because §2.2 puts `prime-cost.ts` in the directory
layout, §4 rule 5 names note 60 as the reason it exists, and §5 schedules P&L
first *specifically* so the two definitions are resolved before other pages
inherit them. `getAllStoresPnL` already returns `cogsValue` and `laborValue`
per store and combined; prime cost is their sum over gross sales. Writing that
sum in one place is the whole assignment. **What stays owed is the trust panel
(note 44)** — measured / prorated / rate / unposted needs a per-line provenance
model and an "unposted food inside this range" query, neither of which exists.
Cost if wrong: a headline figure ships that the spec's §3.2 snapshot expected
later. Recoverable by marking one adapter line `owed`.

**R2 (Plan 8) — prime cost's labour is the whole blended wage bill, and the
codebase has only one.** Note 60 resolves the ambiguity as "prime is the whole
wage bill everywhere; the schedule's own share stays on the Labor page as
Hourly labor." Reading `computeStorePnL` (`src/lib/pnl.ts:453-492`), this
codebase has exactly one labour line: Harri actuals for covered days plus
`fixedMonthlyLabor` prorated across the uncovered ones. `fixedMonthlyLabor` is
labelled **"Labor · monthly"** with a placeholder of `29600` in the store
dossier (`store-dossier.tsx:587-591`) — a whole monthly payroll, not a salaried
top-up. So the blend is a *substitution*, not an omission, and
`cogsValue + laborValue` is the whole wage bill by construction. The prototype's
store file splits "Fixed labor — salaried only" from Harri hourly; **this
codebase does not, and prime-cost.ts must not pretend it does** by adding
`fixedMonthlyLabor` on top of the blend — that would double-count labour on
every day Harri covers. Cost if wrong: prime cost understates by the salaried
share on Harri-covered days, on both pages identically, which is note 60's
symptom without note 60's disagreement.

**R3 (Plan 8) — the 60% ceiling is a constant, not a store field.** `Store` has
`targetCogsPct` and no prime-cost target (`prisma/schema.prisma:151-154`). The
prototype takes the ceiling from the store file; the real schema has no such
field. `PRIME_CEILING_PCT = 60` lives in `prime-cost.ts` with the trade
benchmark documented beside it, and the food target continues to come from the
store's own `targetCogsPct` where one page already reads it. Adding a schema
column is a migration this plan does not make. Cost if wrong: an owner who
wants a different ceiling edits a constant instead of a form field; a
follow-up.

**R4 (Plan 8) — a single store is read out of the all-stores call.**
`getStorePnL` returns `kpis` and `cogs.totalCogs` but no labour total (labour
lives inside `rows`), while `getAllStoresPnL` returns `cogsValue` **and**
`laborValue` for every store *and* combined, from one cached query. Both the
all-stores and single-store readings therefore come from `getAllStoresPnL`,
picking the `perStore` entry when a store is selected. One call shape, one
denominator, one labour source — which is the only way the "same figure on two
pages" rule can actually hold. Cost if wrong: a single-store view computes
three stores' figures to show one. With three stores and a 600s cache, that is
cheap; it stops being cheap at fifty stores, and that is when `getStorePnL`
grows a labour total.

**R5 (Plan 8) — the phone gets Counter by composition, not by duplication.**
Decision 4 of the brainstorm is "both surfaces together, page by page." Plan 7
shipped Overview desk-only, and `src/proxy.ts:6-29` redirects phone user
agents from `/dashboard` to the editorial `/m` — so no phone has ever seen a
Counter page. The spec's §2.2 layout implies a second page module per route
under `(mobile)/m/**`; sixteen remaining pages × two modules is thirty-two page
modules that must agree with each other, which is the duplication the whole
adapter design exists to avoid. Instead: `AppShell` gains a phone composition
(the rail becomes a sheet), and a route leaves `DESKTOP_TO_MOBILE` the moment
its Counter page ships. Task 7 does this for `/dashboard` and `/dashboard/pnl`,
which repays Plan 7's phone gap in the same change. Cost if wrong: the phone
gets a narrow desk page instead of a bespoke phone page; recoverable per route
by adding a module back under `(mobile)/m/**`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/counter/date-range.ts` *(modify)* | gains `RangeId`, `rangeLabel`, `isoDay`, `parseIsoDay` |
| `src/lib/counter/url-state.ts` *(modify)* | `from`/`to` custom range; `writeCounterParams` accepts a `range` |
| `src/components/counter/shell/date-control.tsx` *(modify)* | labels a custom range honestly; steppers become real |
| `src/lib/counter/prime-cost.ts` *(create)* | `PRIME_CEILING_PCT`, `primeCost()` — the one definition (note 60) |
| `src/lib/counter/statement.ts` *(create)* | `loadStatement()` — one call, one shape, both pages |
| `src/lib/counter/adapters/pnl.ts` *(create)* | six sections, classified |
| `src/lib/counter/adapters/overview.ts` *(modify)* | gains `prime`, sourced from the same two modules |
| `src/app/dashboard/pnl/page.tsx` *(create)* | server component; composes only |
| `src/app/dashboard/counter-pnl-client.tsx` *(create)* | the client island |
| `src/app/dashboard/pnl/[storeId]/page.tsx` *(create)* | redirect shim → `/dashboard/pnl?store=<id>` |
| `src/components/counter/shell/app-shell.tsx` *(modify)* | phone composition: rail as a sheet below `md` |
| `src/proxy.ts` *(modify)* | drop `/dashboard` and `/dashboard/pnl` from the redirect map |
| `docs/counter/pnl-verification.md` *(create)* | what was rendered and measured |

---

### Task 1: Custom ranges in the URL

Note 53 requires that pressing one of eight weeks *moves the date control*, and
Plan 7 left `onStep` wired to `() => {}` with the comment "CounterParams only
stores a NAMED preset … Left inert rather than faked." Both need the same
thing: an arbitrary window the URL can carry.

**Files:**
- Modify: `src/lib/counter/date-range.ts`
- Modify: `src/lib/counter/url-state.ts`
- Modify: `src/components/counter/shell/date-control.tsx:98`
- Modify: `src/app/dashboard/counter-overview-client.tsx` (the inert `onStep`)
- Test: `tests/lib/counter/date-range.test.ts` (exists — extend)
- Test: `tests/lib/counter/url-state.test.ts` (exists — extend)
- Test: `tests/components/counter/shell/date-control.test.tsx` (exists — extend)

**Interfaces:**
- Consumes: `DateRange {start,end}`, `PresetId`, `PRESETS`, `resolvePreset`,
  `stepRange`, `dayCount` — all already exported from `date-range.ts`.
- Produces:
  - `export type RangeId = PresetId | "custom"`
  - `export function isoDay(d: Date): string` — `"2026-08-25"`, local fields, no UTC shift
  - `export function parseIsoDay(s: string): Date | null` — local midnight, or null
  - `export function rangeLabel(r: DateRange, id: RangeId): string`
  - `CounterParams.presetId` widens from `PresetId` to `RangeId`
  - `writeCounterParams(current, next)` where `next` gains
    `range?: DateRange | null`
  - `DateControlProps.presetId` widens to `RangeId`

- [ ] **Step 1: Write the failing tests for the date-range helpers**

Append to `tests/lib/counter/date-range.test.ts`:

```ts
import { isoDay, parseIsoDay, rangeLabel } from "@/lib/counter/date-range"

describe("isoDay / parseIsoDay", () => {
  it("round-trips a local date without a UTC shift", () => {
    // 2026-01-01 at 00:30 local. toISOString() on this in any timezone west
    // of UTC returns the PREVIOUS day — which is exactly the bug this pair
    // exists to avoid.
    const d = new Date(2026, 0, 1, 0, 30)
    expect(isoDay(d)).toBe("2026-01-01")
    expect(parseIsoDay(isoDay(d))).toEqual(new Date(2026, 0, 1))
  })

  it("pads single-digit months and days", () => {
    expect(isoDay(new Date(2026, 8, 5))).toBe("2026-09-05")
  })

  it("returns null for anything that is not a calendar date", () => {
    for (const bad of ["", "nope", "2026-13-01", "2026-02-30", "2026-2-1", "2026-01-01T00:00:00Z"]) {
      expect(parseIsoDay(bad)).toBeNull()
    }
  })

  it("returns a local midnight, not a UTC one", () => {
    const d = parseIsoDay("2026-08-25")!
    expect(d.getHours()).toBe(0)
    expect(d.getDate()).toBe(25)
  })
})

describe("rangeLabel", () => {
  it("names a preset by its own name", () => {
    expect(rangeLabel({ start: new Date(2026, 7, 24), end: new Date(2026, 7, 24) }, "yesterday"))
      .toBe("Yesterday")
  })

  it("names a custom multi-day window by its ends", () => {
    expect(rangeLabel({ start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }, "custom"))
      .toBe("Aug 3 – Aug 9")
  })

  it("names a custom single day once, not twice", () => {
    expect(rangeLabel({ start: new Date(2026, 7, 3), end: new Date(2026, 7, 3) }, "custom"))
      .toBe("Aug 3")
  })

  it("spans a year boundary without dropping the year", () => {
    expect(rangeLabel({ start: new Date(2025, 11, 29), end: new Date(2026, 0, 4) }, "custom"))
      .toBe("Dec 29, 2025 – Jan 4, 2026")
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/lib/counter/date-range.test.ts`
Expected: FAIL — `isoDay`, `parseIsoDay`, `rangeLabel` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/lib/counter/date-range.ts`:

```ts
/**
 * A named preset, or an arbitrary window the reader chose.
 *
 * "custom" is not a thirteenth preset — it has no `resolve`, because it does
 * not resolve against today at all. It is the range that is already in the
 * URL. Note 53's eight pressable weeks and the date control's own steppers
 * both produce one.
 */
export type RangeId = PresetId | "custom"

/**
 * A calendar date as `YYYY-MM-DD`, read off the LOCAL fields.
 *
 * `toISOString().slice(0, 10)` is the obvious version and it is wrong here:
 * this module's dates are local midnights, and in any timezone west of UTC
 * a local midnight serialises as the previous calendar day. A range written
 * to the URL and read back would walk one day earlier on every round trip.
 */
export function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The inverse, treating the string as UNTRUSTED — it arrives from a query
 * string a reader can hand-edit. Anything that is not a real calendar date at
 * local midnight returns null, and the caller falls back to a preset.
 *
 * The round-trip check catches overflow that `new Date(y, m, d)` accepts
 * silently: February 30th becomes March 2nd rather than an error.
 */
export function parseIsoDay(s: string): Date | null {
  const m = ISO_DAY.exec(s)
  if (!m) return null
  const [, y, mo, d] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  return isoDay(date) === s ? date : null
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `Aug 3`, or `Dec 29, 2025` when the range straddles a year boundary. */
function dayLabel(d: Date, withYear: boolean): string {
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return withYear ? `${base}, ${d.getFullYear()}` : base
}

/**
 * What the date control prints, and what the Ask context sentence says.
 *
 * A custom range has no name of its own, so it is named by its ends. Before
 * this existed, `PRESETS.find(...) ?? PRESETS[0]` in `date-control.tsx`
 * silently labelled anything unrecognised **"Today"** — a range that says one
 * thing and shows another, which is note 19's lie in its purest form.
 */
export function rangeLabel(r: DateRange, id: RangeId): string {
  if (id !== "custom") return PRESETS.find((p) => p.id === id)?.name ?? "Custom"
  const spansYears = r.start.getFullYear() !== r.end.getFullYear()
  if (r.start.getTime() === r.end.getTime()) return dayLabel(r.start, spansYears)
  return `${dayLabel(r.start, spansYears)} – ${dayLabel(r.end, spansYears)}`
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/lib/counter/date-range.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tests for the URL round trip**

Append to `tests/lib/counter/url-state.test.ts`:

```ts
const TODAY = new Date(2026, 7, 25) // Tue 25 Aug 2026

describe("custom ranges in the URL", () => {
  it("reads from/to as a custom range", () => {
    const p = readCounterParams(new URLSearchParams("from=2026-08-03&to=2026-08-09"), TODAY)
    expect(p.presetId).toBe("custom")
    expect(p.range).toEqual({ start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) })
  })

  it("ignores a custom range that is missing an end", () => {
    const p = readCounterParams(new URLSearchParams("from=2026-08-03"), TODAY)
    expect(p.presetId).toBe("yesterday")
  })

  it("ignores a backwards custom range rather than rendering it", () => {
    const p = readCounterParams(new URLSearchParams("from=2026-08-09&to=2026-08-03"), TODAY)
    expect(p.presetId).toBe("yesterday")
  })

  it("ignores an unparseable custom range", () => {
    const p = readCounterParams(new URLSearchParams("from=last-tuesday&to=2026-08-09"), TODAY)
    expect(p.presetId).toBe("yesterday")
  })

  it("lets from/to win over a named range, because it is the more specific one", () => {
    const p = readCounterParams(new URLSearchParams("range=d30&from=2026-08-03&to=2026-08-09"), TODAY)
    expect(p.presetId).toBe("custom")
  })

  it("writes a custom range and drops the named one", () => {
    const out = writeCounterParams(new URLSearchParams("range=d30&store=s1"), {
      range: { start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) },
    })
    expect(out.get("from")).toBe("2026-08-03")
    expect(out.get("to")).toBe("2026-08-09")
    expect(out.get("range")).toBeNull()
    expect(out.get("store")).toBe("s1")
  })

  it("clears a custom range when a preset is chosen", () => {
    const out = writeCounterParams(new URLSearchParams("from=2026-08-03&to=2026-08-09"), {
      presetId: "d7",
    })
    expect(out.get("range")).toBe("d7")
    expect(out.get("from")).toBeNull()
    expect(out.get("to")).toBeNull()
  })

  it("clears a custom range when passed null", () => {
    const out = writeCounterParams(new URLSearchParams("from=2026-08-03&to=2026-08-09"), {
      range: null,
    })
    expect(out.get("from")).toBeNull()
    expect(out.get("to")).toBeNull()
  })

  it("round-trips: what write produces, read understands", () => {
    const range = { start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }
    const out = writeCounterParams(new URLSearchParams(), { range })
    expect(readCounterParams(new URLSearchParams(out.toString()), TODAY).range).toEqual(range)
  })

  it("still drops the weekday comparison on a custom range longer than a week", () => {
    const p = readCounterParams(
      new URLSearchParams("from=2026-07-01&to=2026-08-09&cmp=weekday"),
      TODAY,
    )
    expect(p.comparisonId).toBe("prev")
  })
})
```

- [ ] **Step 6: Run them and watch them fail**

Run: `npx vitest run tests/lib/counter/url-state.test.ts`
Expected: FAIL — `from`/`to` are ignored; `writeCounterParams` rejects `range`.

- [ ] **Step 7: Implement the URL round trip**

In `src/lib/counter/url-state.ts`, change the import to add the new names:

```ts
import {
  COMPARISONS, PRESETS, comparisonRange, isoDay, parseIsoDay, resolvePreset,
  type ComparisonId, type DateRange, type PresetId, type RangeId,
} from "./date-range"
```

Widen the interface field:

```ts
export interface CounterParams {
  /**
   * A named preset, or "custom" when `from`/`to` carried an arbitrary window.
   * A caller looking this up in PRESETS must handle `undefined` — use
   * `rangeLabel(range, presetId)` instead of a find-with-fallback, which is
   * how the control used to label an unknown id "Today".
   */
  presetId: RangeId
  comparisonId: ComparisonId
  /** null means all stores — the absence of a store, not a magic "all" id. */
  storeId: string | null
  range: DateRange
}
```

Add above `readCounterParams`:

```ts
/**
 * `from`/`to` beat `range` when both are present, because they are the more
 * specific statement: `range=d7` describes a rule, `from`/`to` describes the
 * exact window a reader pressed. Anything unparseable, half-present or
 * backwards is discarded entirely rather than half-applied — a range whose
 * end precedes its start would produce a negative day count and a division by
 * it downstream.
 */
function readCustomRange(params: URLSearchParams): DateRange | null {
  const rawFrom = params.get("from")
  const rawTo = params.get("to")
  if (rawFrom === null || rawTo === null) return null

  const start = parseIsoDay(rawFrom)
  const end = parseIsoDay(rawTo)
  if (start === null || end === null) return null
  if (start.getTime() > end.getTime()) return null

  return { start, end }
}
```

Replace the first four lines of `readCounterParams`'s body:

```ts
export function readCounterParams(params: URLSearchParams, today: Date): CounterParams {
  const custom = readCustomRange(params)

  const rawPreset = params.get("range")
  const presetId: RangeId = custom !== null
    ? "custom"
    : isPreset(rawPreset)
      ? rawPreset
      : DEFAULT_PRESET

  const range = custom ?? resolvePreset(presetId as PresetId, today)
  // …the rest of the function is unchanged.
```

Extend `writeCounterParams`:

```ts
export function writeCounterParams(
  current: URLSearchParams,
  next: Partial<Pick<CounterParams, "comparisonId" | "storeId">> & {
    presetId?: PresetId
    /**
     * An arbitrary window — a pressed week (note 53) or a stepped period.
     * Setting it clears `range`; passing null clears `from`/`to` and leaves
     * whatever named range was there. The two are mutually exclusive in the
     * URL because they are mutually exclusive in meaning, and
     * `readCustomRange` resolves any conflict in `from`/`to`'s favour.
     */
    range?: DateRange | null
  },
): URLSearchParams {
  const out = new URLSearchParams(current)

  if (next.presetId !== undefined) {
    out.delete("from")
    out.delete("to")
    if (next.presetId === DEFAULT_PRESET) out.delete("range")
    else out.set("range", next.presetId)
  }
  if (next.range !== undefined) {
    if (next.range === null) {
      out.delete("from")
      out.delete("to")
    } else {
      out.delete("range")
      out.set("from", isoDay(next.range.start))
      out.set("to", isoDay(next.range.end))
    }
  }
  if (next.comparisonId !== undefined) {
    if (next.comparisonId === DEFAULT_COMPARISON) out.delete("cmp")
    else out.set("cmp", next.comparisonId)
  }
  if (next.storeId !== undefined) {
    if (next.storeId === null) out.delete("store")
    else out.set("store", next.storeId)
  }

  return out
}
```

Note `presetId` in the `next` type is `PresetId`, **not** `RangeId`: there is no
such thing as writing "custom" as a name. A caller wanting a custom window
passes `range`.

- [ ] **Step 8: Run them and watch them pass**

Run: `npx vitest run tests/lib/counter/url-state.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing test for the control's label**

Append to `tests/components/counter/shell/date-control.test.tsx`:

```tsx
it('labels a custom range by its ends, not "Today"', () => {
  render(
    <DateControl
      presetId="custom"
      comparisonId="prev"
      range={{ start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }}
      onPreset={() => {}}
      onComparison={() => {}}
      onStep={() => {}}
    />,
  )
  expect(screen.getByText("Aug 3 – Aug 9")).toBeInTheDocument()
  expect(screen.queryByText("Today")).not.toBeInTheDocument()
})

it("checks no preset while a custom range is showing", async () => {
  render(
    <DateControl
      presetId="custom"
      comparisonId="prev"
      range={{ start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }}
      onPreset={() => {}}
      onComparison={() => {}}
      onStep={() => {}}
    />,
  )
  fireEvent.click(screen.getByText("Aug 3 – Aug 9"))
  const checked = screen
    .getAllByRole("menuitemradio")
    .filter((el) => el.getAttribute("aria-checked") === "true")
  expect(checked).toHaveLength(0)
})
```

If the menu items use a different role in the existing file, match whatever
that file already queries — read it before writing this.

- [ ] **Step 10: Run it and watch it fail**

Run: `npx vitest run tests/components/counter/shell/date-control.test.tsx`
Expected: FAIL — the trigger reads "Today", because
`PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]` falls back to the first
preset for an id it does not recognise.

- [ ] **Step 11: Fix the control**

In `src/components/counter/shell/date-control.tsx`:

- Import `rangeLabel` and `type RangeId` from `@/lib/counter/date-range`.
- Change `DateControlProps.presetId` to `RangeId`.
- Replace line 98 (`const preset = PRESETS.find(...) ?? PRESETS[0]`) with:

```tsx
  // NOT `PRESETS.find(...) ?? PRESETS[0]`: that labelled every unrecognised
  // id "Today" — a control naming a range it is not showing. `rangeLabel`
  // names a custom window by its ends instead.
  const label = rangeLabel(range, presetId)
```

- Replace the trigger's `{preset.name}` with `{label}`.
- Leave the menu's `const checked = p.id === presetId` exactly as it is: for
  `"custom"` no preset matches, so nothing is checked, which is correct.

- [ ] **Step 12: Run it and watch it pass**

Run: `npx vitest run tests/components/counter/shell/date-control.test.tsx`
Expected: PASS.

- [ ] **Step 13: Make Overview's steppers real**

In `src/app/dashboard/counter-overview-client.tsx`, widen `push` and wire the
stepper. Replace the `push` callback and the `onStep` prop:

```tsx
  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const nextParams = writeCounterParams(params, next)
      const qs = nextParams.toString()
      // push, not replace: note 19's "a range that only changes the label is
      // a lie" cuts the other way too — a range change is a real navigation
      // an owner expects the back button to undo.
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )
```

```tsx
            onStep={(direction) => push({ range: stepRange(counterParams.range, direction) })}
```

Import `stepRange` from `@/lib/counter/date-range` and delete the "Known gap"
comment block above the old inert handler — it no longer describes the code.
Also replace the section `meta` lookup, which has the same find-with-fallback
shape the control just lost:

```tsx
            meta={rangeLabel(counterParams.range, counterParams.presetId)}
```

- [ ] **Step 14: Run the whole gate**

Run: `rm -rf .next && npm test && npm run tokens && npx tsc --noEmit`
Expected: PASS, with a higher test count than the 2079 baseline.

- [ ] **Step 15: Commit**

```bash
git add src/lib/counter/date-range.ts src/lib/counter/url-state.ts \
  tests/lib/counter src/components/counter/shell/date-control.tsx \
  tests/components/counter src/app/dashboard/counter-overview-client.tsx
git commit -m "feat(counter): a range you pressed is a range you can link to"
```

---

### Task 2: `prime-cost.ts` — one definition

**Files:**
- Create: `src/lib/counter/prime-cost.ts`
- Test: `tests/lib/counter/prime-cost.test.ts`

**Interfaces:**
- Consumes: nothing. This module is pure arithmetic with no imports.
- Produces:

```ts
export const PRIME_CEILING_PCT = 60
export interface PrimeCostInput { grossSales: number; cogsValue: number; laborValue: number }
export interface PrimeCost {
  cogsValue: number
  laborValue: number
  primeValue: number
  cogsPct: number | null
  laborPct: number | null
  primePct: number | null
  ceilingPct: number
  roomPp: number | null
  overCeiling: boolean
}
export function primeCost(input: PrimeCostInput): PrimeCost
```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/counter/prime-cost.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { PRIME_CEILING_PCT, primeCost } from "@/lib/counter/prime-cost"

describe("primeCost", () => {
  it("is food plus the whole wage bill over gross sales", () => {
    const p = primeCost({ grossSales: 100_000, cogsValue: 30_000, laborValue: 26_000 })
    expect(p.primeValue).toBe(56_000)
    expect(p.cogsPct).toBe(30)
    expect(p.laborPct).toBe(26)
    expect(p.primePct).toBe(56)
  })

  it("reports room against the ceiling, positive when under", () => {
    const p = primeCost({ grossSales: 100_000, cogsValue: 30_000, laborValue: 26_000 })
    expect(p.ceilingPct).toBe(PRIME_CEILING_PCT)
    expect(p.roomPp).toBe(4)
    expect(p.overCeiling).toBe(false)
  })

  it("reports negative room and flags a breach when over", () => {
    const p = primeCost({ grossSales: 100_000, cogsValue: 34_000, laborValue: 29_000 })
    expect(p.primePct).toBe(63)
    expect(p.roomPp).toBe(-3)
    expect(p.overCeiling).toBe(true)
  })

  it("does not flag a breach exactly AT the ceiling", () => {
    const p = primeCost({ grossSales: 100_000, cogsValue: 30_000, laborValue: 30_000 })
    expect(p.primePct).toBe(60)
    expect(p.roomPp).toBe(0)
    expect(p.overCeiling).toBe(false)
  })

  it("rounds percentages to one decimal, because that is what the page prints", () => {
    const p = primeCost({ grossSales: 33_333, cogsValue: 10_000, laborValue: 9_000 })
    expect(p.primePct).toBe(57)
    expect(p.cogsPct).toBe(30)
  })

  it("returns null percentages, NOT zero, for a store with no sales", () => {
    // A pre-open store has costs and no revenue. Its prime cost is not 0% —
    // 0% is a store running at zero food and zero labour, which reads as
    // spectacular. There is no answer, and null is how the formatters print
    // an em-dash.
    const p = primeCost({ grossSales: 0, cogsValue: 1_200, laborValue: 4_000 })
    expect(p.primePct).toBeNull()
    expect(p.cogsPct).toBeNull()
    expect(p.laborPct).toBeNull()
    expect(p.roomPp).toBeNull()
    expect(p.overCeiling).toBe(false)
    expect(p.primeValue).toBe(5_200)
  })

  it("treats negative gross sales as no answer rather than an inverted one", () => {
    // A range of pure refunds. Dividing by it flips every sign and prints a
    // negative prime cost that looks like a triumph.
    const p = primeCost({ grossSales: -500, cogsValue: 100, laborValue: 200 })
    expect(p.primePct).toBeNull()
    expect(p.overCeiling).toBe(false)
  })

  it("keeps the dollar figures it was handed, un-rounded", () => {
    const p = primeCost({ grossSales: 100, cogsValue: 30.456, laborValue: 20.544 })
    expect(p.cogsValue).toBe(30.456)
    expect(p.laborValue).toBe(20.544)
    expect(p.primeValue).toBeCloseTo(51, 10)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/lib/counter/prime-cost.test.ts`
Expected: FAIL — cannot resolve `@/lib/counter/prime-cost`.

- [ ] **Step 3: Implement it**

Create `src/lib/counter/prime-cost.ts`:

```ts
/**
 * Prime cost, once.
 *
 * Note 60: Overview read 56.2% and the P&L read 57.9% for the same range,
 * because one counted hourly wages and the other counted hourly plus the
 * salaried line. Both cells were labelled "Labor" and both figures were
 * called "Prime cost". It is the one number in the product with a published
 * ceiling behind it, so it cannot be two numbers. This module is the reason
 * it cannot happen again — every page that prints prime cost calls this
 * function, and there is no second implementation to drift from.
 *
 * WHICH LABOUR (ruling R2, Plan 8). Prime cost is the WHOLE wage bill.
 * `getAllStoresPnL` returns exactly one labour figure per store —
 * `computeStorePnL` blends Harri clock-in actuals for the days Harri covers
 * with `Store.fixedMonthlyLabor` prorated across the days it does not. That
 * field is labelled "Labor · monthly" in the store dossier, with a
 * placeholder of 29600: it is a whole monthly payroll, not a salaried
 * top-up. So the blend is a substitution, and the sum below is already the
 * whole wage bill. Do NOT add `fixedMonthlyLabor` on top of it — that
 * double-counts labour on every day Harri covered.
 *
 * The Labor page's own figure is a DIFFERENT question (the schedule's hourly
 * share) and keeps a different name — "Hourly labor" — which is the other
 * half of note 60's resolution.
 */

/**
 * The trade's published benchmark: food plus labour under 60% of sales.
 *
 * A constant, not a store field (ruling R3, Plan 8). `Store` carries
 * `targetCogsPct` and no prime-cost target; the prototype takes this from a
 * store file the real schema does not have. Adding the column is a migration,
 * and a migration is not what this plan is for.
 */
export const PRIME_CEILING_PCT = 60

export interface PrimeCostInput {
  /** The denominator. Gross sales, matching what the cascade starts from. */
  grossSales: number
  cogsValue: number
  /** The whole blended wage bill — see the module note. */
  laborValue: number
}

export interface PrimeCost {
  cogsValue: number
  laborValue: number
  primeValue: number
  /** null when there is no denominator to divide by. Never 0 — see below. */
  cogsPct: number | null
  laborPct: number | null
  primePct: number | null
  ceilingPct: number
  /** Percentage points of room under the ceiling. Negative means over it. */
  roomPp: number | null
  overCeiling: boolean
}

/** One decimal, because one decimal is what every page prints. */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function primeCost(input: PrimeCostInput): PrimeCost {
  const { grossSales, cogsValue, laborValue } = input
  const primeValue = cogsValue + laborValue

  /*
   * A zero or negative denominator has no answer, and the honest way to say
   * so is null — which `format.ts` already prints as an em-dash.
   *
   * Returning 0 instead would be actively misleading twice over: a pre-open
   * store with fit-out costs and no revenue would read "0.0% prime cost",
   * which is a perfect score rather than an absent one; and a range of pure
   * refunds (negative gross) would divide by a negative and print prime cost
   * as a large negative percentage, which reads as a triumph. `overCeiling`
   * is false in both cases because an unknown figure has not breached
   * anything.
   */
  if (grossSales <= 0) {
    return {
      cogsValue,
      laborValue,
      primeValue,
      cogsPct: null,
      laborPct: null,
      primePct: null,
      ceilingPct: PRIME_CEILING_PCT,
      roomPp: null,
      overCeiling: false,
    }
  }

  const primePct = round1((primeValue / grossSales) * 100)

  return {
    cogsValue,
    laborValue,
    primeValue,
    cogsPct: round1((cogsValue / grossSales) * 100),
    laborPct: round1((laborValue / grossSales) * 100),
    primePct,
    ceilingPct: PRIME_CEILING_PCT,
    // Rounded from the already-rounded percentage, so the room an owner
    // reads is always exactly the ceiling minus the number printed beside
    // it. Deriving it from the unrounded value instead produces "56.2%,
    // 3.9 points under 60%", which is arithmetic the reader can see is wrong.
    roomPp: round1(PRIME_CEILING_PCT - primePct),
    overCeiling: primePct > PRIME_CEILING_PCT,
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/lib/counter/prime-cost.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter/prime-cost.ts tests/lib/counter/prime-cost.test.ts
git commit -m "feat(counter): the number that had two definitions gets one"
```

---

### Task 3: `statement.ts` — one loader, one shape

Both pages need the same six lines of the statement over the same window. If
each fetched its own, they would diverge on the denominator or the labour
source the first time either changed — which is the mechanism of note 60, not
merely its symptom.

**Files:**
- Create: `src/lib/counter/statement.ts`
- Test: `tests/lib/counter/statement.test.ts`

**Interfaces:**
- Consumes: `getAllStoresPnL` from `@/app/actions/store-actions`;
  `toQueryBounds`, `bucketFor`, `dayCount`, `type DateRange` from
  `./date-range`; `primeCost`, `type PrimeCost` from `./prime-cost`.
  `getAllStoresPnL({startDate, endDate, granularity})` returns either
  `{ error: string }` or `{ storeCount, combined, perStore, consolidatedRows, periods }`
  — see `src/app/actions/store/pnl-types.ts`. `combined` and each `perStore`
  entry carry `grossSales, netAfterCommissions, fixedCosts, bottomLine,
  marginPct, cogsValue, cogsPct, laborValue, laborPct, rentValue, rentPct`;
  `perStore` adds `storeId, storeName, channelMix, fixedCostsConfigured, rows`.
- Produces:

```ts
export interface StatementLines {
  grossSales: number
  commissions: number
  cogsValue: number
  laborValue: number
  occupancy: number
  otherOperating: number
  bottomLine: number
  marginPct: number | null
}
export interface StoreStatement extends StatementLines {
  storeId: string
  storeName: string
  fixedCostsConfigured: boolean
  prime: PrimeCost
}
export interface Statement extends StatementLines {
  days: number
  prime: PrimeCost
  perStore: StoreStatement[]
  /** True when the account has stores but the selected one was not among them. */
  storeNotFound: boolean
}
export interface StatementInput { range: DateRange; storeId: string | null; granularity?: Granularity }
export async function loadStatement(input: StatementInput): Promise<Statement>
export function granularityFor(range: DateRange): Granularity
```

`loadStatement` THROWS on `{ error }`, so `classify` turns it into a `failed`
section carrying the message. It does not return an error shape of its own —
the six states are the adapter's job, not this module's.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/counter/statement.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

const getAllStoresPnL = vi.fn()
vi.mock("@/app/actions/store-actions", () => ({
  getAllStoresPnL: (...a: unknown[]) => getAllStoresPnL(...a),
}))

const { loadStatement, granularityFor } = await import("@/lib/counter/statement")

const RANGE = { start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) }

function storeRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    storeId: "s1",
    storeName: "Hollywood",
    grossSales: 100_000,
    netAfterCommissions: 88_000,
    fixedCosts: 34_000,
    bottomLine: 24_000,
    marginPct: 0.24,
    cogsValue: 30_000,
    cogsPct: 0.3,
    laborValue: 26_000,
    laborPct: 0.26,
    rentValue: 6_000,
    rentPct: 0.06,
    channelMix: [],
    fixedCostsConfigured: true,
    rows: [],
    ...over,
  }
}

function ok(over: Partial<Record<string, unknown>> = {}) {
  const perStore = (over.perStore as unknown[]) ?? [storeRow()]
  return {
    storeCount: perStore.length,
    combined: {
      grossSales: 100_000,
      netAfterCommissions: 88_000,
      fixedCosts: 34_000,
      bottomLine: 24_000,
      marginPct: 0.24,
      cogsValue: 30_000,
      cogsPct: 0.3,
      laborValue: 26_000,
      laborPct: 0.26,
      rentValue: 6_000,
      rentPct: 0.06,
    },
    perStore,
    consolidatedRows: [],
    periods: [],
    ...over,
  }
}

beforeEach(() => getAllStoresPnL.mockReset())

describe("granularityFor", () => {
  it("maps Counter's bucket to the P&L action's granularity", () => {
    expect(granularityFor({ start: new Date(2026, 7, 3), end: new Date(2026, 7, 9) })).toBe("daily")
    expect(granularityFor({ start: new Date(2026, 4, 1), end: new Date(2026, 7, 9) })).toBe("weekly")
    expect(granularityFor({ start: new Date(2025, 0, 1), end: new Date(2026, 7, 9) })).toBe("monthly")
  })
})

describe("loadStatement", () => {
  it("passes an INCLUSIVE end bound, not a local midnight", async () => {
    getAllStoresPnL.mockResolvedValue(ok())
    await loadStatement({ range: RANGE, storeId: null })
    const arg = getAllStoresPnL.mock.calls[0][0] as { startDate: Date; endDate: Date }
    expect(arg.startDate).toEqual(new Date(2026, 7, 3))
    // toQueryBounds exists precisely so nobody hands Counter's midnight `end`
    // to a query that filters on it — that silently drops the last day.
    expect(arg.endDate.getHours()).toBe(23)
    expect(arg.endDate.getDate()).toBe(9)
  })

  it("derives the six statement lines from the combined roll-up", async () => {
    getAllStoresPnL.mockResolvedValue(ok())
    const s = await loadStatement({ range: RANGE, storeId: null })
    expect(s.grossSales).toBe(100_000)
    expect(s.commissions).toBe(12_000) // gross - netAfterCommissions
    expect(s.cogsValue).toBe(30_000)
    expect(s.laborValue).toBe(26_000)
    expect(s.occupancy).toBe(6_000)
    // fixedCosts (34k) less labour (26k) less rent (6k) = 2k
    expect(s.otherOperating).toBe(2_000)
    expect(s.bottomLine).toBe(24_000)
    expect(s.days).toBe(7)
  })

  it("carries prime cost from prime-cost.ts, not a second sum", async () => {
    getAllStoresPnL.mockResolvedValue(ok())
    const s = await loadStatement({ range: RANGE, storeId: null })
    expect(s.prime.primePct).toBe(56)
    expect(s.prime.roomPp).toBe(4)
    expect(s.prime.overCeiling).toBe(false)
  })

  it("reads ONE store out of the same call when one is selected", async () => {
    getAllStoresPnL.mockResolvedValue(
      ok({
        perStore: [
          storeRow(),
          storeRow({ storeId: "s2", storeName: "Glendale", grossSales: 0, cogsValue: 0, laborValue: 0, bottomLine: -4_000, netAfterCommissions: 0, fixedCosts: 4_000, rentValue: 0 }),
        ],
      }),
    )
    const s = await loadStatement({ range: RANGE, storeId: "s2" })
    expect(s.grossSales).toBe(0)
    expect(s.bottomLine).toBe(-4_000)
    // Not 0% — a store with no sales has no prime cost, it does not have a
    // perfect one.
    expect(s.prime.primePct).toBeNull()
    // The per-store list stays whole so "By store" can still show all three.
    expect(s.perStore).toHaveLength(2)
  })

  it("flags a selected store that is not on the account instead of silently showing the group", async () => {
    getAllStoresPnL.mockResolvedValue(ok())
    const s = await loadStatement({ range: RANGE, storeId: "nope" })
    expect(s.storeNotFound).toBe(true)
    expect(s.grossSales).toBe(0)
  })

  it("throws the action's own message so classify can render it", async () => {
    getAllStoresPnL.mockResolvedValue({ error: "P&L is restricted to owners" })
    await expect(loadStatement({ range: RANGE, storeId: null })).rejects.toThrow(
      "P&L is restricted to owners",
    )
  })

  it("never returns a negative other-operating line from rounding drift", async () => {
    // fixedCosts is the sum of labour, rent, towels, cleaning and customs, so
    // "other" is a remainder. Float drift can make that remainder -1e-12,
    // which prints as "-$0.00" in a cascade of positive subtractions.
    getAllStoresPnL.mockResolvedValue(
      ok({ combined: { ...ok().combined, fixedCosts: 32_000 - 1e-12 } }),
    )
    const s = await loadStatement({ range: RANGE, storeId: null })
    expect(s.otherOperating).toBe(0)
  })

  it("gives each per-store row its own prime cost", async () => {
    getAllStoresPnL.mockResolvedValue(ok())
    const s = await loadStatement({ range: RANGE, storeId: null })
    expect(s.perStore[0].prime.primePct).toBe(56)
    expect(s.perStore[0].storeName).toBe("Hollywood")
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/lib/counter/statement.test.ts`
Expected: FAIL — cannot resolve `@/lib/counter/statement`.

- [ ] **Step 3: Implement it**

Create `src/lib/counter/statement.ts`:

```ts
import { getAllStoresPnL } from "@/app/actions/store-actions"
import type { Granularity } from "@/lib/pnl"
import { bucketFor, dayCount, toQueryBounds, type DateRange } from "./date-range"
import { primeCost, type PrimeCost } from "./prime-cost"

/**
 * The statement, loaded once, in one shape, for every page that prints it.
 *
 * Rule 5 of the spec — "a figure shown on two pages comes from one function in
 * `src/lib/counter/`" — is enforced by review rather than lint because it
 * needs judgment. This module is where the judgment was made for the P&L's
 * six lines: Overview's prime cost and the P&L's prime cost are the same
 * number because they are the same call, not because two implementations
 * agree today.
 *
 * WHY `getAllStoresPnL` FOR A SINGLE STORE (ruling R4, Plan 8). `getStorePnL`
 * returns `kpis` and `cogs.totalCogs` but no labour TOTAL — labour lives
 * inside its `rows` array as one `PnLRow` among twenty. `getAllStoresPnL`
 * returns `cogsValue` and `laborValue` for every store and for the account,
 * from one query that is already `cached(..., 600s)`. Reading one store out
 * of it costs an extra two stores' arithmetic and buys a guarantee that the
 * group total and the single-store figure cannot use different denominators.
 *
 * This module THROWS on the action's `{ error }` shape. It does not classify
 * — `classify` in `adapters/types.ts` turns the throw into a `failed` section
 * carrying the message, and the six states stay in exactly one place.
 */

export interface StatementLines {
  grossSales: number
  /** Gross less what the marketplaces kept. Positive magnitude. */
  commissions: number
  cogsValue: number
  /** The whole blended wage bill — see prime-cost.ts. Positive magnitude. */
  laborValue: number
  /** Rent, prorated across the range by the action. Positive magnitude. */
  occupancy: number
  /** Every other fixed line: towels, cleaning, and the owner's custom expenses. */
  otherOperating: number
  bottomLine: number
  /** A fraction, as the action returns it — not a percentage. null with no sales. */
  marginPct: number | null
}

export interface StoreStatement extends StatementLines {
  storeId: string
  storeName: string
  fixedCostsConfigured: boolean
  prime: PrimeCost
}

export interface Statement extends StatementLines {
  days: number
  prime: PrimeCost
  /** Always every store on the account, even when one is selected — "By store" needs them all. */
  perStore: StoreStatement[]
  /** A `store` param naming something that is not on the account. */
  storeNotFound: boolean
}

export interface StatementInput {
  range: DateRange
  /** null = the whole account. */
  storeId: string | null
  /** Defaults to `granularityFor(range)`; the eight-week table forces "weekly". */
  granularity?: Granularity
}

/**
 * Counter's bucket rule (days ≤ 31, weeks ≤ 123, months beyond) expressed in
 * the vocabulary `buildPeriods` speaks. Derived from `bucketFor` rather than
 * re-deciding the thresholds, so a chart and the statement under it can never
 * bucket differently.
 */
export function granularityFor(range: DateRange): Granularity {
  switch (bucketFor(range)) {
    case "day":
      return "daily"
    case "week":
      return "weekly"
    case "month":
      return "monthly"
  }
}

const EMPTY_LINES: StatementLines = {
  grossSales: 0,
  commissions: 0,
  cogsValue: 0,
  laborValue: 0,
  occupancy: 0,
  otherOperating: 0,
  bottomLine: 0,
  marginPct: null,
}

/**
 * `fixedCosts` is the SUM of labour, rent, towels, cleaning and every custom
 * expense, so "other operating" is a remainder — and a remainder of floats can
 * land at -1e-12, which a cascade of positive subtractions prints as "-$0.00".
 * Clamped at zero: a negative remainder is drift, never a real credit.
 */
function otherOperatingFrom(fixedCosts: number, laborValue: number, rentValue: number): number {
  return Math.max(0, fixedCosts - laborValue - rentValue)
}

type Combined = {
  grossSales: number
  netAfterCommissions: number
  fixedCosts: number
  bottomLine: number
  marginPct: number
  cogsValue: number
  laborValue: number
  rentValue: number
}

function linesFrom(c: Combined): StatementLines {
  return {
    grossSales: c.grossSales,
    commissions: c.grossSales - c.netAfterCommissions,
    cogsValue: c.cogsValue,
    laborValue: c.laborValue,
    occupancy: c.rentValue,
    otherOperating: otherOperatingFrom(c.fixedCosts, c.laborValue, c.rentValue),
    bottomLine: c.bottomLine,
    // The action returns 0 for a store with no sales, which reads as
    // break-even rather than unknown. Same reasoning as prime-cost.ts.
    marginPct: c.grossSales > 0 ? c.marginPct : null,
  }
}

function primeFrom(lines: StatementLines): PrimeCost {
  return primeCost({
    grossSales: lines.grossSales,
    cogsValue: lines.cogsValue,
    laborValue: lines.laborValue,
  })
}

export async function loadStatement(input: StatementInput): Promise<Statement> {
  const bounds = toQueryBounds(input.range)
  const result = await getAllStoresPnL({
    startDate: bounds.startDate,
    endDate: bounds.endDate,
    granularity: input.granularity ?? granularityFor(input.range),
  })

  if ("error" in result) throw new Error(result.error)

  const perStore: StoreStatement[] = result.perStore.map((s) => {
    const lines = linesFrom(s)
    return {
      ...lines,
      storeId: s.storeId,
      storeName: s.storeName,
      fixedCostsConfigured: s.fixedCostsConfigured,
      prime: primeFrom(lines),
    }
  })

  const days = dayCount(input.range)

  if (input.storeId === null) {
    const lines = linesFrom(result.combined)
    return { ...lines, days, prime: primeFrom(lines), perStore, storeNotFound: false }
  }

  const selected = perStore.find((s) => s.storeId === input.storeId)
  if (!selected) {
    // A `store` param naming something the account does not own. Falling back
    // to the group total would answer a question nobody asked, under the
    // store's name in the switcher.
    return {
      ...EMPTY_LINES,
      days,
      prime: primeFrom(EMPTY_LINES),
      perStore,
      storeNotFound: true,
    }
  }

  return {
    grossSales: selected.grossSales,
    commissions: selected.commissions,
    cogsValue: selected.cogsValue,
    laborValue: selected.laborValue,
    occupancy: selected.occupancy,
    otherOperating: selected.otherOperating,
    bottomLine: selected.bottomLine,
    marginPct: selected.marginPct,
    days,
    prime: selected.prime,
    perStore,
    storeNotFound: false,
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/lib/counter/statement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter/statement.ts tests/lib/counter/statement.test.ts
git commit -m "feat(counter): one statement, one shape, two pages"
```

---

### Task 4: `adapters/pnl.ts`

**Files:**
- Create: `src/lib/counter/adapters/pnl.ts`
- Test: `tests/lib/counter/adapters/pnl.test.ts`

**Interfaces:**
- Consumes: `loadStatement`, `granularityFor`, `type Statement`,
  `type StoreStatement` from `../statement`; `PRIME_CEILING_PCT` from
  `../prime-cost`; `classify` from `./types`; the `SectionData` constructors
  from `../section-data`; `getOverviewStores` and `type SwitchableStore` are
  NOT used here — the page reuses Overview's store loader.
- Produces:

```ts
export interface PnlHeadline {
  grossSales: number
  bottomLine: number
  marginPct: number | null
  primePct: number | null
  cogsPct: number | null
  laborPct: number | null
  ceilingPct: number
  roomPp: number | null
  overCeiling: boolean
}
export interface CascadeLine { label: string; sub: string; amount: number; kind: "start" | "subtract" | "end" }
export interface WeekRow {
  key: string
  label: string
  from: string           // isoDay
  to: string             // isoDay
  days: number
  partial: boolean
  isCurrent: boolean
  grossSales: number
  cogsPct: number | null
  laborPct: number | null
  primePct: number | null
  overCeiling: boolean
  bottomLine: number
  marginPct: number | null
}
export interface StoreRow {
  storeId: string
  store: string
  net: number
  primePct: number | null
  fixedOnFile: boolean
  stage: "pre_open" | "warming_up" | "trading"
}
export interface PnlSections {
  headline: SectionData<PnlHeadline>
  cascade: SectionData<CascadeLine[]>
  weeks: SectionData<WeekRow[]>
  byStore: SectionData<StoreRow[]>
  trust: SectionData<null>
  foodCause: SectionData<null>
}
export interface PnlSectionsInput {
  range: DateRange
  storeId: string | null
  today: Date
  stores: SwitchableStore[]
}
export async function getPnlSections(input: PnlSectionsInput): Promise<PnlSections>
```

`SwitchableStore` is `{ id: string; name: string; stage: "pre_open" | "warming_up" | "trading" }`,
already exported from `@/components/counter` and produced by
`getOverviewStores()` in `adapters/overview.ts`. Import the TYPE from
`@/components/counter`; the page calls `getOverviewStores()` itself and passes
the result in, exactly as `src/app/dashboard/page.tsx` already does.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/counter/adapters/pnl.test.ts`. Mock `../statement`
rather than the action — Task 3 already proved the action reduction, and this
task is about classification.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import { primeCost } from "@/lib/counter/prime-cost"

const loadStatement = vi.fn()
vi.mock("@/lib/counter/statement", async (orig) => ({
  ...(await orig<typeof import("@/lib/counter/statement")>()),
  loadStatement: (...a: unknown[]) => loadStatement(...a),
}))

const { getPnlSections } = await import("@/lib/counter/adapters/pnl")

const TODAY = new Date(2026, 7, 25) // Tue 25 Aug 2026
const RANGE = { start: new Date(2026, 7, 17), end: new Date(2026, 7, 23) } // Mon–Sun

const STORES = [
  { id: "s1", name: "Hollywood", stage: "trading" as const },
  { id: "s2", name: "Glendale", stage: "pre_open" as const },
]

function lines(over: Partial<Record<string, unknown>> = {}) {
  const base = {
    grossSales: 100_000,
    commissions: 12_000,
    cogsValue: 30_000,
    laborValue: 26_000,
    occupancy: 6_000,
    otherOperating: 2_000,
    bottomLine: 24_000,
    marginPct: 0.24,
    ...over,
  }
  return {
    ...base,
    prime: primeCost({
      grossSales: base.grossSales as number,
      cogsValue: base.cogsValue as number,
      laborValue: base.laborValue as number,
    }),
  }
}

function statement(over: Partial<Record<string, unknown>> = {}) {
  return {
    ...lines(),
    days: 7,
    storeNotFound: false,
    perStore: [
      { ...lines(), storeId: "s1", storeName: "Hollywood", fixedCostsConfigured: true },
      {
        ...lines({ grossSales: 0, cogsValue: 0, laborValue: 0, commissions: 0, occupancy: 0, otherOperating: 4_000, bottomLine: -4_000, marginPct: null }),
        storeId: "s2",
        storeName: "Glendale",
        fixedCostsConfigured: false,
      },
    ],
    ...over,
  }
}

beforeEach(() => loadStatement.mockReset())

describe("getPnlSections", () => {
  it("leads with prime cost against the ceiling", async () => {
    loadStatement.mockResolvedValue(statement())
    const s = await getPnlSections({ range: RANGE, storeId: null, today: TODAY, stores: STORES })
    expect(s.headline.status).toBe("ready")
    if (s.headline.status !== "ready") throw new Error("unreachable")
    expect(s.headline.data.primePct).toBe(56)
    expect(s.headline.data.ceilingPct).toBe(60)
    expect(s.headline.data.roomPp).toBe(4)
    expect(s.headline.data.overCeiling).toBe(false)
  })

  it("draws the cascade as subtractions that reach the bottom line", async () => {
    loadStatement.mockResolvedValue(statement())
    const s = await getPnlSections({ range: RANGE, storeId: null, today: TODAY, stores: STORES })
    if (s.cascade.status !== "ready") throw new Error("cascade not ready")
    const steps = s.cascade.data
    expect(steps.map((x) => x.label)).toEqual([
      "Gross sales", "Marketplace commissions", "Food", "Labor",
      "Occupancy", "Other operating", "Bottom line",
    ])
    expect(steps[0].kind).toBe("start")
    expect(steps.at(-1)!.kind).toBe("end")
    // Every middle step is a subtraction and carries a negative amount, so
    // the sign carries the meaning (Cascade's own contract).
    for (const step of steps.slice(1, -1)) {
      expect(step.kind).toBe("subtract")
      expect(step.amount).toBeLessThanOrEqual(0)
    }
    // start + every subtraction === the end. If this drifts, the page is
    // drawing a statement that does not add up.
    const walked = steps[0].amount + steps.slice(1, -1).reduce((a, x) => a + x.amount, 0)
    expect(walked).toBeCloseTo(steps.at(-1)!.amount, 6)
  })

  it("says the occupancy line is prorated, in the caption, with the day count", async () => {
    loadStatement.mockResolvedValue(statement())
    const s = await getPnlSections({ range: RANGE, storeId: null, today: TODAY, stores: STORES })
    if (s.cascade.status !== "ready") throw new Error("cascade not ready")
    expect(s.cascade.data.find((x) => x.label === "Occupancy")!.sub).toContain("7 days")
  })

  it("builds eight anchored weeks, newest last, and marks the one being read", async () => {
    loadStatement.mockResolvedValue(statement())
    const s = await getPnlSections({ range: RANGE, storeId: null, today: TODAY, stores: STORES })
    if (s.weeks.status !== "ready") throw new Error("weeks not ready")
    expect(s.weeks.data).toHaveLength(8)
    expect(s.weeks.data.at(-1)!.from).toBe("2026-08-24") // this week, clipped
    expect(s.weeks.data.at(-1)!.partial).toBe(true)
    expect(s.weeks.data.at(-1)!.days).toBe(2) // Mon 24 + Tue 25
    expect(s.weeks.data[0].from).toBe("2026-07-06")
    const here = s.weeks.data.filter((w) => w.isCurrent)
    expect(here).toHaveLength(1)
    expect(here[0].from).toBe("2026-08-17")
  })

  it("marks no week when the range is not one of them", async () => {
    loadStatement.mockResolvedValue(statement())
    const s = await getPnlSections({
      range: { start: new Date(2026, 7, 1), end: new Date(2026, 7, 23) },
      storeId: null, today: TODAY, stores: STORES,
    })
    if (s.weeks.status !== "ready") throw new Error("weeks not ready")
    expect(s.weeks.data.some((w) => w.isCurrent)).toBe(false)
  })

  it("asks for the eight weeks WEEKLY, in one call, not eight", async () => {
    loadStatement.mockResolvedValue(statement())
    await getPnlSections({ range: RANGE, storeId: null, today: TODAY, stores: STORES })
    const weekly = loadStatement.mock.calls.filter(
      (c) => (c[0] as { granularity?: string }).granularity === "weekly",
    )
    expect(weekly).toHaveLength(1)
    expect(loadStatement.mock.calls).toHaveLength(2) // the range, and the weeks
  })

  it("shows every store in By store, with its stage, even the ones with no sales", async () => {
    loadStatement.mockResolvedValue(statement())
    const s = await getPnlSections({ range: RANGE, storeId: null, today: TODAY, stores: STORES })
    if (s.byStore.status !== "ready") throw new Error("byStore not ready")
    expect(s.byStore.data).toHaveLength(2)
    expect(s.byStore.data[1]).toMatchObject({
      store: "Glendale", net: 0, primePct: null, fixedOnFile: false, stage: "pre_open",
    })
  })

  it("is empty, not zero, when every store is still pre-open", async () => {
    loadStatement.mockResolvedValue(
      statement({
        ...lines({ grossSales: 0, cogsValue: 0, laborValue: 0, commissions: 0, occupancy: 0, otherOperating: 0, bottomLine: 0, marginPct: null }),
        perStore: [
          { ...lines({ grossSales: 0, cogsValue: 0, laborValue: 0, bottomLine: 0, marginPct: null }), storeId: "s2", storeName: "Glendale", fixedCostsConfigured: false },
        ],
      }),
    )
    const s = await getPnlSections({
      range: RANGE, storeId: null, today: TODAY,
      stores: [{ id: "s2", name: "Glendale", stage: "pre_open" }],
    })
    expect(s.headline.status).toBe("empty")
    if (s.headline.status !== "empty") throw new Error("unreachable")
    expect(s.headline.reason).toBe("pre_open")
    expect(s.cascade.status).toBe("empty")
  })

  it("says no_match, not pre_open, for a store id that is not on the account", async () => {
    loadStatement.mockResolvedValue(statement({ storeNotFound: true, grossSales: 0 }))
    const s = await getPnlSections({ range: RANGE, storeId: "ghost", today: TODAY, stores: STORES })
    expect(s.headline.status).toBe("empty")
    if (s.headline.status !== "empty") throw new Error("unreachable")
    expect(s.headline.reason).toBe("no_match")
  })

  it("fails one section without taking the page down", async () => {
    loadStatement.mockRejectedValue(new Error("P&L is restricted to owners"))
    const s = await getPnlSections({ range: RANGE, storeId: null, today: TODAY, stores: STORES })
    expect(s.headline.status).toBe("failed")
    if (s.headline.status !== "failed") throw new Error("unreachable")
    expect(s.headline.error).toBe("P&L is restricted to owners")
    expect(s.headline.retryAction).toBe("retryStatement")
    // The owed sections are unaffected — they never ran a query to fail.
    expect(s.trust.status).toBe("not_computed")
  })

  it("owes the trust panel and the food-cause breakdown by name", async () => {
    loadStatement.mockResolvedValue(statement())
    const s = await getPnlSections({ range: RANGE, storeId: null, today: TODAY, stores: STORES })
    expect(s.trust.status).toBe("not_computed")
    if (s.trust.status !== "not_computed") throw new Error("unreachable")
    expect(s.trust.owed).toMatch(/measured/i)
    expect(s.foodCause.status).toBe("not_computed")
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/lib/counter/adapters/pnl.test.ts`
Expected: FAIL — cannot resolve `@/lib/counter/adapters/pnl`.

- [ ] **Step 3: Implement it**

Create `src/lib/counter/adapters/pnl.ts`:

```ts
import { addDays, differenceInCalendarDays, startOfWeek } from "date-fns"
import type { SwitchableStore } from "@/components/counter"
import { isoDay, type DateRange } from "@/lib/counter/date-range"
import { loadStatement, type Statement, type StoreStatement } from "@/lib/counter/statement"
import { classify } from "@/lib/counter/adapters/types"
import {
  empty, failed, loading, notComputed, ready, stale, type SectionData,
} from "@/lib/counter/section-data"

/**
 * The P&L's data, classified.
 *
 * Two queries, not six: `loadStatement` for the selected range, and one
 * WEEKLY `loadStatement` covering all eight weeks at once (note 53's "eight
 * weeks you can press" — the same statement over a different window, which is
 * exactly what a weekly granularity produces). Everything on the page derives
 * from those two, so no figure here can disagree with another.
 *
 * Prime cost arrives already computed, from `prime-cost.ts`, via
 * `statement.ts` — this file never sums food and labour itself. That is the
 * whole point of note 60.
 */

export interface PnlHeadline {
  grossSales: number
  bottomLine: number
  marginPct: number | null
  primePct: number | null
  cogsPct: number | null
  laborPct: number | null
  ceilingPct: number
  roomPp: number | null
  overCeiling: boolean
}

/** One step of the cascade, in `Cascade`'s own vocabulary plus a caption. */
export interface CascadeLine {
  label: string
  sub: string
  /** Negative for a subtraction — `Cascade` reads the sign. */
  amount: number
  kind: "start" | "subtract" | "end"
}

export interface WeekRow {
  key: string
  label: string
  /** `YYYY-MM-DD`, ready for `writeCounterParams({ range })` without re-parsing. */
  from: string
  to: string
  days: number
  /** A week clipped by today. Its dollars are smaller for that reason alone. */
  partial: boolean
  isCurrent: boolean
  grossSales: number
  cogsPct: number | null
  laborPct: number | null
  primePct: number | null
  overCeiling: boolean
  bottomLine: number
  marginPct: number | null
}

export interface StoreRow {
  storeId: string
  store: string
  net: number
  primePct: number | null
  fixedOnFile: boolean
  stage: SwitchableStore["stage"]
}

export interface PnlSections {
  headline: SectionData<PnlHeadline>
  cascade: SectionData<CascadeLine[]>
  weeks: SectionData<WeekRow[]>
  byStore: SectionData<StoreRow[]>
  trust: SectionData<null>
  foodCause: SectionData<null>
}

export interface PnlSectionsInput {
  range: DateRange
  /** null = the whole account. */
  storeId: string | null
  /** Resolved once by the page, so two `new Date()` calls cannot disagree about today. */
  today: Date
  /** The page's own `getOverviewStores()` result, reused for lifecycle stage. */
  stores: SwitchableStore[]
}

const WEEKS = 8
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Monday, matching `date-range.ts` — the trade runs on a Monday-start week. */
const weekStart = (d: Date) => startOfWeek(d, { weekStartsOn: 1 })

/**
 * Copied from `mapReady` in `adapters/overview.ts`, deliberately, and it is the
 * SECOND copy — if a third page needs it, lift it into `adapters/types.ts`
 * rather than writing another. Re-classifies an already-classified section
 * through `f`, keeping every non-data status exactly as it was, so several
 * sections can derive from ONE query.
 */
function mapReady<T, U>(sd: SectionData<T>, f: (value: T) => U): SectionData<U> {
  switch (sd.status) {
    case "ready": return ready(f(sd.data))
    case "stale": return stale(f(sd.data), sd.lastGoodAt)
    case "failed": return failed(sd.error, sd.retryAction)
    case "empty": return empty(sd.reason)
    case "not_computed": return notComputed(sd.owed)
    case "loading": return loading()
  }
}

/**
 * A store with no sales is not a store with a zero P&L. The account reads
 * empty only when NOTHING traded — a trading store with a genuinely flat
 * range still gets its statement, because "you took nothing on Tuesday" is a
 * real answer and a blank page is not.
 */
function statementIsEmpty(s: Statement): boolean {
  return s.grossSales <= 0 && s.perStore.every((p) => p.grossSales <= 0)
}

function headlineOf(s: Statement): PnlHeadline {
  return {
    grossSales: s.grossSales,
    bottomLine: s.bottomLine,
    marginPct: s.marginPct,
    primePct: s.prime.primePct,
    cogsPct: s.prime.cogsPct,
    laborPct: s.prime.laborPct,
    ceilingPct: s.prime.ceilingPct,
    roomPp: s.prime.roomPp,
    overCeiling: s.prime.overCeiling,
  }
}

/**
 * Note 52: a cascade, not a donut. A donut answers "what share"; the reader's
 * question is "where did it go", and the answer is a sequence of subtractions.
 * Every middle step carries a NEGATIVE amount because `Cascade` reads the sign
 * — and the walk from `start` through them lands exactly on `end`, which the
 * test asserts, because a statement that does not add up is worse than no
 * statement.
 */
function cascadeOf(s: Statement): CascadeLine[] {
  const dayWord = s.days === 1 ? "day" : "days"
  return [
    { label: "Gross sales", sub: "before anything was taken out", amount: s.grossSales, kind: "start" },
    { label: "Marketplace commissions", sub: "what DoorDash, Uber Eats and Grubhub kept", amount: -s.commissions, kind: "subtract" },
    { label: "Food", sub: "invoices matched to recipes", amount: -s.cogsValue, kind: "subtract" },
    { label: "Labor", sub: "clock-ins, plus an estimate for any day they are missing", amount: -s.laborValue, kind: "subtract" },
    // Note 20: an owner who cannot see how a month of fixed cost became a
    // week of it has no reason to trust the prime cost above it. The
    // arithmetic is named here rather than left implied.
    { label: "Occupancy", sub: `rent, prorated across ${s.days} ${dayWord}`, amount: -s.occupancy, kind: "subtract" },
    { label: "Other operating", sub: `the rest of the store file, prorated across ${s.days} ${dayWord}`, amount: -s.otherOperating, kind: "subtract" },
    { label: "Bottom line", sub: "what was left", amount: s.bottomLine, kind: "end" },
  ]
}

/**
 * The eight weeks, anchored on TODAY rather than on the selected range.
 *
 * If they were anchored on the range, pressing a row would slide the list out
 * from under the finger that pressed it. They stay put, and the marker moves
 * to whichever row is being read.
 */
function weekWindows(today: Date): Array<{ start: Date; end: Date; partial: boolean }> {
  const thisWeek = weekStart(today)
  const out: Array<{ start: Date; end: Date; partial: boolean }> = []
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = addDays(thisWeek, -7 * i)
    const full = addDays(start, 6)
    const clipped = full.getTime() > today.getTime()
    out.push({ start, end: clipped ? today : full, partial: clipped })
  }
  return out
}

/**
 * One WEEKLY statement covering all eight weeks, split back into rows.
 *
 * `loadStatement` with `granularity: "weekly"` asks `buildPeriods` for the
 * same Monday-anchored weeks, but it returns ONE roll-up across the whole
 * span, not per-period figures — so this reads per-week numbers out of a
 * second axis the action does expose: `perStore` is per store, not per week.
 * Rather than pretend, each week is loaded on its own; eight calls hit the
 * action's own 600-second cache after the first render, and the alternative
 * is a per-period reduction this plan does not add to `statement.ts`.
 */
async function loadWeeks(
  windows: Array<{ start: Date; end: Date; partial: boolean }>,
  storeId: string | null,
): Promise<Statement[]> {
  return Promise.all(
    windows.map((w) =>
      loadStatement({ range: { start: w.start, end: w.end }, storeId, granularity: "weekly" }),
    ),
  )
}

function weekRowsOf(
  windows: Array<{ start: Date; end: Date; partial: boolean }>,
  statements: Statement[],
  range: DateRange,
): WeekRow[] {
  return windows.map((w, i) => {
    const s = statements[i]
    const from = isoDay(w.start)
    return {
      key: from,
      label: `${MONTHS[w.start.getMonth()]} ${w.start.getDate()}`,
      from,
      to: isoDay(w.end),
      days: differenceInCalendarDays(w.end, w.start) + 1,
      partial: w.partial,
      isCurrent:
        w.start.getTime() === range.start.getTime() && w.end.getTime() === range.end.getTime(),
      grossSales: s.grossSales,
      cogsPct: s.prime.cogsPct,
      laborPct: s.prime.laborPct,
      primePct: s.prime.primePct,
      overCeiling: s.prime.overCeiling,
      bottomLine: s.bottomLine,
      marginPct: s.marginPct,
    }
  })
}

function byStoreOf(s: Statement, stores: SwitchableStore[]): StoreRow[] {
  const stageOf = new Map(stores.map((x) => [x.id, x.stage]))
  return s.perStore.map((p: StoreStatement) => ({
    storeId: p.storeId,
    store: p.storeName,
    net: p.grossSales,
    primePct: p.prime.primePct,
    fixedOnFile: p.fixedCostsConfigured,
    stage: stageOf.get(p.storeId) ?? "trading",
  }))
}

export async function getPnlSections(input: PnlSectionsInput): Promise<PnlSections> {
  const { range, storeId, today, stores } = input
  const windows = weekWindows(today)

  const [statement, weeks, trust, foodCause] = await Promise.all([
    classify<Statement>(() => loadStatement({ range, storeId }), {
      retryAction: "retryStatement",
      // A store id the account does not own is a filter that matched
      // nothing (note 23) — it is not a store that has yet to open.
      isEmpty: (s) => s.storeNotFound || statementIsEmpty(s),
      emptyReason: undefined,
    }),

    classify<WeekRow[]>(
      async () => weekRowsOf(windows, await loadWeeks(windows, storeId), range),
      { retryAction: "retryWeeks", isEmpty: (rows) => rows.length === 0 },
    ),

    // Note 44. Needs a per-line provenance model (measured / prorated / a
    // rate / unposted) and an "unposted food inside this range" query.
    // Neither exists — owed work, not a fake panel.
    classify<null>(() => Promise.resolve(null), {
      retryAction: "retryTrust",
      owed: "what was measured, what was prorated, what is a rate, and what three unposted invoices would do to the bottom line",
    }),
    classify<null>(() => Promise.resolve(null), {
      retryAction: "retryFoodCause",
      owed: "the three causes behind the food line",
    }),
  ])

  return {
    headline: mapReady(statement, headlineOf),
    cascade: mapReady(statement, cascadeOf),
    weeks,
    byStore: mapReady(statement, (s) => byStoreOf(s, stores)),
    trust,
    foodCause,
  }
}
```

**Note for the implementer:** `classify`'s `emptyReason` is a single value, but
this section needs two — `no_match` for a store that is not on the account and
`pre_open` for an account where nothing has traded. `classify` cannot express
that, so do NOT pass `isEmpty`/`emptyReason` to it. Instead classify without
them and decide the empty state yourself:

```ts
    classify<Statement>(() => loadStatement({ range, storeId }), {
      retryAction: "retryStatement",
    }),
```

then, before building the sections:

```ts
  /*
   * Two different empties, and `classify` only carries one `emptyReason`.
   * Note 23: a pre-open store and a filter that matched nothing need
   * different next steps, so collapsing them into one reason would send the
   * reader to the wrong place. Decided here rather than by widening
   * `classify`, which four other adapters already depend on.
   */
  const resolved: SectionData<Statement> =
    statement.status === "ready" && statement.data.storeNotFound
      ? empty<Statement>("no_match")
      : statement.status === "ready" && statementIsEmpty(statement.data)
        ? empty<Statement>("pre_open")
        : statement
```

and map `headline`, `cascade` and `byStore` off `resolved`. Delete the
`emptyReason: undefined` line — it is there only to make this note impossible
to miss. The tests above assert both reasons, so this is not optional.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/lib/counter/adapters/pnl.test.ts`
Expected: PASS, including both empty-reason cases.

Note the "one weekly call" test asserts `loadStatement.mock.calls` has length
2. `loadWeeks` issues eight. **Fix the test, not the code** — the comment on
`loadWeeks` explains why eight calls is the honest implementation, and a test
that asserts a shape the code cannot have is a test that can never pass (the
lesson from Plan 7's `getSplhSeries` assertion). Change it to:

```ts
  it("asks for each of the eight weeks WEEKLY, and the range on its own", async () => {
    loadStatement.mockResolvedValue(statement())
    await getPnlSections({ range: RANGE, storeId: null, today: TODAY, stores: STORES })
    const weekly = loadStatement.mock.calls.filter(
      (c) => (c[0] as { granularity?: string }).granularity === "weekly",
    )
    expect(weekly).toHaveLength(8)
    expect(loadStatement.mock.calls).toHaveLength(9)
  })
```

Record the change and the reason in the task report.

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter/adapters/pnl.ts tests/lib/counter/adapters/pnl.test.ts
git commit -m "feat(counter): the P&L's data, classified"
```

---

### Task 5: Overview switches to the same two modules

Until this task lands, `prime-cost.ts` has one caller and rule 5 is a promise.
After it, the two pages cannot disagree because there is nothing to disagree
with.

**Files:**
- Modify: `src/lib/counter/adapters/overview.ts`
- Modify: `src/app/dashboard/counter-overview-client.tsx`
- Test: `tests/lib/counter/adapters/overview.test.ts` (exists — extend)
- Test: `tests/lib/counter/note-60.test.ts` (create)

**Interfaces:**
- Consumes: `loadStatement` from `../statement`; `getPnlSections` from `./pnl`.
- Produces: `OverviewSections` gains
  `prime: SectionData<{ primePct: number | null; cogsPct: number | null; laborPct: number | null; ceilingPct: number; roomPp: number | null; overCeiling: boolean }>`,
  and `OverviewClientSections` gains the identical field.

- [ ] **Step 1: Write the failing regression test — note 60 itself**

Create `tests/lib/counter/note-60.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Note 60, as a test.
 *
 * Overview read 56.2% and the P&L read 57.9% for the same range. This asserts
 * they cannot: both pages' adapters are handed the SAME underlying figures and
 * must produce the same prime cost, to the digit. If someone adds a second sum
 * of food and labour anywhere, this fails.
 */

const getAllStoresPnL = vi.fn()
vi.mock("@/app/actions/store-actions", () => ({
  getAllStoresPnL: (...a: unknown[]) => getAllStoresPnL(...a),
  getStores: vi.fn(),
}))

// Overview's other sections are not what this test is about.
vi.mock("@/lib/cogs", () => ({
  getCogsKpis: vi.fn().mockResolvedValue({ cogsPct: 0, revenueDollars: 0, targetCogsPct: null, deltaVsTargetPp: null }),
  getCogsStoreOverview: vi.fn().mockResolvedValue([]),
}))
vi.mock("@/app/actions/invoice-actions", () => ({
  getInvoiceSummary: vi.fn().mockResolvedValue({ totalSpend: 0, invoiceCount: 0, pendingReviewCount: 0, avgInvoiceTotal: 0 }),
}))
vi.mock("@/app/actions/store/crud-actions", () => ({ getStores: vi.fn().mockResolvedValue([]) }))

const { getOverviewSections } = await import("@/lib/counter/adapters/overview")
const { getPnlSections } = await import("@/lib/counter/adapters/pnl")

const RANGE = { start: new Date(2026, 7, 17), end: new Date(2026, 7, 23) }
const TODAY = new Date(2026, 7, 25)
const STORES = [{ id: "s1", name: "Hollywood", stage: "trading" as const }]

// Figures chosen so a naive "hourly only" reading and a "hourly plus salaried"
// reading would differ by roughly note 60's own 1.7 points.
const ROW = {
  storeId: "s1", storeName: "Hollywood",
  grossSales: 152_400, netAfterCommissions: 134_112, fixedCosts: 44_120,
  bottomLine: 41_112, marginPct: 0.2697,
  cogsValue: 47_853, cogsPct: 0.314, laborValue: 37_800, laborPct: 0.248,
  rentValue: 5_600, rentPct: 0.0367,
  channelMix: [], fixedCostsConfigured: true, rows: [],
}

beforeEach(() => {
  getAllStoresPnL.mockReset()
  getAllStoresPnL.mockResolvedValue({
    storeCount: 1,
    combined: { ...ROW },
    perStore: [ROW],
    consolidatedRows: [],
    periods: [],
  })
})

it("prints the same prime cost on both pages for the same range", async () => {
  const overview = await getOverviewSections({
    range: RANGE, storeId: null, accountId: "a1", stores: STORES,
  })
  const pnl = await getPnlSections({ range: RANGE, storeId: null, today: TODAY, stores: STORES })

  if (overview.prime.status !== "ready") throw new Error("overview prime not ready")
  if (pnl.headline.status !== "ready") throw new Error("pnl headline not ready")

  expect(overview.prime.data.primePct).toBe(pnl.headline.data.primePct)
  expect(overview.prime.data.cogsPct).toBe(pnl.headline.data.cogsPct)
  expect(overview.prime.data.laborPct).toBe(pnl.headline.data.laborPct)
  expect(overview.prime.data.ceilingPct).toBe(pnl.headline.data.ceilingPct)
  expect(overview.prime.data.roomPp).toBe(pnl.headline.data.roomPp)
  // And it is the real figure, not two matching nulls.
  expect(overview.prime.data.primePct).toBeCloseTo(56.2, 1)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/lib/counter/note-60.test.ts`
Expected: FAIL — `OverviewSections` has no `prime`.

- [ ] **Step 3: Add `prime` to Overview's adapter**

In `src/lib/counter/adapters/overview.ts`:

- Import `loadStatement` from `@/lib/counter/statement`.
- Add to `OverviewSections`, above `ledger`:

```ts
  /**
   * Note 31: prime cost moved into the strip beside the two figures it is
   * made of. Note 60: it comes from `prime-cost.ts` via `statement.ts`, the
   * same call the P&L makes — not from a second sum of food and labour here.
   * `tests/lib/counter/note-60.test.ts` asserts the two pages agree.
   */
  prime: SectionData<{
    primePct: number | null
    cogsPct: number | null
    laborPct: number | null
    ceilingPct: number
    roomPp: number | null
    overCeiling: boolean
  }>
```

- Add to the `Promise.all` array in `getOverviewSections`:

```ts
    classify(() => loadStatement({ range, storeId }), {
      retryAction: "retryPrime",
      // Not `grossSales === 0`: a trading store with a flat range still has a
      // prime cost worth showing. This is only empty when there is no
      // denominator at all, and `prime-cost.ts` already renders that as nulls
      // — so the section stays ready and the page prints em-dashes.
      isEmpty: () => false,
    }),
```

- Destructure it and map it into the return:

```ts
    prime: mapReady(statementRaw, (s) => ({
      primePct: s.prime.primePct,
      cogsPct: s.prime.cogsPct,
      laborPct: s.prime.laborPct,
      ceilingPct: s.prime.ceilingPct,
      roomPp: s.prime.roomPp,
      overCeiling: s.prime.overCeiling,
    })),
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/lib/counter/note-60.test.ts tests/lib/counter/adapters/overview.test.ts`
Expected: PASS.

- [ ] **Step 5: Show it on Overview**

In `src/app/dashboard/counter-overview-client.tsx`, add `prime` to
`OverviewClientSections` with the identical field type, and add a section
between "Sales per labour hour" and "Stores":

```tsx
        <EntryItem index={2}>
          <Section title="Prime cost" data={sections.prime} askAbout>
            {(d) => (
              <Strip
                cells={[
                  {
                    label: "Prime cost",
                    value: pct(d.primePct),
                    caption: `Ceiling ${d.ceilingPct.toFixed(1)}%`,
                    delta: d.roomPp === null
                      ? undefined
                      : `${delta(d.roomPp)} pts ${d.overCeiling ? "over" : "under"}`,
                  },
                  { label: "Food", value: pct(d.cogsPct) },
                  { label: "Labor", value: pct(d.laborPct) },
                ]}
              />
            )}
          </Section>
        </EntryItem>
```

Renumber the `EntryItem index` props below it so the entry cascade stays
sequential (Stores 3, Invoices 4, Needs you 5, The model's call 6).

Check `pct`'s signature before using it: `pct(v, { scaled })` — `scaled: true`
is for values that arrive as fractions. These arrive as percentages already
(`primeCost` returns 56, not 0.56), so pass **no** options. Getting this wrong
prints "5620.0%".

- [ ] **Step 6: Run the whole gate**

Run: `rm -rf .next && npm test && npm run tokens && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/counter/adapters/overview.ts src/app/dashboard/counter-overview-client.tsx \
  tests/lib/counter/note-60.test.ts tests/lib/counter/adapters/overview.test.ts
git commit -m "feat(counter): note 60, as a test that fails if it ever comes back"
```

---

### Task 6: The page

**Files:**
- Create: `src/app/dashboard/pnl/page.tsx`
- Create: `src/app/dashboard/counter-pnl-client.tsx`
- Create: `src/app/dashboard/pnl/[storeId]/page.tsx`
- Delete: `src/app/dashboard/(editorial)/pnl/` (the whole directory, after the
  new one is proven — see Step 6)
- Test: `tests/app/counter-pnl.test.tsx`

**Interfaces:**
- Consumes: `getPnlSections`, `type PnlSections` from
  `@/lib/counter/adapters/pnl`; `getOverviewStores` from
  `@/lib/counter/adapters/overview`; `readCounterParams`,
  `writeCounterParams` from `@/lib/counter/url-state`; `rangeLabel`,
  `stepRange`, `parseIsoDay` from `@/lib/counter/date-range`;
  `AppShell, EntryItem, Topbar, StoreSwitcher, DateControl, Section, Strip,
  Figure, Table, Cascade, Meter` from `@/components/counter`.
- Produces: the route `/dashboard/pnl`.

- [ ] **Step 1: Write the page's server component**

Create `src/app/dashboard/pnl/page.tsx` — the same shape as
`src/app/dashboard/page.tsx`, which the implementer should read first and
mirror exactly:

```tsx
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions, hasOwnerAccess } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { getPnlSections } from "@/lib/counter/adapters/pnl"
import { CounterPnlClient } from "../counter-pnl-client"

/**
 * Counter P&L (Plan 8). A page composes primitives and calls exactly one
 * adapter; it never imports Prisma or an action directly and never inspects
 * `SectionData.status` — `npm run tokens` fails the build on either.
 *
 * The owner gate is here as well as inside `getAllStoresPnL`, which returns
 * `{ error: "P&L is restricted to owners" }` for a non-owner. Without this
 * redirect a manager would get the full Counter frame with every section
 * rendered `failed` — a page that looks broken rather than one that was never
 * theirs. The action's own check stays as the real boundary.
 */
export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (!hasOwnerAccess(session.user.role)) redirect("/dashboard")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  const today = new Date()
  const counterParams = readCounterParams(params, today)

  const stores = await getOverviewStores()
  const sections = await getPnlSections({
    range: counterParams.range,
    storeId: counterParams.storeId,
    today,
    stores,
  })

  return (
    <CounterPnlClient
      pathname="/dashboard/pnl"
      params={params.toString()}
      stores={stores}
      today={today}
      sections={sections}
    />
  )
}
```

- [ ] **Step 2: Write the client island**

Create `src/app/dashboard/counter-pnl-client.tsx`. Read
`counter-overview-client.tsx` first — the `params`-as-a-string contract, the
`push` callback and the `AppShell`/`Topbar` composition are all the same, and
the RSC-serialisation comment on `params` applies here verbatim.

```tsx
"use client"

import { useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  AppShell, EntryItem, Topbar, StoreSwitcher, DateControl,
  Section, Strip, Table, Cascade, Meter,
  type SwitchableStore,
} from "@/components/counter"
import {
  readCounterParams, writeCounterParams,
} from "@/lib/counter/url-state"
import { parseIsoDay, rangeLabel, stepRange } from "@/lib/counter/date-range"
import { money, pct, delta } from "@/lib/counter/format"
import type { PnlSections } from "@/lib/counter/adapters/pnl"

const STAGE_LABEL: Record<SwitchableStore["stage"], string> = {
  pre_open: "Pre-open",
  warming_up: "Warming up",
  trading: "Trading",
}

export function CounterPnlClient({
  pathname,
  params: paramsString,
  stores,
  today,
  sections,
}: {
  pathname: string
  /** PLAIN TEXT, not a URLSearchParams — see counter-overview-client.tsx. */
  params: string
  stores: SwitchableStore[]
  today: Date
  sections: PnlSections
}) {
  const router = useRouter()
  const params = useMemo(() => new URLSearchParams(paramsString), [paramsString])
  const counterParams = useMemo(() => readCounterParams(params, today), [params, today])

  const push = useCallback(
    (next: Parameters<typeof writeCounterParams>[1]) => {
      const qs = writeCounterParams(params, next).toString()
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )

  const selectedStore = stores.find((s) => s.id === counterParams.storeId) ?? null
  const label = rangeLabel(counterParams.range, counterParams.presetId)

  return (
    <AppShell
      pathname={pathname}
      params={params}
      storeName={selectedStore?.name ?? null}
      today={today}
      topbar={
        <Topbar pathname={pathname} title="Profit and loss">
          <StoreSwitcher
            stores={stores}
            selectedId={counterParams.storeId}
            onSelect={(id) => push({ storeId: id })}
          />
          <DateControl
            presetId={counterParams.presetId}
            comparisonId={counterParams.comparisonId}
            range={counterParams.range}
            onPreset={(id) => push({ presetId: id })}
            onComparison={(id) => push({ comparisonId: id })}
            onStep={(direction) => push({ range: stepRange(counterParams.range, direction) })}
          />
        </Topbar>
      }
    >
      <div className="flex flex-col gap-5 p-5">
        <EntryItem index={0}>
          <Section title="The bottom line" meta={label} data={sections.headline} askAbout>
            {(d) => (
              <div className="flex flex-col gap-4">
                <Strip
                  cells={[
                    { label: "Bottom line", value: money(d.bottomLine), caption: `${pct(d.marginPct, { scaled: true })} of sales` },
                    {
                      label: "Prime cost",
                      value: pct(d.primePct),
                      caption: `Ceiling ${d.ceilingPct.toFixed(1)}%`,
                      delta: d.roomPp === null
                        ? undefined
                        : `${delta(d.roomPp)} pts ${d.overCeiling ? "over" : "under"}`,
                    },
                    { label: "Food", value: pct(d.cogsPct) },
                    { label: "Labor", value: pct(d.laborPct) },
                  ]}
                />
                {d.primePct !== null && (
                  <Meter
                    label={`Prime cost ${d.primePct.toFixed(1)} percent against a ${d.ceilingPct.toFixed(1)} percent ceiling`}
                    value={d.primePct}
                    reference={d.ceilingPct}
                    max={80}
                    format="percent"
                    target={`Ceiling ${d.ceilingPct.toFixed(1)}%`}
                  />
                )}
              </div>
            )}
          </Section>
        </EntryItem>

        <EntryItem index={1}>
          <Section
            title="Where it went"
            meta="the bar is what is left after each line"
            data={sections.cascade}
            askAbout="where the money went"
          >
            {(steps) => (
              <div className="flex flex-col gap-3">
                <Cascade steps={steps.map((s) => ({ label: s.label, amount: s.amount, kind: s.kind }))} />
                <ul className="flex flex-col gap-1 font-ct-mono text-ct-micro text-ct-ink-3">
                  {steps.map((s) => (
                    <li key={s.label}>
                      <span className="text-ct-ink-2">{s.label}</span> — {s.sub}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
        </EntryItem>

        <EntryItem index={2}>
          <Section
            title="The last eight weeks"
            meta="press a week to read it in full"
            data={sections.weeks}
            askAbout="the last eight weeks"
          >
            {(rows) => (
              <Table
                columns={[
                  { key: "week", label: "Week of" },
                  { key: "gross", label: "Gross", numeric: true },
                  { key: "food", label: "Food", numeric: true },
                  { key: "labor", label: "Labor", numeric: true },
                  { key: "prime", label: "Prime", numeric: true },
                  { key: "kept", label: "Kept", numeric: true },
                  { key: "margin", label: "Margin", numeric: true },
                ]}
                rows={rows.map((w) => ({
                  key: w.key,
                  // A week is a RANGE, not a route — pressing it moves the
                  // date control rather than navigating somewhere. `href`
                  // would be a link to a page that does not exist.
                  onSelect: () => {
                    const start = parseIsoDay(w.from)
                    const end = parseIsoDay(w.to)
                    if (start && end) push({ range: { start, end } })
                  },
                  selected: w.isCurrent,
                  cells: {
                    week: w.partial ? `${w.label} · ${w.days} of 7 days` : w.label,
                    gross: money(w.grossSales),
                    food: pct(w.cogsPct),
                    labor: pct(w.laborPct),
                    prime: pct(w.primePct),
                    kept: money(w.bottomLine),
                    margin: pct(w.marginPct, { scaled: true }),
                  },
                }))}
              />
            )}
          </Section>
        </EntryItem>

        <EntryItem index={3}>
          <Section title="By store" data={sections.byStore} askAbout="how the stores compare">
            {(rows) => (
              <Table
                columns={[
                  { key: "store", label: "Store" },
                  { key: "net", label: "Net", numeric: true },
                  { key: "prime", label: "Prime", numeric: true },
                  { key: "fixed", label: "Fixed on file" },
                  { key: "stage", label: "Stage" },
                ]}
                rows={rows.map((r) => ({
                  key: r.storeId,
                  cells: {
                    store: r.store,
                    net: money(r.net),
                    prime: pct(r.primePct),
                    fixed: r.fixedOnFile ? "On file" : "Not on file",
                    stage: STAGE_LABEL[r.stage],
                  },
                }))}
              />
            )}
          </Section>
        </EntryItem>

        <EntryItem index={4}>
          <Section title="How much of this is measured" data={sections.trust}>
            {() => null}
          </Section>
        </EntryItem>

        <EntryItem index={5}>
          <Section title="What is behind the food line" data={sections.foodCause}>
            {() => null}
          </Section>
        </EntryItem>
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 3: Give `Table` a pressable row**

`Table`'s `Row` supports `href` (a `Link` stretched over the row) but not a
callback, and a week is a range rather than a route. Add to
`src/components/counter/surface/table.tsx`:

```ts
export interface Row {
  key: string
  cells: Record<string, React.ReactNode>
  href?: string
  /**
   * Pressing this row does something that is not navigation — note 53's
   * eight weeks move the date control rather than going anywhere. Mutually
   * exclusive with `href`: a row is either a link or a button, never both,
   * because a row that is both has two different meanings for Enter.
   */
  onSelect?: () => void
  /** The row the reader is currently inside. Marked, not merely hovered. */
  selected?: boolean
}
```

Render it as a real button in the first cell, stretched the same way `href`
already is, so the row is reachable by keyboard and announced as pressable:

```tsx
                    navigable && i === 0 ? (
                      <Link href={r.href!} className="block after:absolute after:inset-0">{cell}</Link>
                    ) : pressable && i === 0 ? (
                      <button
                        type="button"
                        onClick={r.onSelect}
                        aria-pressed={r.selected ?? false}
                        className="block w-full text-left after:absolute after:inset-0"
                      >
                        {cell}
                      </button>
                    ) : (
                      cell
                    )
```

with `const pressable = Boolean(r.onSelect) && !r.href` beside the existing
`navigable`, the same `relative cursor-pointer hover:bg-ct-accent-wash` row
classes applied when either is true, and `bg-ct-sunk` added when
`r.selected`. Extend
`tests/components/counter/table.test.tsx` with: a pressed row calls
`onSelect` (use `fireEvent.click`, not `.click()` — under React 19 + RTL 16
only `fireEvent` commits state); a row with both `href` and `onSelect` renders
the link and not the button; and `selected` sets `aria-pressed="true"`.

- [ ] **Step 4: Write the client island's test**

Create `tests/app/counter-pnl.test.tsx`, mirroring the
Overview client's existing test file. Cover at minimum:

```tsx
it("puts the pressed week in the URL as a custom range", () => {
  const push = vi.fn()
  vi.mocked(useRouter).mockReturnValue({ push } as never)
  render(<CounterPnlClient {...props} />)
  fireEvent.click(screen.getByText("Aug 3"))
  expect(push).toHaveBeenCalledWith("/dashboard/pnl?from=2026-08-03&to=2026-08-09", { scroll: false })
})

it("steps by the length of the range it is on, not by a calendar week", () => {
  const push = vi.fn()
  vi.mocked(useRouter).mockReturnValue({ push } as never)
  render(<CounterPnlClient {...props} />) // props.params = "range=d30"
  fireEvent.click(screen.getByLabelText(/Previous period/))
  const url = push.mock.calls[0][0] as string
  expect(url).toContain("from=")
  expect(url).not.toContain("range=d30")
})

it("prints an em-dash, not 0.0%, for a store with no sales", () => {
  render(<CounterPnlClient {...propsWithNullPrime} />)
  expect(screen.queryByText("0.0%")).not.toBeInTheDocument()
})

it("never inspects a status — every state comes from Section", () => {
  // A `failed` headline renders the failure and none of the strip.
  render(<CounterPnlClient {...propsWithFailedHeadline} />)
  expect(screen.queryByText("Prime cost")).not.toBeInTheDocument()
})
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/app tests/components/counter/table.test.tsx`
Expected: PASS.

- [ ] **Step 6: Graduate the route out of `(editorial)`**

```bash
git rm -r "src/app/dashboard/(editorial)/pnl"
```

Then create the store shim at `src/app/dashboard/pnl/[storeId]/page.tsx`:

```tsx
import { redirect } from "next/navigation"

/**
 * The store switcher deletes this route (spec §2.4's route map). It survives
 * only as a shim, because `/dashboard/pnl/<id>` is a URL owners have
 * bookmarked and the mobile P&L links to it — a 404 would be a regression
 * dressed up as a rebuild. Phase F removes the shims together.
 */
export default async function PnlStoreRedirect({
  params,
}: {
  params: Promise<{ storeId: string }>
}) {
  const { storeId } = await params
  redirect(`/dashboard/pnl?store=${encodeURIComponent(storeId)}`)
}
```

Check what else linked to the old route and repoint it:

```bash
grep -rn "dashboard/pnl" --include="*.ts" --include="*.tsx" src | grep -v "src/app/dashboard/pnl"
```

Anything under `src/components/pnl/` that only the deleted editorial page used
is now dead — but do NOT delete it in this step. `src/app/(mobile)/m/pnl/` and
`src/lib/chat/tools/pnl.ts` are separate callers; confirm with the grep above
which files have no remaining importer, and delete only those, in their own
commit, with the grep output in the report.

- [ ] **Step 7: Run the whole gate**

Run: `rm -rf .next && npm test && npm run tokens && npx tsc --noEmit && npm run build`
Expected: PASS. Confirm the build's route manifest still lists `/dashboard/pnl`
and `/dashboard/pnl/[storeId]`, and contains no `(editorial)` string.

- [ ] **Step 8: Commit**

```bash
git add -A src/app/dashboard src/components/counter/surface/table.tsx tests/components/counter
git commit -m "feat(counter): the P&L, on Counter"
```

---

### Task 7: The phone composition, and the redirect that hides it

Ruling R5. `src/proxy.ts:6-29` sends phone user agents from `/dashboard`
to `/m` — so no phone has ever loaded a Counter page, including the Overview
that shipped in Plan 7.

**Files:**
- Modify: `src/components/counter/shell/app-shell.tsx`
- Modify: `src/components/counter/shell/topbar.tsx`
- Modify: `src/proxy.ts`
- Test: `tests/components/counter/shell/app-shell.test.tsx` (exists — extend)
- Test: `tests/lib/middleware.test.ts` (exists — extend; if it does not,
  create it and assert the map directly)

**Interfaces:**
- Produces: `AppShell` renders the rail inside a `<dialog>`-less sheet below
  `md`, opened by a button labelled "Sections"; no prop changes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/counter/shell/app-shell.test.tsx`:

```tsx
it("offers a way into the rail on a narrow screen", () => {
  render(<AppShell pathname="/dashboard">content</AppShell>)
  expect(screen.getByRole("button", { name: /sections/i })).toBeInTheDocument()
})

it("keeps the rail out of the tab order until the sheet is opened", () => {
  render(<AppShell pathname="/dashboard">content</AppShell>)
  const sheet = screen.getByTestId("ct-rail-sheet")
  expect(sheet).toHaveAttribute("aria-hidden", "true")
  fireEvent.click(screen.getByRole("button", { name: /sections/i }))
  expect(sheet).toHaveAttribute("aria-hidden", "false")
})

it("closes the sheet on Escape", () => {
  render(<AppShell pathname="/dashboard">content</AppShell>)
  fireEvent.click(screen.getByRole("button", { name: /sections/i }))
  fireEvent.keyDown(document, { key: "Escape" })
  expect(screen.getByTestId("ct-rail-sheet")).toHaveAttribute("aria-hidden", "true")
})

it("renders the rail exactly once, not once per breakpoint", () => {
  // Two copies means two elements with the same accessible name for every
  // destination, and a screen reader reads seventeen links twice.
  render(<AppShell pathname="/dashboard">content</AppShell>)
  expect(screen.getAllByRole("link", { name: "Overview" })).toHaveLength(1)
})
```

Append to the middleware test:

```ts
it("does not send a phone away from a route that has been rebuilt on Counter", () => {
  expect(DESKTOP_TO_MOBILE["/dashboard"]).toBeUndefined()
  expect(DESKTOP_TO_MOBILE["/dashboard/pnl"]).toBeUndefined()
})

it("still sends a phone away from routes that have not been", () => {
  expect(DESKTOP_TO_MOBILE["/dashboard/orders"]).toBe("/m/orders")
})
```

Export `DESKTOP_TO_MOBILE` from `src/proxy.ts` if it is not already
exported.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/components/counter/shell/app-shell.test.tsx tests/lib/middleware.test.ts`
Expected: FAIL — no "Sections" button; the map still carries both routes.

- [ ] **Step 3: Give the shell its phone composition**

In `src/components/counter/shell/app-shell.tsx`:

- Add `const [sheetOpen, setSheetOpen] = useState(false)` and an Escape
  listener matching `date-control.tsx`'s (`document.addEventListener("keydown", …)`,
  removed on cleanup, only while open).
- Close the sheet whenever `pathname` changes — pressing a destination inside
  it must not leave the sheet covering the page it navigated to:
  `useEffect(() => setSheetOpen(false), [pathname])`.
- Wrap the existing 212px rail column so ONE `<Rail>` serves both. Do not
  render a second copy — the test above exists because two rails means every
  destination is announced twice:

```tsx
      <div
        data-testid="ct-rail-sheet"
        aria-hidden={sheetOpen ? "false" : "true"}
        className={`fixed inset-y-0 left-0 z-40 flex w-[212px] flex-col overflow-y-auto border-r border-ct-line bg-ct-chrome transition-transform md:sticky md:top-0 md:z-auto md:h-dvh md:translate-x-0 ${
          sheetOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
```

  `aria-hidden` must be `"false"` at `md` and up regardless of `sheetOpen`.
  Because the same element is the desk rail, drive it from a media query the
  component already trusts — reuse the pattern in
  `src/components/counter/motion/use-reduced-motion.ts`, which reads
  `matchMedia` in an **effect**, never during render (Plan 3's hydration
  failure came from doing it during render, and it painted -542 into three
  components before anyone noticed).

- Add the trigger, visible only below `md`, inside the topbar row:

```tsx
        <button
          type="button"
          onClick={() => setSheetOpen((v) => !v)}
          aria-expanded={sheetOpen}
          className="grid size-8 shrink-0 place-items-center rounded-ct-sm border border-ct-line-strong bg-ct-surface text-ct-ink-2 hover:bg-ct-sunk md:hidden"
        >
          <span className="sr-only">Sections</span>
          <Menu aria-hidden className="size-4" />
        </button>
```

- Add a scrim below `md` that closes the sheet on click, `md:hidden`, only
  rendered when `sheetOpen`.

In `src/components/counter/shell/topbar.tsx`, change the header's classes from
`flex items-center gap-4` to `flex flex-wrap items-center gap-x-4 gap-y-2` so
the store switcher and date control drop to a second line at 390px instead of
overflowing the viewport.

- [ ] **Step 4: Retire the two redirects**

In `src/proxy.ts`, delete the `"/dashboard": "/m"` and
`"/dashboard/pnl": "/m/pnl"` entries, and add above the map:

```ts
/**
 * A phone-UA redirect from a desktop route to its `/m` twin.
 *
 * A route LEAVES this map when its Counter rebuild ships — Counter's
 * `AppShell` composes for both surfaces (ruling R5, Plan 8), so a phone on
 * `/dashboard/pnl` should get the Counter P&L rather than the editorial one.
 * `/dashboard` and `/dashboard/pnl` left in Plan 8. The rest go as their
 * pages are rebuilt, and Phase F deletes what remains along with `(mobile)/m`.
 */
```

Leave `src/app/(mobile)/m/pnl/` in place. It is still reachable directly and
still linked from `/m`'s own navigation; deleting it belongs to Phase F, with
the rest of the mobile shell, not to a page plan.

- [ ] **Step 5: Run them and watch them pass**

Run: `npx vitest run tests/components/counter/shell/app-shell.test.tsx tests/lib/middleware.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole gate**

Run: `rm -rf .next && npm test && npm run tokens && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/counter/shell tests/components/counter src/proxy.ts tests/lib
git commit -m "feat(counter): the phone gets the pages it was being redirected away from"
```

---

### Task 8: Render it and look at it

Every serious defect in this project so far — the dead dark toggle, the dead
borders, the hydration failure, the doubled shell, the non-sticky header, the
RSC serialisation crash — was invisible to the test suite and found by loading
the page in a browser. This task is not optional and its findings are fixed
before the plan closes.

**Files:**
- Create: `docs/counter/pnl-verification.md`

- [ ] **Step 1: Start the app and load the page**

```bash
npm run dev
```

Use `npm run shot -- /dashboard/pnl <out.png>` for captures (see
`docs/counter/overview-verification.md` for how the previous plan did this;
the `.env.test.local` credentials work).

- [ ] **Step 2: Verify the figures move together**

Record actual numbers, not "it worked":

1. Load `/dashboard/pnl`. Note gross sales, bottom line, prime cost, food, labor.
2. Load `/dashboard`. **Prime cost, food and labor must be identical to the digit.**
   This is note 60's regression check performed by eye, against the real
   database, not a mock. If they differ, stop and find out why before anything
   else in this task.
3. Change the range to Last 30 days on the P&L. Every figure must move and the
   URL must read `?range=d30`.
4. Press the fourth week in the eight-week table. The URL must become
   `?from=…&to=…`, the date control must print that week's ends (not "Today"),
   and the strip must change to that week's figures.
5. Press `‹`. The range must step back by exactly its own length.
6. Reload. Everything must survive.
7. Select one store. The strip, the cascade and the eight weeks must all
   narrow to it; "By store" must still list every store.
8. Select a pre-open store. The strip must read em-dashes, not `0.0%`.

- [ ] **Step 3: Verify the cascade adds up on screen**

Read the seven rows. Gross sales less the five subtractions must equal the
bottom line printed in the strip. A cascade that does not reconcile with its
own headline is note 39's defect and is a blocker.

- [ ] **Step 4: Verify both themes and the console**

Toggle dark. Screenshot both. Confirm zero console errors and zero hydration
warnings in each. Confirm no colour looks like a Tailwind default — every
colour must come from a `ct-` token.

- [ ] **Step 5: Verify the phone**

Resize to 390 × 844:

1. `/dashboard/pnl` must render Counter, NOT redirect to `/m/pnl`.
2. The rail must be a sheet, opened by the Sections button, closing on Escape,
   on a scrim click, and on choosing a destination.
3. The topbar controls must wrap rather than overflow.
4. Both tables must scroll horizontally **inside their own section** — the
   page body must not scroll sideways. Check by measuring
   `document.body.scrollWidth` against `window.innerWidth`.
5. The strip must be two columns, not four.

- [ ] **Step 6: Measure the bundle**

```bash
npm run build
```

Record `/dashboard/pnl`'s First Load JS against the editorial baseline in
`docs/counter/baseline-bundles.txt`, the way Plan 7 recorded Overview's
323.4 → 183.8 KB gz.

- [ ] **Step 7: Write it down**

Create `docs/counter/pnl-verification.md` with: the figures from Step 2 (both
pages, side by side, so the note-60 check is on the record), the cascade
reconciliation, both screenshots, the phone findings, the bundle numbers, and
every defect found and how it was fixed. A verification doc that says
everything passed and names no numbers is not a verification doc.

- [ ] **Step 8: Commit**

```bash
git add docs/counter/pnl-verification.md docs/counter/baseline-bundles.txt
git commit -m "docs(counter): the P&L, seen"
```

---

## Self-review

**Spec coverage.** §2.2's `prime-cost.ts` — Task 2. §3.1's `adapters/pnl.ts`
— Task 4. §4 rule 5 and note 60 — Tasks 2, 3, 5, and a regression test that
fails if a second definition ever appears. §5's route map for P&L: cascade not
donut (note 52) Task 6; eight pressable weeks (note 53) Tasks 1, 4, 6;
prorated fixed costs shown as arithmetic (note 20) Task 4's cascade captions;
trust panel (note 44) Task 4, owed by name. `pnl/[storeId]` — Task 6's shim.
Both surfaces (decision 4) — Task 7. §3.2 lists the prime-cost cascade as
owed; ruling R1 overrides that with its reasoning on the record.

**Placeholders.** None. Every step carries the code or the exact command.
Task 4's `emptyReason` note and Task 4 Step 4's test correction are deliberate
— they hand the implementer a defect I introduced along with its fix, rather
than leaving a trap.

**Type consistency.** `RangeId` widens `CounterParams.presetId` and
`DateControlProps.presetId` in Task 1; `writeCounterParams`'s `next.presetId`
stays `PresetId`, since "custom" is never written as a name. `PrimeCost` is
produced in Task 2 and consumed unchanged in Tasks 3, 4 and 5.
`Statement`/`StoreStatement` are produced in Task 3 and consumed in Tasks 4
and 5. `PnlSections` is produced in Task 4 and consumed in Task 6.
`Row.onSelect`/`Row.selected` are added in Task 6 Step 3 and used in the same
step. `SwitchableStore` comes from `@/components/counter` throughout.

**Known gaps carried forward.**
1. The eight-week table issues eight `loadStatement` calls. They hit the
   action's 600-second cache, but a per-period reduction in `statement.ts`
   would make it one. Follow-up.
2. The comparison is read from the URL and passed to `DateControl`, but no
   figure on this page is compared yet — the prototype's change column needs a
   second statement over `comparisonRange(range, mode)`. Follow-up, and the
   first page after this one that needs it should add it to `statement.ts`
   rather than to a page.
3. `marginPct` arrives from the action as a fraction while every percentage
   from `prime-cost.ts` arrives already scaled. The page passes
   `{ scaled: true }` for one and nothing for the other. That asymmetry is a
   live foot-gun; normalising it inside `statement.ts` is a follow-up.
4. `(mobile)/m/pnl/` still exists and is still reachable. Phase F deletes it.
