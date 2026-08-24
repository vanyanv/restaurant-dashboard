# Counter Data Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `SectionData` keystone, the pure logic every Counter page depends on, and the presentational primitives that render all six states — so that no page author can ever get state handling wrong.

**Architecture:** One discriminated union crosses every data boundary. Six surface primitives accept it and render the correct state internally; five state components implement those renderings once. Pages never branch on status, because there is no other way to pass data in. Everything here is pure or presentational, so it is provable with Vitest + React Testing Library without a browser, a server, or a page.

**Tech Stack:** TypeScript 7, React 19, Next.js 16, Tailwind v4 (`ct-` utilities only), Vitest 4 + `@testing-library/react` (jsdom per-file), `date-fns` 4 (already a dependency).

**Spec:** [`docs/superpowers/specs/2026-08-23-counter-design-system-design.md`](../specs/2026-08-23-counter-design-system-design.md)

**Prototype:** [`docs/counter/counter-prototype.html`](../../counter/counter-prototype.html) — the visual and behavioural source of truth. Its `sec()`, `strip()`, `chart()` and `tbl()` functions are what these primitives replace; read them before implementing the component that corresponds to each.

**Design system:** [`DESIGN.md`](../../../DESIGN.md) — token meanings. `src/styles/counter.css` is the only colour source.

## Global Constraints

- Branch is `dashboardv2`. Never rebase onto main. Never merge or push.
- Gate: `npm test && npm run tokens && npx tsc --noEmit && npm run build`. Baseline to hold or beat: **162 files, 1838 passed | 8 skipped**. The 8 skips are deliberate, documented, inherited prototype defects — never touch them.
- This repo has NO ESLint. Do not try to run a linter other than `npm run tokens`.
- **Never `prisma migrate dev`** — it would reset the Neon production database. This plan touches no schema and no database.
- Commit messages must NOT contain a `Co-Authored-By: Claude` line.
- **Colour comes only from `ct-` Tailwind utilities.** No hex, no `oklch()`, no `rgb()`, no `hsl()`, no `bg-white`/`text-black`, no Tailwind palette colours. `npm run tokens` fails the build on all of these.
- **Radii are `rounded-ct` (8px) and `rounded-ct-sm` (5px) only.**
- **Type:** `font-ct-display` (Bricolage) is for page titles and the wordmark ONLY — no primitive in this plan uses it. Figures are DM Sans with `tabular-nums lining-nums`. Captions, folios, SKUs and status labels are `font-ct-mono` (JetBrains Mono).
- Component tests are `.tsx` and need `// @vitest-environment jsdom` as the first line. Pure-logic tests are `.ts` and run on the default `node` environment.
- Do not commit `.next/`. Do not import `framer-motion` anywhere in this plan — motion arrives in a later plan behind `src/components/counter/motion/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/counter/section-data.ts` | The union, its constructors, and the single type guard consumers use |
| `src/lib/counter/format.ts` | Money, percent, delta and count formatting — tabular by construction |
| `src/lib/counter/date-range.ts` | 12 presets, 4 comparison modes, bucket selection, steppers |
| `src/lib/counter/channels.ts` | Channel identity, commission rates, and the CVD-safe band mapping |
| `src/components/counter/state/skeleton.tsx` | The loading shape |
| `src/components/counter/state/failed.tsx` | A named failure with a retry, scoped to one section |
| `src/components/counter/state/empty.tsx` | Two reasons, two different next steps |
| `src/components/counter/state/stale.tsx` | Last-good figures, marked as such |
| `src/components/counter/state/owed.tsx` | Not computed yet, named honestly |
| `src/components/counter/surface/section.tsx` | The keystone wrapper: head, meta, Ask affordance, all six states |
| `src/components/counter/surface/strip.tsx` | The ruled figure strip |
| `src/components/counter/surface/figure.tsx` | One lead figure with its caption and delta |
| `src/components/counter/surface/table.tsx` | Rules-only table, sticky head, right-aligned figures, navigable rows |
| `src/components/counter/surface/meter.tsx` | A measure against a reference, colouring only the overshoot |
| `src/components/counter/surface/cascade.tsx` | A sequence of subtractions — what is left after each |
| `src/components/counter/index.ts` | Barrel re-export, so pages import from one place |

`state/` components are consumed ONLY by `surface/` components. Pages never import them directly. That boundary is what makes note 22 true: state handling exists once.

**Deferred out of this plan, deliberately:**
- `prime-cost.ts` — the spec lists it, but it has no consumer until the P&L phase and its inputs are not yet known. Writing it now would be speculation. It arrives with its first caller, and note 60 (two definitions 1.7 points apart) is why it must arrive exactly once.
- `chart.tsx` — needs the motion hooks and the Recharts bar/line asymmetry established in the Task 3 spike. Next plan.
- `toast.tsx` — needs motion. Next plan.

---

### Task 1: The SectionData union

This is the keystone. Everything else in Counter depends on it, and its shape is what makes it impossible for a page author to mishandle state.

**Files:**
- Create: `src/lib/counter/section-data.ts`
- Test: `tests/lib/counter/section-data.test.ts`

**Interfaces:**
- Produces: `type SectionData<T>`, constructors `ready`, `stale`, `loading`, `failed`, `empty`, `notComputed`, and the guard `hasData`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import {
  ready, stale, loading, failed, empty, notComputed, hasData,
  type SectionData,
} from "@/lib/counter/section-data"

describe("SectionData", () => {
  it("ready carries its data", () => {
    expect(ready({ n: 1 })).toEqual({ status: "ready", data: { n: 1 } })
  })

  it("stale carries data AND when it was last good", () => {
    const at = new Date("2026-08-24T09:00:00Z")
    expect(stale({ n: 1 }, at)).toEqual({ status: "stale", data: { n: 1 }, lastGoodAt: at })
  })

  it("failed names the error and the action that retries it", () => {
    expect(failed("Otter sync timed out", "retrySync")).toEqual({
      status: "failed", error: "Otter sync timed out", retryAction: "retrySync",
    })
  })

  it("empty distinguishes a pre-open store from a filter that matched nothing", () => {
    expect(empty("pre_open").reason).toBe("pre_open")
    expect(empty("no_match").reason).toBe("no_match")
  })

  it("notComputed names what is owed", () => {
    expect(notComputed("clock-in/out leak ledger")).toEqual({
      status: "not_computed", owed: "clock-in/out leak ledger",
    })
  })

  it("hasData is true for exactly the two states that carry data", () => {
    expect(hasData(ready(1))).toBe(true)
    expect(hasData(stale(1, new Date("2026-08-24T09:00:00Z")))).toBe(true)
    expect(hasData(loading())).toBe(false)
    expect(hasData(failed("x", "y"))).toBe(false)
    expect(hasData(empty("no_match"))).toBe(false)
    expect(hasData(notComputed("x"))).toBe(false)
  })

  it("hasData narrows the type so .data is reachable without a cast", () => {
    const sd: SectionData<{ n: number }> = ready({ n: 7 })
    // The point of the guard: this line must compile with no assertion.
    expect(hasData(sd) ? sd.data.n : -1).toBe(7)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/counter/section-data.test.ts`
Expected: FAIL — cannot resolve `@/lib/counter/section-data`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The one shape that crosses every Counter data boundary.
 *
 * Prototype note 22: "States belong in the builders, not the pages." Loading,
 * failed, empty and stale are implemented once inside the surface primitives,
 * which is why all fifty-three pages have all their states without any page
 * author writing one. This union is the mechanism — a page cannot hand a
 * primitive anything else, so it cannot forget a state.
 *
 * Six states, not the prototype's five. `not_computed` is ours: several
 * sections the design calls for have no server code yet, and rendering them as
 * a named piece of owed work is the only honest option that is neither a fake
 * number nor a silent gap.
 */
export type SectionData<T> =
  | { status: "ready"; data: T }
  | { status: "stale"; data: T; lastGoodAt: Date }
  | { status: "loading" }
  | { status: "failed"; error: string; retryAction: string }
  | { status: "empty"; reason: EmptyReason }
  | { status: "not_computed"; owed: string }

/**
 * Two reasons, because they need different next steps (note 23). A pre-open
 * store has no sales because it has no customers — nothing is wrong and there
 * is nothing to do. A filter that matched nothing is a dead end the reader can
 * back out of.
 */
export type EmptyReason = "pre_open" | "no_match"

export const ready = <T>(data: T): SectionData<T> => ({ status: "ready", data })

export const stale = <T>(data: T, lastGoodAt: Date): SectionData<T> => ({
  status: "stale",
  data,
  lastGoodAt,
})

export const loading = <T = never>(): SectionData<T> => ({ status: "loading" })

/**
 * `retryAction` is a name, not a function, so a SectionData stays serialisable
 * across the server/client boundary. The surface component maps the name to a
 * handler; a server component can therefore build one of these directly.
 */
export const failed = <T = never>(error: string, retryAction: string): SectionData<T> => ({
  status: "failed",
  error,
  retryAction,
})

export const empty = <T = never>(reason: EmptyReason): SectionData<T> => ({
  status: "empty",
  reason,
})

export const notComputed = <T = never>(owed: string): SectionData<T> => ({
  status: "not_computed",
  owed,
})

/**
 * The ONLY status inspection a consumer should need. Surface primitives call
 * this; pages call nothing, because pages never receive a reason to look.
 */
export function hasData<T>(
  sd: SectionData<T>,
): sd is Extract<SectionData<T>, { status: "ready" | "stale" }> {
  return sd.status === "ready" || sd.status === "stale"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/counter/section-data.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter/section-data.ts tests/lib/counter/section-data.test.ts
git commit -m "feat(counter): the one shape that crosses every data boundary"
```

---

### Task 2: Formatting

Every figure in Counter is DM Sans with tabular lining numerals. Formatting is centralised so a number cannot be written two ways on two pages.

**Files:**
- Create: `src/lib/counter/format.ts`
- Test: `tests/lib/counter/format.test.ts`

**Interfaces:**
- Produces: `money`, `moneyCompact`, `pct`, `delta`, `count`, and the constant `TABULAR`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { money, moneyCompact, pct, delta, count, TABULAR } from "@/lib/counter/format"

describe("format", () => {
  it("money is whole dollars by default — cents are noise at a glance", () => {
    expect(money(7468)).toBe("$7,468")
    expect(money(7468.42)).toBe("$7,468")
  })

  it("money keeps cents when asked, for figures a reader will reconcile", () => {
    expect(money(19.86, { cents: true })).toBe("$19.86")
    expect(money(2002.7, { cents: true })).toBe("$2,002.70")
  })

  it("money renders a negative as a parenthesised figure, the ledger convention", () => {
    expect(money(-2208)).toBe("($2,208)")
  })

  it("moneyCompact is for axis ticks only", () => {
    expect(moneyCompact(14000)).toBe("$14K")
    expect(moneyCompact(950)).toBe("$950")
    expect(moneyCompact(1500000)).toBe("$1.5M")
  })

  it("pct carries one decimal, because a tenth of a point moves prime cost", () => {
    expect(pct(0.314)).toBe("31.4%")
    expect(pct(0.6)).toBe("60.0%")
  })

  it("pct accepts an already-scaled value when told", () => {
    expect(pct(31.4, { scaled: true })).toBe("31.4%")
  })

  it("delta signs the number and never says +0.0%", () => {
    expect(delta(0.114)).toBe("▲ 11.4%")
    expect(delta(-0.028)).toBe("▼ 2.8%")
    expect(delta(0)).toBe("flat")
  })

  it("count is plain and grouped", () => {
    expect(count(376)).toBe("376")
    expect(count(1652)).toBe("1,652")
  })

  it("TABULAR is the class every figure carries", () => {
    expect(TABULAR).toBe("tabular-nums lining-nums")
  })

  it("a null figure is an em-dash, not a zero — absent is not the same as none", () => {
    expect(money(null)).toBe("—")
    expect(pct(null)).toBe("—")
    expect(count(null)).toBe("—")
    expect(delta(null)).toBe("—")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/counter/format.test.ts`
Expected: FAIL — cannot resolve `@/lib/counter/format`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Every figure in Counter is formatted here, so the same number cannot be
 * written two ways on two pages.
 *
 * The em-dash rule matters more than it looks: a section with no value must
 * not render "$0" or "0%", because zero is a measurement and absence is not.
 * The prototype uses an em-dash for exactly this and so do we.
 */

/** Applied to every figure. DM Sans carries tabular lining numerals; without this, columns of numbers do not line up. */
export const TABULAR = "tabular-nums lining-nums"

const DASH = "—"

export function money(v: number | null, opts: { cents?: boolean } = {}): string {
  if (v === null) return DASH
  const digits = opts.cents ? 2 : 0
  const abs = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  // Parentheses, not a minus sign: this is a ledger, and a bracketed figure
  // reads as a subtraction at a glance where "-$2,208" reads as a range.
  return v < 0 ? `($${abs})` : `$${abs}`
}

export function moneyCompact(v: number | null): string {
  if (v === null) return DASH
  const abs = Math.abs(v)
  const sign = v < 0 ? "-" : ""
  if (abs >= 1_000_000) return `${sign}$${trimZero(abs / 1_000_000)}M`
  if (abs >= 1_000) return `${sign}$${trimZero(abs / 1_000)}K`
  return `${sign}$${Math.round(abs)}`
}

function trimZero(n: number): string {
  const s = n.toFixed(1)
  return s.endsWith(".0") ? s.slice(0, -2) : s
}

export function pct(v: number | null, opts: { scaled?: boolean } = {}): string {
  if (v === null) return DASH
  const n = opts.scaled ? v : v * 100
  return `${n.toFixed(1)}%`
}

/**
 * A delta is a direction plus a magnitude. "flat" rather than "▲ 0.0%",
 * because an arrow that points at nothing is a false signal.
 */
export function delta(v: number | null, opts: { scaled?: boolean } = {}): string {
  if (v === null) return DASH
  const n = opts.scaled ? v : v * 100
  if (Math.abs(n) < 0.05) return "flat"
  return `${n > 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(1)}%`
}

export function count(v: number | null): string {
  return v === null ? DASH : v.toLocaleString("en-US")
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/counter/format.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter/format.ts tests/lib/counter/format.test.ts
git commit -m "feat(counter): one place a figure gets written"
```

---

### Task 3: The date range

The spec calls the date control "the most-used control in the product", and note 19 is blunt about the failure mode: "A range that only changes the label is a lie." This module is the logic underneath it — presets, comparisons, bucketing and stepping — with no UI.

**Files:**
- Create: `src/lib/counter/date-range.ts`
- Test: `tests/lib/counter/date-range.test.ts`

**Interfaces:**
- Consumes: `date-fns` (already a dependency).
- Produces: `PRESETS`, `COMPARISONS`, `type DateRange`, `type PresetId`, `type ComparisonId`, `type Bucket`, `resolvePreset`, `bucketFor`, `stepRange`, `comparisonRange`, `dayCount`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import {
  PRESETS, COMPARISONS, resolvePreset, bucketFor, stepRange, comparisonRange, dayCount,
} from "@/lib/counter/date-range"

const TODAY = new Date(2026, 7, 24) // Mon 24 Aug 2026, local midnight

describe("presets", () => {
  it("offers exactly the twelve the design specifies", () => {
    expect(PRESETS).toHaveLength(12)
    expect(PRESETS.map((p) => p.id)).toEqual([
      "today", "yesterday", "wtd", "lastweek",
      "d3", "d7", "d14", "d30", "d90",
      "mtd", "qtd", "ytd",
    ])
  })

  it("today is a single day", () => {
    const r = resolvePreset("today", TODAY)
    expect(r).toEqual({ start: TODAY, end: TODAY })
    expect(dayCount(r)).toBe(1)
  })

  it("last 7 days includes today, so it is 7 days not 8", () => {
    expect(dayCount(resolvePreset("d7", TODAY))).toBe(7)
  })

  it("this week runs Monday to today", () => {
    const r = resolvePreset("wtd", TODAY)
    expect(r.start).toEqual(new Date(2026, 7, 24)) // Monday IS today here
    expect(r.end).toEqual(TODAY)
  })

  it("last week is the seven whole days before this week began", () => {
    const r = resolvePreset("lastweek", TODAY)
    expect(dayCount(r)).toBe(7)
    expect(r.end).toEqual(new Date(2026, 7, 23)) // Sunday
  })

  it("month-to-date starts on the first", () => {
    expect(resolvePreset("mtd", TODAY).start).toEqual(new Date(2026, 7, 1))
  })

  it("quarter-to-date starts at the quarter boundary", () => {
    expect(resolvePreset("qtd", TODAY).start).toEqual(new Date(2026, 6, 1))
  })

  it("year-to-date starts on 1 January", () => {
    expect(resolvePreset("ytd", TODAY).start).toEqual(new Date(2026, 0, 1))
  })
})

describe("bucketFor", () => {
  it("uses days up to a month", () => {
    expect(bucketFor({ start: new Date(2026, 7, 1), end: new Date(2026, 7, 24) })).toBe("day")
  })

  it("uses weeks up to four months", () => {
    expect(bucketFor({ start: new Date(2026, 4, 1), end: new Date(2026, 7, 24) })).toBe("week")
  })

  it("uses months beyond four", () => {
    expect(bucketFor({ start: new Date(2025, 7, 1), end: new Date(2026, 7, 24) })).toBe("month")
  })
})

describe("stepRange", () => {
  it("walks back by exactly the span you are on, not by a calendar unit", () => {
    const week = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }
    const back = stepRange(week, -1)
    expect(dayCount(back)).toBe(7)
    expect(back.end).toEqual(new Date(2026, 7, 17))
    expect(back.start).toEqual(new Date(2026, 7, 11))
  })

  it("steps forward the same way", () => {
    const day = { start: TODAY, end: TODAY }
    expect(stepRange(day, 1)).toEqual({
      start: new Date(2026, 7, 25), end: new Date(2026, 7, 25),
    })
  })
})

describe("comparisonRange", () => {
  const week = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }

  it("offers exactly four modes", () => {
    expect(COMPARISONS.map((c) => c.id)).toEqual(["prev", "weekday", "year", "none"])
  })

  it("prior period is the same length immediately before", () => {
    const c = comparisonRange(week, "prev")!
    expect(dayCount(c)).toBe(7)
    expect(c.end).toEqual(new Date(2026, 7, 17))
  })

  it("last year is the same dates a year earlier", () => {
    const c = comparisonRange(week, "year")!
    expect(c.start).toEqual(new Date(2025, 7, 18))
    expect(c.end).toEqual(new Date(2025, 7, 24))
  })

  it("same weekdays walks back four weeks for a single day", () => {
    const c = comparisonRange({ start: TODAY, end: TODAY }, "weekday")!
    expect(c.start).toEqual(new Date(2026, 6, 27)) // 4 Mondays earlier
    expect(c.end).toEqual(new Date(2026, 7, 17))   // the most recent prior Monday
  })

  it("none returns null, so a caller must handle 'no comparison' explicitly", () => {
    expect(comparisonRange(week, "none")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/counter/date-range.test.ts`
Expected: FAIL — cannot resolve `@/lib/counter/date-range`.

- [ ] **Step 3: Write the implementation**

```ts
import {
  addDays, differenceInCalendarDays, startOfWeek, startOfMonth,
  startOfQuarter, startOfYear, subYears,
} from "date-fns"

/**
 * The logic under the most-used control in the product.
 *
 * Note 19: "A range that only changes the label is a lie." Picking a range has
 * to regenerate the series, the totals, the bucket size and the tooltips — so
 * everything a caller needs to do that lives here, and nothing here renders.
 *
 * All dates are local midnights. The dashboard's day boundary is the
 * restaurant's, not UTC's, and every existing query in this codebase already
 * works that way.
 */

export interface DateRange {
  start: Date
  end: Date
}

export type PresetId =
  | "today" | "yesterday" | "wtd" | "lastweek"
  | "d3" | "d7" | "d14" | "d30" | "d90"
  | "mtd" | "qtd" | "ytd"

export interface Preset {
  id: PresetId
  name: string
  resolve: (today: Date) => DateRange
}

/** Monday. The trade runs on a Monday-start week (note 53: weekly is the cadence). */
const weekStart = (d: Date) => startOfWeek(d, { weekStartsOn: 1 })

/** A trailing window that INCLUDES today, so "last 7 days" is 7 days. */
const trailing = (n: number) => (today: Date): DateRange => ({
  start: addDays(today, -(n - 1)),
  end: today,
})

export const PRESETS: readonly Preset[] = [
  { id: "today", name: "Today", resolve: (t) => ({ start: t, end: t }) },
  { id: "yesterday", name: "Yesterday", resolve: (t) => ({ start: addDays(t, -1), end: addDays(t, -1) }) },
  { id: "wtd", name: "This week", resolve: (t) => ({ start: weekStart(t), end: t }) },
  {
    id: "lastweek",
    name: "Last week",
    resolve: (t) => {
      const s = addDays(weekStart(t), -7)
      return { start: s, end: addDays(s, 6) }
    },
  },
  { id: "d3", name: "Last 3 days", resolve: trailing(3) },
  { id: "d7", name: "Last 7 days", resolve: trailing(7) },
  { id: "d14", name: "Last 14 days", resolve: trailing(14) },
  { id: "d30", name: "Last 30 days", resolve: trailing(30) },
  { id: "d90", name: "Last 90 days", resolve: trailing(90) },
  { id: "mtd", name: "Month-to-date", resolve: (t) => ({ start: startOfMonth(t), end: t }) },
  { id: "qtd", name: "Quarter-to-date", resolve: (t) => ({ start: startOfQuarter(t), end: t }) },
  { id: "ytd", name: "Year-to-date", resolve: (t) => ({ start: startOfYear(t), end: t }) },
] as const

export function resolvePreset(id: PresetId, today: Date): DateRange {
  const p = PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`unknown preset: ${id}`)
  return p.resolve(today)
}

/** Inclusive of both ends — a single day is 1, not 0. */
export function dayCount(r: DateRange): number {
  return differenceInCalendarDays(r.end, r.start) + 1
}

export type Bucket = "day" | "week" | "month"

/**
 * Buckets follow the span, so a chart never draws 365 columns or 2 of them.
 * Days up to a month, weeks up to four months, months beyond.
 */
export function bucketFor(r: DateRange): Bucket {
  const days = dayCount(r)
  if (days <= 31) return "day"
  if (days <= 123) return "week"
  return "month"
}

/**
 * Walk by exactly the range you are on, not by a calendar unit. A 7-day range
 * steps 7 days; a 90-day range steps 90. Stepping a "last 30 days" window by a
 * month would silently change its length.
 */
export function stepRange(r: DateRange, direction: -1 | 1): DateRange {
  const span = dayCount(r)
  return {
    start: addDays(r.start, span * direction),
    end: addDays(r.end, span * direction),
  }
}

export type ComparisonId = "prev" | "weekday" | "year" | "none"

export interface Comparison {
  id: ComparisonId
  name: string
  /** Reads inside a sentence: "…$7,468, vs the prior period." */
  label: string
  /** Reads inside a chart tooltip, where space is short. */
  short: string
}

export const COMPARISONS: readonly Comparison[] = [
  { id: "prev", name: "Prior period", label: "vs the prior period", short: "vs prior" },
  { id: "weekday", name: "4 same weekdays", label: "vs the same 4 weekdays", short: "vs 4 weekdays" },
  { id: "year", name: "Last year", label: "vs the same days last year", short: "vs last year" },
  { id: "none", name: "None", label: "with no comparison", short: "no compare" },
] as const

/**
 * The comparison is part of the range, not a separate setting (spec §5.3), so
 * it is derived from the range rather than stored beside it.
 *
 * `none` returns null on purpose: a caller must then decide what to render
 * instead of a delta, rather than being handed a range that quietly equals the
 * primary one.
 */
export function comparisonRange(r: DateRange, mode: ComparisonId): DateRange | null {
  if (mode === "none") return null
  if (mode === "year") return { start: subYears(r.start, 1), end: subYears(r.end, 1) }
  if (mode === "prev") {
    const span = dayCount(r)
    return { start: addDays(r.start, -span), end: addDays(r.end, -span) }
  }
  // weekday: the same span, four weeks earlier through one week earlier —
  // a like-for-like read for a trade whose week has a strong shape.
  return { start: addDays(r.start, -28), end: addDays(r.end, -7) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/counter/date-range.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter/date-range.ts tests/lib/counter/date-range.test.ts
git commit -m "feat(counter): the range regenerates the data, not just the label"
```

---

### Task 4: Channels

Two different jobs that must not be confused: brand identity, and data. Notes 36 and 41 are explicit that the four brand hexes fail as a data set — they clear only ΔE 8.5 — so bands are separated by lightness instead, fixed to the channel and never to its rank.

**Files:**
- Create: `src/lib/counter/channels.ts`
- Test: `tests/lib/counter/channels.test.ts`

**Interfaces:**
- Produces: `CHANNELS`, `type ChannelId`, `channelById`, `bandClassFor`, `markClassFor`, `commissionFor`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import {
  CHANNELS, channelById, bandClassFor, markClassFor, commissionFor,
} from "@/lib/counter/channels"

describe("channels", () => {
  it("knows the four the restaurant actually sells through", () => {
    expect(CHANNELS.map((c) => c.id)).toEqual(["house", "doordash", "ubereats", "grubhub"])
  })

  it("carries the commission each marketplace takes, from one place", () => {
    expect(commissionFor("house")).toBe(0)
    expect(commissionFor("doordash")).toBe(0.25)
    expect(commissionFor("ubereats")).toBe(0.23)
    expect(commissionFor("grubhub")).toBe(0.20)
  })

  it("maps a channel to a BAND class fixed to the channel, never to its rank", () => {
    // The same channel gets the same band whatever order it is drawn in.
    expect(bandClassFor("house")).toBe(bandClassFor("house"))
    expect(new Set(CHANNELS.map((c) => bandClassFor(c.id))).size).toBe(4)
  })

  it("band classes are the lightness-separated mx ramp, not the brand hexes", () => {
    expect(CHANNELS.map((c) => bandClassFor(c.id)))
      .toEqual(["bg-ct-mx-1", "bg-ct-mx-2", "bg-ct-mx-3", "bg-ct-mx-4"])
  })

  it("mark classes ARE the brand colours — identity, used beside a label", () => {
    expect(markClassFor("doordash")).toBe("text-ct-ch-dd")
    expect(markClassFor("house")).toBe("text-ct-ch-house")
  })

  it("channelById is exhaustive and throws on an unknown id rather than returning undefined", () => {
    expect(channelById("grubhub").name).toBe("Grubhub")
    // @ts-expect-error — an unknown id must not type-check either
    expect(() => channelById("deliveroo")).toThrow(/unknown channel/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/counter/channels.test.ts`
Expected: FAIL — cannot resolve `@/lib/counter/channels`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Channels have two visual jobs and they must not be confused.
 *
 * IDENTITY — `markClassFor` returns the brand colour, for a small mark that
 * sits beside a text label. DoorDash red, Grubhub orange, and so on.
 *
 * DATA — `bandClassFor` returns a step on the `mx` ramp, which is separated by
 * LIGHTNESS, not hue. Notes 36 and 41: run the four brand hexes through a
 * colour-vision check and they clear only dE 8.5 as a set, so a stacked chart
 * drawn in brand colours is unreadable for a large minority of people. The mx
 * ramp clears dE 15 under all three CVD models.
 *
 * The band is fixed to the CHANNEL, not to its rank in the data. A range where
 * DoorDash outsells in-house must not repaint the chart.
 */

export type ChannelId = "house" | "doordash" | "ubereats" | "grubhub"

export interface Channel {
  id: ChannelId
  name: string
  /** The commission this marketplace takes on an order. In-house takes none. */
  commission: number
  /** Brand colour utility — identity only, always beside a text label. */
  markClass: string
  /** mx ramp step — data only, fixed to this channel forever. */
  bandClass: string
}

export const CHANNELS: readonly Channel[] = [
  { id: "house", name: "In-house", commission: 0, markClass: "text-ct-ch-house", bandClass: "bg-ct-mx-1" },
  { id: "doordash", name: "DoorDash", commission: 0.25, markClass: "text-ct-ch-dd", bandClass: "bg-ct-mx-2" },
  { id: "ubereats", name: "Uber Eats", commission: 0.23, markClass: "text-ct-ch-ue", bandClass: "bg-ct-mx-3" },
  { id: "grubhub", name: "Grubhub", commission: 0.20, markClass: "text-ct-ch-gh", bandClass: "bg-ct-mx-4" },
] as const

export function channelById(id: ChannelId): Channel {
  const c = CHANNELS.find((x) => x.id === id)
  // Throwing rather than returning undefined: a missing channel is a
  // programming error, and a silent undefined would render a blank swatch.
  if (!c) throw new Error(`unknown channel: ${id}`)
  return c
}

export const commissionFor = (id: ChannelId): number => channelById(id).commission
export const bandClassFor = (id: ChannelId): string => channelById(id).bandClass
export const markClassFor = (id: ChannelId): string => channelById(id).markClass
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/counter/channels.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter/channels.ts tests/lib/counter/channels.test.ts
git commit -m "feat(counter): brand marks are identity, bands are data"
```

---

### Task 5: The five state components

These are the renderings that make note 22 true. They exist once; the surface primitives call them; pages never see them.

**Files:**
- Create: `src/components/counter/state/skeleton.tsx`
- Create: `src/components/counter/state/failed.tsx`
- Create: `src/components/counter/state/empty.tsx`
- Create: `src/components/counter/state/stale.tsx`
- Create: `src/components/counter/state/owed.tsx`
- Test: `tests/components/counter/state.test.tsx`

**Interfaces:**
- Consumes: `EmptyReason` from `@/lib/counter/section-data`.
- Produces: `<Skeleton rows?>`, `<Failed error retryAction onRetry?>`, `<Empty reason>`, `<StaleBanner lastGoodAt>`, `<Owed owed>`.

- [ ] **Step 0: Install the DOM matchers this and every later component test needs**

`@testing-library/jest-dom` is NOT currently installed, and `toHaveAttribute` —
used by this task and several later ones — comes from it. Install it and extend
the existing setup file rather than importing it per test file.

```bash
npm install -D @testing-library/jest-dom
```

Then append to `tests/setup/testing-library.ts`:

```ts
// DOM matchers (toHaveAttribute, toBeVisible, …). Imported once here rather
// than per file: every Counter component test needs them, and a test that
// silently lacks a matcher fails in a confusing way.
import "@testing-library/jest-dom/vitest"
```

Verify it took effect before writing anything else:

Run: `npx vitest run tests/app/counter-theme.test.tsx`
Expected: PASS — the existing suite still works with the matchers loaded.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { Skeleton } from "@/components/counter/state/skeleton"
import { Failed } from "@/components/counter/state/failed"
import { Empty } from "@/components/counter/state/empty"
import { StaleBanner } from "@/components/counter/state/stale"
import { Owed } from "@/components/counter/state/owed"

describe("Skeleton", () => {
  it("renders the shape of what is coming, and says so to a screen reader", () => {
    const { container } = render(<Skeleton rows={3} />)
    expect(container.querySelectorAll("[data-skeleton-row]")).toHaveLength(3)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
  })
})

describe("Failed", () => {
  it("names the failure rather than saying something went wrong", () => {
    render(<Failed error="Otter sync timed out" retryAction="retrySync" />)
    expect(screen.getByText(/Otter sync timed out/)).toBeTruthy()
  })

  it("offers a retry that calls back with the action name", () => {
    const onRetry = vi.fn()
    render(<Failed error="x" retryAction="retrySync" onRetry={onRetry} />)
    screen.getByRole("button", { name: /retry/i }).click()
    expect(onRetry).toHaveBeenCalledWith("retrySync")
  })

  it("renders no retry control when nothing can act on it", () => {
    render(<Failed error="x" retryAction="retrySync" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("Empty", () => {
  it("a pre-open store is explained, not apologised for", () => {
    render(<Empty reason="pre_open" />)
    expect(screen.getByText(/not trading yet/i)).toBeTruthy()
  })

  it("a filter that matched nothing offers a different next step", () => {
    render(<Empty reason="no_match" />)
    expect(screen.getByText(/nothing matched/i)).toBeTruthy()
  })
})

describe("StaleBanner", () => {
  it("says the figures are the last good run and when that was", () => {
    render(<StaleBanner lastGoodAt={new Date(2026, 7, 24, 9, 0)} />)
    expect(screen.getByRole("status").textContent).toMatch(/last good/i)
  })
})

describe("Owed", () => {
  it("names what is not computed yet instead of showing a zero", () => {
    render(<Owed owed="clock-in/out leak ledger" />)
    expect(screen.getByText(/clock-in\/out leak ledger/)).toBeTruthy()
    expect(screen.queryByText("0")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/state.test.tsx`
Expected: FAIL — cannot resolve `@/components/counter/state/skeleton`.

- [ ] **Step 3: Write the five components**

`src/components/counter/state/skeleton.tsx`:

```tsx
/**
 * The shape of the page arriving, so a reader knows what is coming before the
 * figures land. Deliberately not a spinner: a spinner says "wait", a skeleton
 * says "here is what you are waiting for".
 */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-skeleton-row className="flex gap-3">
          <span className="h-3 flex-1 rounded-ct-sm bg-ct-sunk" />
          <span className="h-3 flex-1 rounded-ct-sm bg-ct-sunk" />
          <span className="h-3 flex-1 rounded-ct-sm bg-ct-sunk" />
          <span className="h-3 flex-1 rounded-ct-sm bg-ct-sunk" />
        </div>
      ))}
    </div>
  )
}
```

`src/components/counter/state/failed.tsx`:

```tsx
/**
 * One section failed; the rest of the page is untouched and its figures are
 * still good. That is how this app already behaves, and saying so is the
 * difference between a page a reader still trusts and one they abandon.
 *
 * `retryAction` is a name rather than a function so a SectionData can cross the
 * server/client boundary. The client component that renders a Section maps the
 * name to a handler and passes `onRetry`; without one, no control is offered,
 * because a button that does nothing is worse than no button.
 */
export function Failed({
  error,
  retryAction,
  onRetry,
}: {
  error: string
  retryAction: string
  onRetry?: (action: string) => void
}) {
  return (
    <div role="alert" className="rounded-ct border border-ct-bad/40 bg-ct-bad-wash p-4">
      <p className="text-ct-body text-ct-ink">
        This section failed to load. Everything else on the page is unaffected, and the figures you
        can see are still good.
      </p>
      <p className="mt-1 font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">{error}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={() => onRetry(retryAction)}
          className="mt-3 rounded-ct-sm border border-ct-line-strong px-3 py-1.5 text-ct-cap text-ct-ink hover:bg-ct-sunk"
        >
          Retry
        </button>
      ) : null}
    </div>
  )
}
```

`src/components/counter/state/empty.tsx`:

```tsx
import type { EmptyReason } from "@/lib/counter/section-data"

/**
 * Two reasons, two different next steps (note 23). A pre-open store has no
 * sales because it has no customers — nothing is broken and there is nothing to
 * fix. A filter that matched nothing is a dead end the reader backs out of.
 * Rendering both as "No data" would hide which situation the reader is in.
 */
const COPY: Record<EmptyReason, { head: string; body: string }> = {
  pre_open: {
    head: "Not trading yet",
    body: "This store has no sales because it has no customers yet. Figures appear here once it opens.",
  },
  no_match: {
    head: "Nothing matched",
    body: "No rows fall inside the current filters and date range. Widen either to see figures.",
  },
}

export function Empty({ reason }: { reason: EmptyReason }) {
  const { head, body } = COPY[reason]
  return (
    <div className="rounded-ct border border-ct-line bg-ct-chrome p-6 text-center">
      <p className="text-ct-mid text-ct-ink">{head}</p>
      <p className="mx-auto mt-1 max-w-prose text-ct-body text-ct-ink-2">{body}</p>
    </div>
  )
}
```

`src/components/counter/state/stale.tsx`:

```tsx
/**
 * The sync failed, so these are the last good figures rather than current ones.
 * The reader needs both facts: the numbers are real, and they are not fresh.
 */
export function StaleBanner({ lastGoodAt }: { lastGoodAt: Date }) {
  const when = lastGoodAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  return (
    <div
      role="status"
      className="mb-3 flex items-baseline gap-2 rounded-ct-sm border border-ct-signal-line bg-ct-signal-wash px-3 py-2"
    >
      <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-signal-ink">
        Last good run
      </span>
      <span className="text-ct-cap text-ct-ink-2">
        {when} — the sync has not succeeded since, so the figures below are not current.
      </span>
    </div>
  )
}
```

`src/components/counter/state/owed.tsx`:

```tsx
/**
 * This section is designed but not computed yet.
 *
 * The alternatives are worse: a zero reads as a measurement, and an absent
 * section reads as a design that never wanted it. Naming the owed work is the
 * only option that is honest about what the reader is not being shown.
 */
export function Owed({ owed }: { owed: string }) {
  return (
    <div className="rounded-ct border border-dashed border-ct-line-strong bg-ct-chrome p-6 text-center">
      <p className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
        Not computed yet
      </p>
      <p className="mx-auto mt-2 max-w-prose text-ct-body text-ct-ink-2">
        {owed} — designed, not yet built. Nothing is shown rather than a figure that would be wrong.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/state.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify the design rules hold**

Run: `npm run tokens`
Expected: `Counter rules: clean`. If it reports a violation in these files, fix the file — do not weaken the rule.

- [ ] **Step 6: Commit**

```bash
git add src/components/counter/state tests/components/counter/state.test.tsx
git commit -m "feat(counter): the five states, implemented once"
```

---

### Task 6: Section — the keystone

Every other surface primitive follows this pattern. Get it right here and the rest are variations.

**Files:**
- Create: `src/components/counter/surface/section.tsx`
- Test: `tests/components/counter/section.test.tsx`

**Interfaces:**
- Consumes: `SectionData`, `hasData` from `@/lib/counter/section-data`; all five state components.
- Produces: `<Section<T> title meta? data askAbout? onRetry? children>` where `children: (data: T) => ReactNode`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { Section } from "@/components/counter/surface/section"
import { ready, stale, loading, failed, empty, notComputed } from "@/lib/counter/section-data"

const body = (d: { n: number }) => <p>value {d.n}</p>

describe("Section", () => {
  it("renders its children only when data is present", () => {
    render(<Section title="Net sales" data={ready({ n: 7 })}>{body}</Section>)
    expect(screen.getByText("value 7")).toBeTruthy()
  })

  it("renders the skeleton while loading, and never calls children", () => {
    const spy = vi.fn(body)
    render(<Section title="Net sales" data={loading()}>{spy}</Section>)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    expect(spy).not.toHaveBeenCalled()
  })

  it("renders the failure without touching the rest of the page", () => {
    render(<Section title="Net sales" data={failed("sync timed out", "retrySync")}>{body}</Section>)
    expect(screen.getByRole("alert")).toBeTruthy()
    expect(screen.queryByText(/value/)).toBeNull()
  })

  it("renders the empty reason it was given", () => {
    render(<Section title="Net sales" data={empty("pre_open")}>{body}</Section>)
    expect(screen.getByText(/not trading yet/i)).toBeTruthy()
  })

  it("renders owed work by name", () => {
    render(<Section title="Leak ledger" data={notComputed("clock-in/out leak ledger")}>{body}</Section>)
    expect(screen.getByText(/clock-in\/out leak ledger/)).toBeTruthy()
  })

  it("stale renders the banner AND the data — the figures are still real", () => {
    render(
      <Section title="Net sales" data={stale({ n: 7 }, new Date(2026, 7, 24, 9, 0))}>{body}</Section>,
    )
    expect(screen.getByRole("status").textContent).toMatch(/last good/i)
    expect(screen.getByText("value 7")).toBeTruthy()
  })

  it("shows the title in every state, so a reader knows what failed", () => {
    for (const d of [ready({ n: 1 }), loading(), failed("x", "y"), empty("no_match"), notComputed("z")]) {
      const { unmount } = render(<Section title="Net sales" data={d}>{body}</Section>)
      expect(screen.getByRole("heading", { name: "Net sales" })).toBeTruthy()
      unmount()
    }
  })

  it("shows meta only when there is data to describe", () => {
    const { unmount } = render(
      <Section title="Net sales" meta="last 30 days" data={ready({ n: 1 })}>{body}</Section>,
    )
    expect(screen.getByText("last 30 days")).toBeTruthy()
    unmount()
    render(<Section title="Net sales" meta="last 30 days" data={loading()}>{body}</Section>)
    expect(screen.queryByText("last 30 days")).toBeNull()
  })

  it("offers Ask about this only when there is an answer to ask about", () => {
    const { unmount } = render(
      <Section title="Net sales" askAbout data={ready({ n: 1 })}>{body}</Section>,
    )
    expect(screen.getByRole("button", { name: /ask about this/i })).toBeTruthy()
    unmount()
    render(<Section title="Net sales" askAbout data={loading()}>{body}</Section>)
    expect(screen.queryByRole("button", { name: /ask about this/i })).toBeNull()
  })

  it("asks about the section by its own title unless told otherwise", () => {
    render(<Section title="Net sales" askAbout data={ready({ n: 1 })}>{body}</Section>)
    expect(screen.getByRole("button", { name: /ask about this/i }))
      .toHaveAttribute("data-ask-about", "Net sales")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/section.test.tsx`
Expected: FAIL — cannot resolve `@/components/counter/surface/section`.

- [ ] **Step 3: Write the implementation**

```tsx
import type { ReactNode } from "react"
import { hasData, type SectionData } from "@/lib/counter/section-data"
import { Skeleton } from "@/components/counter/state/skeleton"
import { Failed } from "@/components/counter/state/failed"
import { Empty } from "@/components/counter/state/empty"
import { StaleBanner } from "@/components/counter/state/stale"
import { Owed } from "@/components/counter/state/owed"

/**
 * The keystone. Prototype note 22 in one component.
 *
 * A page author writes `<Section title="…" data={x}>{d => …}</Section>` and
 * gets all six states, correctly, with no opportunity to get them wrong —
 * because `children` is a function that only runs when data exists. There is no
 * code path in which a page renders a figure that is not there.
 *
 * This is also why `npm run tokens` forbids a page from inspecting
 * `SectionData.status`: the check belongs here, once.
 */
export function Section<T>({
  title,
  meta,
  data,
  askAbout,
  onRetry,
  children,
}: {
  title: string
  /** A short qualifier — the range, the store, the row count. Shown only with data. */
  meta?: string
  data: SectionData<T>
  /** `true` asks about the section by its title; a string asks about that instead. */
  askAbout?: boolean | string
  onRetry?: (action: string) => void
  children: (data: T) => ReactNode
}) {
  const withData = hasData(data)
  const askTarget = askAbout === true ? title : askAbout

  return (
    <section className="rounded-ct border border-ct-line bg-ct-surface p-5">
      <div className="mb-4 flex items-baseline gap-3">
        <h3 className="text-ct-mid text-ct-ink">{title}</h3>
        {withData && meta ? (
          <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
            {meta}
          </span>
        ) : null}
        {/* Note 55: this button was rendered on fifty pages and wired to nothing.
            It appears only when there is an answer to ask about, and it carries
            the question with it so the Ask surface does not have to guess. */}
        {withData && askTarget ? (
          <button
            type="button"
            data-ask-about={askTarget}
            className="ml-auto font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3 hover:text-ct-accent"
          >
            Ask about this
          </button>
        ) : null}
      </div>

      {data.status === "loading" ? <Skeleton /> : null}
      {data.status === "failed" ? (
        <Failed error={data.error} retryAction={data.retryAction} onRetry={onRetry} />
      ) : null}
      {data.status === "empty" ? <Empty reason={data.reason} /> : null}
      {data.status === "not_computed" ? <Owed owed={data.owed} /> : null}
      {data.status === "stale" ? <StaleBanner lastGoodAt={data.lastGoodAt} /> : null}
      {withData ? children(data.data) : null}
    </section>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/section.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/surface/section.tsx tests/components/counter/section.test.tsx
git commit -m "feat(counter): the section that makes a wrong state unwritable"
```

---

### Task 7: Strip and Figure

The ruled strip is the design's alternative to a card grid of numbers. `Figure` is one cell of it, usable alone as a page's lead figure.

**Files:**
- Create: `src/components/counter/surface/figure.tsx`
- Create: `src/components/counter/surface/strip.tsx`
- Test: `tests/components/counter/strip.test.tsx`

**Interfaces:**
- Consumes: `TABULAR` from `@/lib/counter/format`; `SectionData`, `hasData`.
- Produces: `<Figure label value caption? delta? size?>`, `<Strip data cells>` where `cells: (data: T) => FigureProps[]`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Figure } from "@/components/counter/surface/figure"
import { Strip } from "@/components/counter/surface/strip"
import { ready, loading, empty } from "@/lib/counter/section-data"

describe("Figure", () => {
  it("renders label, value and caption", () => {
    render(<Figure label="Net sales" value="$7,468" caption="gross $9,681" />)
    expect(screen.getByText("Net sales")).toBeTruthy()
    expect(screen.getByText("$7,468")).toBeTruthy()
    expect(screen.getByText("gross $9,681")).toBeTruthy()
  })

  it("every figure carries tabular lining numerals, or columns do not line up", () => {
    render(<Figure label="Net sales" value="$7,468" />)
    expect(screen.getByText("$7,468").className).toMatch(/tabular-nums/)
    expect(screen.getByText("$7,468").className).toMatch(/lining-nums/)
  })

  it("a lead figure is larger than a strip cell", () => {
    const { container: lead } = render(<Figure label="a" value="1" size="lead" />)
    const { container: cell } = render(<Figure label="a" value="1" />)
    expect(lead.querySelector("[data-figure-value]")!.className)
      .not.toBe(cell.querySelector("[data-figure-value]")!.className)
  })

  it("renders a delta when given one", () => {
    render(<Figure label="Net sales" value="$7,468" delta="▲ 11.4%" />)
    expect(screen.getByText("▲ 11.4%")).toBeTruthy()
  })
})

describe("Strip", () => {
  const cells = () => [
    { label: "Net sales", value: "$7,468" },
    { label: "Orders", value: "376" },
    { label: "Avg ticket", value: "$19.86" },
  ]

  it("renders one cell per figure when data is present", () => {
    const { container } = render(<Strip data={ready({})} cells={cells} />)
    expect(container.querySelectorAll("[data-figure-value]")).toHaveLength(3)
  })

  it("renders skeleton cells while loading, keeping the shape", () => {
    const { container } = render(<Strip data={loading()} cells={cells} cellCount={3} />)
    expect(container.querySelectorAll("[data-skeleton-cell]")).toHaveLength(3)
  })

  it("renders em-dashes rather than zeroes when empty", () => {
    render(<Strip data={empty("pre_open")} cells={cells} cellCount={3} />)
    expect(screen.getAllByText("—")).toHaveLength(3)
    expect(screen.queryByText("$0")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/strip.test.tsx`
Expected: FAIL — cannot resolve `@/components/counter/surface/figure`.

- [ ] **Step 3: Write both components**

`src/components/counter/surface/figure.tsx`:

```tsx
import { TABULAR } from "@/lib/counter/format"

export interface FigureProps {
  label: string
  /** Pre-formatted. Formatting belongs to `@/lib/counter/format`, not here. */
  value: string
  caption?: string
  delta?: string
  /** `lead` is the one headline figure on a page; the default is a strip cell. */
  size?: "lead" | "cell"
}

/**
 * One figure: what it is, what it reads, and what it is being judged against.
 *
 * The value is always DM Sans with tabular lining numerals — without them a
 * column of figures does not align, which is the whole reason the design
 * mandates them.
 */
export function Figure({ label, value, caption, delta, size = "cell" }: FigureProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
        {label}
      </span>
      <span
        data-figure-value
        className={
          size === "lead"
            ? `text-ct-hero font-semibold text-ct-ink ${TABULAR}`
            : `text-ct-xl font-semibold text-ct-ink ${TABULAR}`
        }
      >
        {value}
      </span>
      {delta ? <span className={`text-ct-cap text-ct-ink-2 ${TABULAR}`}>{delta}</span> : null}
      {caption ? <span className="text-ct-cap text-ct-ink-3">{caption}</span> : null}
    </div>
  )
}
```

`src/components/counter/surface/strip.tsx`:

```tsx
import { hasData, type SectionData } from "@/lib/counter/section-data"
import { Figure, type FigureProps } from "./figure"

/**
 * A ruled strip of figures — the design's answer to a card grid, which turns
 * every number into a box and makes none of them the point.
 *
 * The strip keeps its SHAPE in every state. A loading strip shows the same
 * number of cells it will show when loaded, and an empty one shows em-dashes,
 * so the layout does not jump when figures land.
 */
export function Strip<T>({
  data,
  cells,
  cellCount,
}: {
  data: SectionData<T>
  cells: (data: T) => FigureProps[]
  /** How many cells to reserve before data exists. Defaults to 4. */
  cellCount?: number
}) {
  const n = cellCount ?? 4

  if (hasData(data)) {
    const items = cells(data.data)
    return (
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-ct bg-ct-line md:grid-cols-4">
        {items.map((c) => (
          <div key={c.label} className="bg-ct-surface p-4">
            <Figure {...c} />
          </div>
        ))}
      </div>
    )
  }

  if (data.status === "loading") {
    return (
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-ct bg-ct-line md:grid-cols-4">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} data-skeleton-cell className="bg-ct-surface p-4">
            <span className="mb-2 block h-2 w-1/2 rounded-ct-sm bg-ct-sunk" />
            <span className="block h-6 w-3/4 rounded-ct-sm bg-ct-sunk" />
          </div>
        ))}
      </div>
    )
  }

  // empty, failed and not_computed all reserve the shape with em-dashes. A
  // Section renders the explanation above; the strip's job is to not collapse.
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-ct bg-ct-line md:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="bg-ct-surface p-4">
          <span className="block text-ct-xl text-ct-ink-3">—</span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/strip.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/surface/figure.tsx src/components/counter/surface/strip.tsx tests/components/counter/strip.test.tsx
git commit -m "feat(counter): one lead figure, one ruled strip, no card grid"
```

---

### Task 8: Table

Note 47 is the reason this component is worth writing carefully: 248 rows across the prototype wore a pointer and an accent hover wash and led nowhere. A row that opens nothing must not look like it does.

**Files:**
- Create: `src/components/counter/surface/table.tsx`
- Test: `tests/components/counter/table.test.tsx`

**Interfaces:**
- Consumes: `TABULAR`; `SectionData`, `hasData`.
- Produces: `<Table data columns rows>`, `interface Column`, `interface Row`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Table } from "@/components/counter/surface/table"
import { ready, loading, empty } from "@/lib/counter/section-data"

const columns = [
  { key: "store", label: "Store" },
  { key: "orders", label: "Orders", numeric: true },
  { key: "net", label: "Net", numeric: true },
]

const rows = () => [
  { key: "hollywood", cells: ["Hollywood", "376", "$7,468"], href: "/dashboard/stores/hollywood" },
  { key: "glendale", cells: ["Glendale", "—", "—"] },
]

describe("Table", () => {
  it("renders a head and a row per record", () => {
    render(<Table data={ready({})} columns={columns} rows={rows} />)
    expect(screen.getAllByRole("columnheader")).toHaveLength(3)
    expect(screen.getAllByRole("row")).toHaveLength(3) // head + 2
  })

  it("right-aligns numeric columns and gives their cells tabular numerals", () => {
    render(<Table data={ready({})} columns={columns} rows={rows} />)
    const cell = screen.getByText("$7,468")
    expect(cell.className).toMatch(/text-right/)
    expect(cell.className).toMatch(/tabular-nums/)
  })

  it("a row with a destination is a link and is reachable by keyboard", () => {
    render(<Table data={ready({})} columns={columns} rows={rows} />)
    const link = screen.getByRole("link", { name: /Hollywood/ })
    expect(link).toHaveAttribute("href", "/dashboard/stores/hollywood")
  })

  it("a row that opens nothing is NOT a link, not focusable, and wears no pointer", () => {
    render(<Table data={ready({})} columns={columns} rows={rows} />)
    const glendale = screen.getByText("Glendale").closest("tr")!
    expect(glendale.querySelector("a")).toBeNull()
    expect(glendale.getAttribute("tabindex")).toBeNull()
    expect(glendale.className).not.toMatch(/cursor-pointer/)
    // and the navigable one does wear it
    const hollywood = screen.getByRole("link", { name: /Hollywood/ }).closest("tr")!
    expect(hollywood.className).toMatch(/cursor-pointer/)
  })

  it("the head is sticky, because a long table read without headers is unreadable", () => {
    render(<Table data={ready({})} columns={columns} rows={rows} />)
    expect(screen.getAllByRole("columnheader")[0].className).toMatch(/sticky/)
  })

  it("scrolls horizontally inside its own container rather than the page", () => {
    const { container } = render(<Table data={ready({})} columns={columns} rows={rows} />)
    expect(container.querySelector("[data-table-scroll]")!.className).toMatch(/overflow-x-auto/)
  })

  it("renders a skeleton while loading and calls rows() never", () => {
    let called = false
    render(
      <Table data={loading()} columns={columns} rows={() => { called = true; return [] }} />,
    )
    expect(called).toBe(false)
    expect(screen.getByRole("status")).toBeTruthy()
  })

  it("renders nothing but the head when empty, so the columns still explain themselves", () => {
    render(<Table data={empty("no_match")} columns={columns} rows={rows} />)
    expect(screen.getAllByRole("columnheader")).toHaveLength(3)
    expect(screen.queryByText("Hollywood")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/table.test.tsx`
Expected: FAIL — cannot resolve `@/components/counter/surface/table`.

- [ ] **Step 3: Write the implementation**

```tsx
import Link from "next/link"
import { TABULAR } from "@/lib/counter/format"
import { hasData, type SectionData } from "@/lib/counter/section-data"
import { Skeleton } from "@/components/counter/state/skeleton"

export interface Column {
  key: string
  label: string
  /** Right-aligned and tabular. Every figure column should set this. */
  numeric?: boolean
}

export interface Row {
  key: string
  cells: React.ReactNode[]
  /** Where this row opens. Omit it and the row is inert — see note 47. */
  href?: string
}

/**
 * Horizontal rules only, sticky head, right-aligned figures.
 *
 * Note 47 is why the `href` handling is written the way it is: in the
 * prototype, `.tbl tbody tr` set `cursor:pointer` and an accent hover wash on
 * EVERY row of EVERY table, and not one of them led anywhere. A row that opens
 * nothing must not be focusable, must not wear a pointer, and must not light up
 * under the cursor — otherwise the table lies about what it can do.
 */
export function Table<T>({
  data,
  columns,
  rows,
}: {
  data: SectionData<T>
  columns: Column[]
  rows: (data: T) => Row[]
}) {
  const items = hasData(data) ? rows(data.data) : []

  return (
    <div data-table-scroll className="overflow-x-auto">
      <table className="w-full border-collapse text-ct-body">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`sticky top-0 z-10 border-b border-ct-line-strong bg-ct-surface px-3 py-2 font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3 ${
                  c.numeric ? "text-right" : "text-left"
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const navigable = Boolean(r.href)
            return (
              <tr
                key={r.key}
                className={
                  navigable
                    ? "cursor-pointer border-b border-ct-line hover:bg-ct-accent-wash"
                    : "border-b border-ct-line"
                }
              >
                {r.cells.map((cell, i) => {
                  const c = columns[i]
                  const content =
                    navigable && i === 0 ? (
                      <Link href={r.href!} className="block">
                        {cell}
                      </Link>
                    ) : (
                      cell
                    )
                  return (
                    <td
                      key={c.key}
                      className={`px-3 py-2 text-ct-ink ${
                        c.numeric ? `text-right ${TABULAR}` : "text-left"
                      }`}
                    >
                      {content}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      {data.status === "loading" ? (
        <div className="p-3">
          <Skeleton rows={4} />
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/table.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/surface/table.tsx tests/components/counter/table.test.tsx
git commit -m "feat(counter): a row that opens nothing no longer pretends otherwise"
```

---

### Task 9: Meter and Cascade

Two figure shapes the design calls for that have no equivalent in the current app. Note 35: colour the overshoot, not the measure. Note 52: a statement is a sequence of subtractions, so it is drawn as one.

**Files:**
- Create: `src/components/counter/surface/meter.tsx`
- Create: `src/components/counter/surface/cascade.tsx`
- Test: `tests/components/counter/meter-cascade.test.tsx`

**Interfaces:**
- Consumes: `TABULAR`.
- Produces: `<Meter label value reference max format>`, `<Cascade steps>` with `interface CascadeStep`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Meter } from "@/components/counter/surface/meter"
import { Cascade } from "@/components/counter/surface/cascade"

describe("Meter", () => {
  it("draws the reference line where the target sits", () => {
    const { container } = render(
      <Meter label="Prime cost" value={0.562} reference={0.6} max={1} format={(v) => `${(v * 100).toFixed(1)}%`} />,
    )
    const ref = container.querySelector("[data-meter-reference]") as HTMLElement
    expect(ref.style.left).toBe("60%")
  })

  it("under the reference, nothing is coloured as a breach", () => {
    const { container } = render(
      <Meter label="Prime cost" value={0.562} reference={0.6} max={1} format={(v) => `${v}`} />,
    )
    expect(container.querySelector("[data-meter-overshoot]")).toBeNull()
  })

  it("over the reference, ONLY the distance past it is coloured", () => {
    const { container } = render(
      <Meter label="Prime cost" value={0.65} reference={0.6} max={1} format={(v) => `${v}`} />,
    )
    const over = container.querySelector("[data-meter-overshoot]") as HTMLElement
    expect(over).toBeTruthy()
    // 0.65 - 0.60 = 0.05 of a max of 1 → 5% wide, starting at the reference.
    expect(over.style.width).toBe("5%")
    expect(over.style.left).toBe("60%")
    // the measure itself is NOT painted as bad — note 35
    expect((container.querySelector("[data-meter-fill]") as HTMLElement).className)
      .not.toMatch(/bg-ct-bad\b/)
  })
})

describe("Cascade", () => {
  const steps = [
    { label: "Sales (ex-tax)", amount: 6972.89, kind: "start" as const },
    { label: "COGS", amount: -1973.9, kind: "subtract" as const },
    { label: "Labor", amount: -883.37, kind: "subtract" as const },
    { label: "Net profit", amount: 2002.71, kind: "end" as const },
  ]

  it("renders a bar per step", () => {
    const { container } = render(<Cascade steps={steps} />)
    expect(container.querySelectorAll("[data-cascade-step]")).toHaveLength(4)
  })

  it("shows what is LEFT after each subtraction, not the size of the subtraction", () => {
    const { container } = render(<Cascade steps={steps} />)
    const bars = container.querySelectorAll("[data-cascade-remaining]")
    // after COGS: 6972.89 - 1973.90 = 4998.99 of 6972.89 → ~71.7%
    expect((bars[1] as HTMLElement).style.width).toBe("71.7%")
  })

  it("labels every step with its own amount", () => {
    render(<Cascade steps={steps} />)
    expect(screen.getByText("Sales (ex-tax)")).toBeTruthy()
    expect(screen.getByText("Net profit")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/meter-cascade.test.tsx`
Expected: FAIL — cannot resolve `@/components/counter/surface/meter`.

- [ ] **Step 3: Write both components**

`src/components/counter/surface/meter.tsx`:

```tsx
import { TABULAR } from "@/lib/counter/format"

/**
 * A measure against a published reference.
 *
 * Note 35: colour the OVERSHOOT, not the measure. Painting the whole bar red on
 * a breach reads as "a lot of bad"; painting only the distance past the line
 * reads as "past the line by this much", which is the actual information.
 */
export function Meter({
  label,
  value,
  reference,
  max,
  format,
}: {
  label: string
  value: number
  reference: number
  max: number
  format: (v: number) => string
}) {
  const pctOf = (v: number) => `${round1((v / max) * 100)}%`
  const over = value > reference

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
          {label}
        </span>
        <span className={`text-ct-mid font-semibold text-ct-ink ${TABULAR}`}>{format(value)}</span>
      </div>
      <div className="relative h-3 w-full rounded-ct-sm bg-ct-sunk">
        <span
          data-meter-fill
          className="absolute inset-y-0 left-0 rounded-ct-sm bg-ct-ink-3"
          style={{ width: pctOf(Math.min(value, reference)) }}
        />
        {over ? (
          <span
            data-meter-overshoot
            className="absolute inset-y-0 bg-ct-bad"
            style={{ left: pctOf(reference), width: pctOf(value - reference) }}
          />
        ) : null}
        <span
          data-meter-reference
          className="absolute inset-y-[-2px] w-px bg-ct-line-strong"
          style={{ left: pctOf(reference) }}
        />
      </div>
      <span className="font-ct-mono text-ct-micro text-ct-ink-3">
        target {format(reference)}
      </span>
    </div>
  )
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
```

`src/components/counter/surface/cascade.tsx`:

```tsx
import { TABULAR, money } from "@/lib/counter/format"

export interface CascadeStep {
  label: string
  /** Negative for a subtraction. The sign carries the meaning. */
  amount: number
  kind: "start" | "subtract" | "end"
}

/**
 * A statement drawn as what it is: a sequence of subtractions.
 *
 * Note 52: the old page answered "where does the revenue go" with a five-slice
 * donut, which answers "what share" — a different question. Each bar here is
 * what is LEFT after that subtraction, so the reader watches the money run
 * down rather than comparing wedges.
 */
export function Cascade({ steps }: { steps: CascadeStep[] }) {
  const start = steps.find((s) => s.kind === "start")?.amount ?? 0

  let running = 0
  const rows = steps.map((s) => {
    running = s.kind === "start" ? s.amount : s.kind === "end" ? s.amount : running + s.amount
    return { ...s, remaining: running }
  })

  return (
    <div className="flex flex-col gap-3">
      {rows.map((r) => (
        <div key={r.label} data-cascade-step className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <span className="text-ct-body text-ct-ink">{r.label}</span>
            <span className={`text-ct-body text-ct-ink-2 ${TABULAR}`}>{money(r.amount, { cents: true })}</span>
          </div>
          <div className="h-2 w-full rounded-ct-sm bg-ct-sunk">
            <span
              data-cascade-remaining
              className={`block h-2 rounded-ct-sm ${r.kind === "end" ? "bg-ct-accent" : "bg-ct-ink-3"}`}
              style={{ width: `${round1((r.remaining / start) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/meter-cascade.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/surface/meter.tsx src/components/counter/surface/cascade.tsx tests/components/counter/meter-cascade.test.tsx
git commit -m "feat(counter): colour the overshoot; draw the statement as subtractions"
```

---

### Task 10: The barrel, and proving the boundary holds

A page must be able to import everything it needs from one path, and must NOT be able to reach the state components directly. This task makes both true and proves the second with a test rather than a convention.

**Files:**
- Create: `src/components/counter/index.ts`
- Create: `tests/components/counter/boundary.test.ts`
- Modify: `DESIGN.md`

**Interfaces:**
- Produces: the public Counter surface — `Section`, `Strip`, `Figure`, `Table`, `Meter`, `Cascade`, plus the `state` components' absence from it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const BARREL = join(process.cwd(), "src/components/counter/index.ts")
const SURFACE = join(process.cwd(), "src/components/counter/surface")
const STATE = join(process.cwd(), "src/components/counter/state")

describe("the Counter public surface", () => {
  it("re-exports every surface primitive, so a page imports from one place", () => {
    const barrel = readFileSync(BARREL, "utf8")
    for (const f of readdirSync(SURFACE).filter((f) => f.endsWith(".tsx"))) {
      const name = f.replace(/\.tsx$/, "")
      expect(barrel).toMatch(new RegExp(`from "\\./surface/${name}"`))
    }
  })

  it("does NOT re-export the state components — they belong to surface/ alone", () => {
    const barrel = readFileSync(BARREL, "utf8")
    expect(barrel).not.toMatch(/\.\/state\//)
  })

  it("state components are imported only by surface components", () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (p !== STATE && p !== SURFACE) walk(p)
          continue
        }
        if (!p.endsWith(".tsx") && !p.endsWith(".ts")) continue
        if (readFileSync(p, "utf8").includes("counter/state/")) offenders.push(p)
      }
    }
    walk(join(process.cwd(), "src"))
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/boundary.test.ts`
Expected: FAIL — cannot read `src/components/counter/index.ts`.

- [ ] **Step 3: Write the barrel**

```ts
/**
 * The Counter public surface.
 *
 * A page imports from here and nowhere deeper. Note the deliberate omission:
 * `state/` is NOT re-exported. Those five components are the implementation of
 * note 22 — states live in the builders — and a page that reached one directly
 * would be re-implementing state handling, which is exactly what this design
 * exists to prevent. `tests/components/counter/boundary.test.ts` enforces it.
 */
export { Section } from "./surface/section"
export { Strip } from "./surface/strip"
export { Figure, type FigureProps } from "./surface/figure"
export { Table, type Column, type Row } from "./surface/table"
export { Meter } from "./surface/meter"
export { Cascade, type CascadeStep } from "./surface/cascade"

export { CounterThemeProvider, useCounterTheme, themeNoFlashScript } from "./theme-provider"
export { ThemeToggle } from "./theme-toggle"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/boundary.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Document the primitives in DESIGN.md**

Add a section to `DESIGN.md` under the existing content. Do not restate token values; describe what exists and what rule each primitive enforces.

```markdown
## Primitives

Import from `@/components/counter`. Never deeper — `state/` is private to
`surface/` on purpose.

| Primitive | Enforces |
|---|---|
| `<Section>` | All six `SectionData` states. `children` is a function, so it cannot run without data. Renders "Ask about this" only when there is an answer (note 55). |
| `<Strip>` | Keeps its shape in every state, so the layout does not jump when figures land. Em-dashes, never zeroes. |
| `<Figure>` | Tabular lining numerals on every value. |
| `<Table>` | Rules only, sticky head, right-aligned figures. A row without `href` is not a link, not focusable, and wears no pointer (note 47). |
| `<Meter>` | Colours the overshoot, not the measure (note 35). |
| `<Cascade>` | Draws a statement as the sequence of subtractions it is, not a donut (note 52). |

The data they all take is `SectionData<T>` from `@/lib/counter/section-data`.
Six states: `ready`, `stale`, `loading`, `failed`, `empty`, `not_computed`.
A page never inspects `.status` — `npm run tokens` fails the build if one does.
```

- [ ] **Step 6: Run the full gate**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
```

Expected: all pass. Test count at least 1838 + this plan's additions; 8 skips unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/components/counter/index.ts tests/components/counter/boundary.test.ts DESIGN.md
git commit -m "feat(counter): one import path, and a boundary that is tested not trusted"
```

---

## Done when

- `src/lib/counter/` holds `section-data.ts`, `format.ts`, `date-range.ts`, `channels.ts`, each with tests
- `src/components/counter/state/` holds the five state components
- `src/components/counter/surface/` holds Section, Strip, Figure, Table, Meter, Cascade
- A page can write `<Section title="…" data={x}>{d => …}</Section>` and get all six states with no state code of its own
- `tests/components/counter/boundary.test.ts` proves no file outside `surface/` imports from `state/`
- `npm run tokens` reports clean — every primitive uses `ct-` utilities only
- Full gate green

## Next plan

Plan 3 — motion (`useEntry`, `useCountUp`, `useChartDraw`, all reduced-motion
aware), then `<Chart>` and `<Toast>` which depend on it. `<Chart>` must budget
for the asymmetry the Task 3 spike established: line charts get hover,
crosshair, dot, card and a 720ms draw-on for free, while bars need `Cell` plus
per-series mouse state for the 42% dim and a custom `shape` render prop for the
26ms stagger. Still unproven and to be settled there: the comparison overlay,
dimming and stagger on non-horizontal bars, and `prefers-reduced-motion` at
runtime.
