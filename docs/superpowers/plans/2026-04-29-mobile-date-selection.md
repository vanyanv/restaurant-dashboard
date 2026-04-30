# Mobile Date Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Custom date pill (with editorial-styled bottom-sheet calendar) to the mobile toolbar, and give `/m/pnl` its own finance-tuned pill row with the same Custom option plus a granularity toggle.

**Architecture:** Pure URL state. `?period=custom&start=YYYY-MM-DD&end=YYYY-MM-DD` (P&L additionally accepts `&grain=daily|weekly|monthly`). The mobile toolbar stays server-rendered; the Custom pill is a tiny client island that lazy-imports a bottom-sheet calendar. P&L has its own toolbar component with finance-tuned named periods. The calendar primitive is decoupled from the sheet shell so both sheets reuse it.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind v4, editorial.css design tokens (`--ink`, `--accent`, `--paper`, `--hairline`, `--hairline-bold`, etc.), no shadcn `<Card>`. No automated test framework configured — verification is `npm run build` (typecheck + bundle) plus manual mobile-viewport check on the dev server. **Important:** Per `CLAUDE.md`, never introduce generic Tailwind colors on `/dashboard` *or* `/m` routes — only editorial tokens.

**Spec:** [docs/superpowers/specs/2026-04-29-mobile-date-selection-design.md](../specs/2026-04-29-mobile-date-selection-design.md)

---

## Verification convention (no test runner)

This project ships no Vitest/Jest. Each task ends with:

1. `npm run build` — must pass with zero type errors and zero new ESLint warnings.
2. Manual check on the dev server at the URL listed in the task's "Verify" step. Use Chrome DevTools mobile viewport at iPhone 14 (390×844) unless stated otherwise.
3. Commit with a focused message.

If a task is purely a pure-function refactor with obvious behavior, you may skip the manual UI check but still run `npm run build`.

---

## Task 1: Extend `MobilePeriod` to support custom ranges

**Files:**
- Modify: `src/lib/mobile/period.ts`

- [ ] **Step 1: Extend the `MobilePeriod` type and add custom-range parsing.**

Replace the contents of [src/lib/mobile/period.ts](../../../src/lib/mobile/period.ts) with:

```ts
import { todayInLA, startOfDayLA, endOfDayLA, localDateStr } from "@/lib/dashboard-utils"
import type { HourlyComparisonPeriod } from "@/types/analytics"

export type MobileNamedPeriod = "today" | "yesterday" | "this-week" | "last-week"
export type MobilePeriod = MobileNamedPeriod | "custom"

export const MOBILE_PERIODS: Array<{ value: MobileNamedPeriod; label: string; short: string }> = [
  { value: "today", label: "Today", short: "TODAY" },
  { value: "yesterday", label: "Yesterday", short: "YEST" },
  { value: "this-week", label: "This week", short: "WK" },
  { value: "last-week", label: "Last week", short: "LAST WK" },
]

const NAMED_VALUES = new Set<MobileNamedPeriod>(MOBILE_PERIODS.map((p) => p.value))

/** Max custom range we'll honor before falling back to default. */
export const MAX_CUSTOM_RANGE_DAYS = 365

export type MobileRange =
  | { kind: "named"; period: MobileNamedPeriod }
  | { kind: "custom"; start: Date; end: Date; startStr: string; endStr: string }

/**
 * Read `?period=…&start=…&end=…` from a Next.js page's searchParams.
 * Falls back to "today" for invalid combos (bad ISO, end<start, range too long).
 */
export function parseMobileRange(sp: {
  period?: string
  start?: string
  end?: string
}): MobileRange {
  const raw = sp.period
  if (raw === "custom") {
    const custom = parseCustomRange(sp.start, sp.end)
    if (custom) return custom
    // Invalid custom → silent fallback.
    return { kind: "named", period: "today" }
  }
  if (raw && NAMED_VALUES.has(raw as MobileNamedPeriod)) {
    return { kind: "named", period: raw as MobileNamedPeriod }
  }
  return { kind: "named", period: "today" }
}

/** Back-compat: old callers that just want a named period. Returns "today" for "custom". */
export function parsePeriod(raw: string | undefined | null): MobileNamedPeriod {
  if (raw && NAMED_VALUES.has(raw as MobileNamedPeriod)) return raw as MobileNamedPeriod
  return "today"
}

/** Mobile period maps 1:1 to the hourly-pattern enum on the analytics action.
 *  Custom currently isn't supported by that action, so callers must guard. */
export function toHourlyPeriod(p: MobileNamedPeriod): HourlyComparisonPeriod {
  return p
}

function isValidIsoDate(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + "T00:00:00.000Z")
  return !Number.isNaN(d.getTime())
}

function parseCustomRange(
  startStr: string | undefined,
  endStr: string | undefined,
): Extract<MobileRange, { kind: "custom" }> | null {
  if (!isValidIsoDate(startStr) || !isValidIsoDate(endStr)) return null
  const start = startOfDayLA(startStr)
  const end = endOfDayLA(endStr)
  if (end.getTime() < start.getTime()) return null
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
  if (days > MAX_CUSTOM_RANGE_DAYS) return null
  return { kind: "custom", start, end, startStr, endStr }
}

/**
 * Resolve a mobile period into a concrete date range in LA local time.
 * Weeks are Sunday-anchored (matches the dashboard's existing convention).
 */
export function periodToDateRange(p: MobileNamedPeriod): {
  startDate: Date
  endDate: Date
  /** Number of LA-local days in the window (inclusive). */
  dayCount: number
} {
  const today = todayInLA()
  const todayStart = startOfDayLA(today)

  if (p === "today") {
    return { startDate: todayStart, endDate: endOfDayLA(today), dayCount: 1 }
  }
  if (p === "yesterday") {
    const y = new Date(todayStart)
    y.setDate(y.getDate() - 1)
    return {
      startDate: y,
      endDate: new Date(y.getTime() + 24 * 60 * 60 * 1000 - 1),
      dayCount: 1,
    }
  }
  // This week / last week, Sunday-anchored. getUTCDay because startOfDayLA
  // returns a Date pinned to UTC midnight on the LA-local day, so getUTCDay
  // is the right way to read the LA-local weekday.
  const dayOfWeek = todayStart.getUTCDay()
  const weekStart = new Date(todayStart)
  weekStart.setDate(weekStart.getDate() - dayOfWeek)

  if (p === "this-week") {
    return {
      startDate: weekStart,
      endDate: endOfDayLA(today),
      dayCount: dayOfWeek + 1,
    }
  }
  // last-week
  const lastWeekStart = new Date(weekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)
  const lastWeekEnd = new Date(weekStart)
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1)
  lastWeekEnd.setUTCHours(23, 59, 59, 999)
  return {
    startDate: lastWeekStart,
    endDate: lastWeekEnd,
    dayCount: 7,
  }
}

/** YYYY-MM-DD strings for every LA-local day in the window (inclusive). */
export function periodDateStrings(p: MobileNamedPeriod): string[] {
  const { startDate, endDate } = periodToDateRange(p)
  const out: string[] = []
  const d = new Date(startDate)
  while (d <= endDate) {
    out.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** Inclusive day count between two LA-local Dates. */
export function rangeDayCount(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
}

/** Format a custom range as "MAR 5 → APR 20" (caps, em-arrow) for the active pill. */
export function formatCustomRangeShort(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
  return `${fmt.format(start).toUpperCase()} → ${fmt.format(end).toUpperCase()}`
}

/** Format a custom range as "MAR 5 — APR 20 · 47 DAYS" for the sheet readout. */
export function formatCustomRangeLong(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
  const days = rangeDayCount(start, end)
  return `${fmt.format(start).toUpperCase()} — ${fmt.format(end).toUpperCase()} · ${days} DAY${days === 1 ? "" : "S"}`
}

export { localDateStr }
```

- [ ] **Step 2: Update existing call sites that imported `MobilePeriod`.**

Run:

```bash
grep -rn "MobilePeriod" src --include="*.ts" --include="*.tsx"
```

For each hit, decide whether the call site needs the named-only type or the union. Action:
- Files that pass the value into `periodToDateRange` or `toHourlyPeriod`: change the type to `MobileNamedPeriod` (these helpers no longer accept "custom").
- Files that just want to round-trip the URL value: keep `MobilePeriod` (the union).

Specifically, audit and update:
- `src/components/mobile/m-toolbar.tsx` — `period` prop should change from `MobilePeriod` to `MobilePeriod` (the union, unchanged) — but its `MOBILE_PERIODS.map` is fine because that's the named subset.
- `src/app/(mobile)/m/page.tsx`, `analytics/page.tsx`, `operations/page.tsx`, `orders/page.tsx`, `invoices/page.tsx` — switch from `parsePeriod()` (which returns named-only) to `parseMobileRange(searchParams)` and branch on `range.kind`. If `kind === "custom"`, build the date window from `range.start`/`range.end` directly; if `kind === "named"`, call `periodToDateRange(range.period)`.

Don't make these changes yet — do them in the page-wiring tasks (Tasks 7 & 8). For now, leave the page files untouched: `parsePeriod()` remains exported and continues to work for them.

- [ ] **Step 3: Verify build passes.**

```bash
npm run build
```

Expected: build succeeds, no new type errors. (Pages still call `parsePeriod()` — that's fine; we'll migrate them in later tasks.)

- [ ] **Step 4: Commit.**

```bash
git add src/lib/mobile/period.ts
git commit -m "mobile: extend MobilePeriod with custom range parsing + helpers"
```

---

## Task 2: Add P&L period module

**Files:**
- Create: `src/lib/mobile/pnl-period.ts`

- [ ] **Step 1: Write the new module.**

Create [src/lib/mobile/pnl-period.ts](../../../src/lib/mobile/pnl-period.ts):

```ts
import type { Granularity } from "@/lib/pnl"
import {
  MAX_CUSTOM_RANGE_DAYS,
  rangeDayCount,
} from "@/lib/mobile/period"
import { startOfDayLA, endOfDayLA } from "@/lib/dashboard-utils"
import {
  PNL_PRESETS,
  type PnLRangeState,
} from "@/components/pnl/pnl-date-presets"

export type MobilePnLNamedPeriod =
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "last-8-weeks"

export type MobilePnLPeriod = MobilePnLNamedPeriod | "custom"

export const MOBILE_PNL_PERIODS: Array<{
  value: MobilePnLNamedPeriod
  label: string
  short: string
  /** Maps to a key in PNL_PRESETS so we don't duplicate range math. */
  presetKey: string
}> = [
  { value: "this-week", label: "This week", short: "WK", presetKey: "thisWeek" },
  { value: "last-week", label: "Last week", short: "LAST WK", presetKey: "lastWeek" },
  { value: "this-month", label: "This month", short: "MO", presetKey: "thisMonth" },
  { value: "last-month", label: "Last month", short: "LAST MO", presetKey: "lastMonth" },
  { value: "last-8-weeks", label: "Last 8 weeks", short: "8 WKS", presetKey: "last8Weeks" },
]

const NAMED_VALUES = new Set<MobilePnLNamedPeriod>(MOBILE_PNL_PERIODS.map((p) => p.value))
const VALID_GRAINS = new Set<Granularity>(["daily", "weekly", "monthly"])

/** Default P&L view when no params are present (preserves existing behavior). */
export const DEFAULT_PNL_PERIOD: MobilePnLNamedPeriod = "last-8-weeks"

export type MobilePnLRange =
  | { kind: "named"; period: MobilePnLNamedPeriod }
  | {
      kind: "custom"
      start: Date
      end: Date
      startStr: string
      endStr: string
      grain: Granularity
      /** True if `grain` was derived from range length (not user-chosen). */
      grainAuto: boolean
    }

/**
 * Auto-pick granularity from range length:
 * - ≤14 days → daily
 * - ≤70 days (10 weeks) → weekly
 * - else monthly
 */
export function autoGrain(start: Date, end: Date): Granularity {
  const days = rangeDayCount(start, end)
  if (days <= 14) return "daily"
  if (days <= 70) return "weekly"
  return "monthly"
}

export function parsePnLRange(sp: {
  period?: string
  start?: string
  end?: string
  grain?: string
}): MobilePnLRange {
  const raw = sp.period
  if (raw === "custom") {
    const custom = parsePnLCustom(sp.start, sp.end, sp.grain)
    if (custom) return custom
    return { kind: "named", period: DEFAULT_PNL_PERIOD }
  }
  if (raw && NAMED_VALUES.has(raw as MobilePnLNamedPeriod)) {
    return { kind: "named", period: raw as MobilePnLNamedPeriod }
  }
  return { kind: "named", period: DEFAULT_PNL_PERIOD }
}

function parsePnLCustom(
  startStr: string | undefined,
  endStr: string | undefined,
  grainStr: string | undefined,
): Extract<MobilePnLRange, { kind: "custom" }> | null {
  if (!startStr || !endStr) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) return null
  const start = startOfDayLA(startStr)
  const end = endOfDayLA(endStr)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  if (end.getTime() < start.getTime()) return null
  if (rangeDayCount(start, end) > MAX_CUSTOM_RANGE_DAYS) return null

  const auto = autoGrain(start, end)
  let grain: Granularity = auto
  let grainAuto = true
  if (grainStr && VALID_GRAINS.has(grainStr as Granularity)) {
    grain = grainStr as Granularity
    grainAuto = grainStr === auto
  }
  return { kind: "custom", start, end, startStr, endStr, grain, grainAuto }
}

/** Resolve a P&L range (named or custom) into the existing `PnLRangeState`
 *  shape that `getStorePnL` / `getAllStoresPnL` accept. */
export function pnlRangeToState(range: MobilePnLRange): PnLRangeState {
  if (range.kind === "custom") {
    return {
      startDate: range.start,
      endDate: range.end,
      granularity: range.grain,
      preset: undefined,
    }
  }
  const meta = MOBILE_PNL_PERIODS.find((p) => p.value === range.period)!
  const preset = PNL_PRESETS.find((p) => p.key === meta.presetKey)!
  return preset.compute()
}
```

- [ ] **Step 2: Verify build.**

```bash
npm run build
```

Expected: passes with no type errors.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/mobile/pnl-period.ts
git commit -m "mobile: add P&L period module (finance presets + autoGrain)"
```

---

## Task 3: Editorial calendar primitive

**Files:**
- Create: `src/components/mobile/date-sheet/editorial-calendar.tsx`
- Modify: `src/styles/editorial.css` (append calendar block)

- [ ] **Step 1: Add the calendar CSS to `src/styles/editorial.css`.**

Append at the end of the file:

```css
/* ─────────────────────────────────────────────────────────────────
   Editorial date-range calendar (mobile sheet) — paired with
   <EditorialCalendar />. Two stacked month grids; range fill uses
   the same red wash as .inv-row hover so the system reads as one. */

.ed-cal {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.ed-cal__month {
  border: 1px solid var(--hairline);
  border-radius: 2px;
  background: var(--paper);
  padding: 14px 12px 12px;
}

.ed-cal__month-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.ed-cal__month-title {
  font-family: var(--font-fraunces, "Fraunces"), Georgia, serif;
  font-style: italic;
  font-size: 16px;
  color: var(--ink);
  letter-spacing: 0.005em;
}

.ed-cal__nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--hairline);
  border-radius: 2px;
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  transition: color 120ms ease, background-color 120ms ease;
}
.ed-cal__nav:hover { color: var(--ink); background: rgba(0,0,0,0.02); }
.ed-cal__nav:disabled { color: var(--ink-faint); cursor: not-allowed; }

.ed-cal__weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0;
  margin-bottom: 4px;
}

.ed-cal__weekday {
  text-align: center;
  font-family: var(--font-jetbrains-mono, "JetBrains Mono"), ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-faint);
  padding: 6px 0;
}

.ed-cal__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0;
}

.ed-cal__day {
  position: relative;
  aspect-ratio: 1 / 1;
  border: 0;
  background: transparent;
  font-family: var(--font-dm-sans), ui-sans-serif, sans-serif;
  font-size: 14px;
  font-weight: 500;
  font-variant-numeric: tabular-nums lining-nums;
  color: var(--ink);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 120ms ease;
}

.ed-cal__day--blank { cursor: default; pointer-events: none; }

.ed-cal__day--disabled {
  color: var(--ink-faint);
  cursor: not-allowed;
}

.ed-cal__day--in-range {
  background: rgba(220, 38, 38, 0.045);
}

.ed-cal__day--start,
.ed-cal__day--end {
  color: var(--accent-dark);
  font-weight: 600;
}

.ed-cal__day--start::after,
.ed-cal__day--end::after {
  content: "";
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: 6px;
  height: 2px;
  background: var(--accent);
  transform-origin: center;
  animation: edCalUnderline 220ms cubic-bezier(0.25, 1, 0.5, 1) backwards;
}

.ed-cal__day--today::before {
  content: "TODAY";
  position: absolute;
  top: 4px;
  left: 0;
  right: 0;
  text-align: center;
  font-family: var(--font-jetbrains-mono, "JetBrains Mono"), ui-monospace, monospace;
  font-size: 7px;
  letter-spacing: 0.16em;
  color: var(--ink-faint);
}

.ed-cal__day:not(.ed-cal__day--blank):not(.ed-cal__day--disabled):hover {
  color: var(--accent);
}

.ed-cal__day:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px rgba(220, 38, 38, 0.18);
}

@keyframes edCalUnderline {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .ed-cal__day--start::after,
  .ed-cal__day--end::after { animation: none; }
}
```

- [ ] **Step 2: Create the component file.**

Create [src/components/mobile/date-sheet/editorial-calendar.tsx](../../../src/components/mobile/date-sheet/editorial-calendar.tsx):

```tsx
"use client"

import { useMemo, useState } from "react"
import { localDateStr } from "@/lib/dashboard-utils"

type Props = {
  initialStart: Date | null
  initialEnd: Date | null
  /** YYYY-MM-DD; days strictly after this are disabled. Defaults to today. */
  maxDateStr?: string
  onChange: (start: Date | null, end: Date | null) => void
}

/**
 * Pure two-month range picker. Knows nothing about sheets, URLs, or apply
 * buttons — the parent owns commit. Tap once to set start, tap again to set
 * end. A third tap (or tapping a date earlier than current start) resets
 * start and clears end.
 */
export function EditorialCalendar({
  initialStart,
  initialEnd,
  maxDateStr,
  onChange,
}: Props) {
  // The "anchor" month is the right-hand (newer) of the two visible months.
  // Default to the month containing initialEnd, or the current month.
  const [anchor, setAnchor] = useState<Date>(() => {
    const seed = initialEnd ?? initialStart ?? new Date()
    return new Date(seed.getFullYear(), seed.getMonth(), 1)
  })

  const [start, setStart] = useState<Date | null>(initialStart)
  const [end, setEnd] = useState<Date | null>(initialEnd)

  const todayStr = localDateStr(new Date())
  const maxStr = maxDateStr ?? todayStr

  const olderMonth = useMemo(() => addMonths(anchor, -1), [anchor])

  function handleDayClick(d: Date) {
    if (!start || (start && end)) {
      // Begin a new range.
      setStart(d)
      setEnd(null)
      onChange(d, null)
      return
    }
    // start is set, end is not.
    if (d.getTime() < start.getTime()) {
      // Earlier than start → treat as new start.
      setStart(d)
      setEnd(null)
      onChange(d, null)
      return
    }
    setEnd(d)
    onChange(start, d)
  }

  return (
    <div className="ed-cal">
      <Month
        month={olderMonth}
        start={start}
        end={end}
        maxStr={maxStr}
        todayStr={todayStr}
        onDayClick={handleDayClick}
        onPrev={() => setAnchor(addMonths(anchor, -1))}
        onNext={null}
      />
      <Month
        month={anchor}
        start={start}
        end={end}
        maxStr={maxStr}
        todayStr={todayStr}
        onDayClick={handleDayClick}
        onPrev={null}
        onNext={() => setAnchor(addMonths(anchor, 1))}
        nextDisabled={isSameMonth(anchor, todayDate())}
      />
    </div>
  )
}

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const MONTH_FMT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
})

function Month({
  month,
  start,
  end,
  maxStr,
  todayStr,
  onDayClick,
  onPrev,
  onNext,
  nextDisabled,
}: {
  month: Date
  start: Date | null
  end: Date | null
  maxStr: string
  todayStr: string
  onDayClick: (d: Date) => void
  onPrev: (() => void) | null
  onNext: (() => void) | null
  nextDisabled?: boolean
}) {
  const year = month.getFullYear()
  const m = month.getMonth()
  const firstWeekday = new Date(year, m, 1).getDay()
  const daysInMonth = new Date(year, m + 1, 0).getDate()

  const cells: Array<{ key: string; date: Date | null }> = []
  for (let i = 0; i < firstWeekday; i++) cells.push({ key: `b${i}`, date: null })
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ key: `d${day}`, date: new Date(year, m, day) })
  }

  return (
    <div className="ed-cal__month">
      <div className="ed-cal__month-head">
        {onPrev ? (
          <button
            type="button"
            className="ed-cal__nav"
            onClick={onPrev}
            aria-label="Previous month"
          >
            ‹
          </button>
        ) : (
          <span style={{ width: 32 }} aria-hidden />
        )}
        <span className="ed-cal__month-title">{MONTH_FMT.format(month)}</span>
        {onNext ? (
          <button
            type="button"
            className="ed-cal__nav"
            onClick={onNext}
            disabled={nextDisabled}
            aria-label="Next month"
          >
            ›
          </button>
        ) : (
          <span style={{ width: 32 }} aria-hidden />
        )}
      </div>

      <div className="ed-cal__weekdays" role="presentation">
        {WEEKDAYS.map((w) => (
          <span key={w} className="ed-cal__weekday">{w}</span>
        ))}
      </div>

      <div className="ed-cal__grid" role="grid">
        {cells.map((c) => {
          if (!c.date) {
            return <span key={c.key} className="ed-cal__day ed-cal__day--blank" />
          }
          const ds = localDateStr(c.date)
          const disabled = ds > maxStr
          const isStart = !!start && ds === localDateStr(start)
          const isEnd = !!end && ds === localDateStr(end)
          const inRange =
            !!start && !!end && c.date.getTime() > start.getTime() && c.date.getTime() < end.getTime()
          const isToday = ds === todayStr

          const className = [
            "ed-cal__day",
            disabled ? "ed-cal__day--disabled" : "",
            inRange ? "ed-cal__day--in-range" : "",
            isStart ? "ed-cal__day--start" : "",
            isEnd ? "ed-cal__day--end" : "",
            isToday ? "ed-cal__day--today" : "",
          ]
            .filter(Boolean)
            .join(" ")

          return (
            <button
              key={c.key}
              type="button"
              className={className}
              disabled={disabled}
              aria-pressed={isStart || isEnd}
              aria-label={c.date.toDateString()}
              onClick={() => onDayClick(c.date!)}
            >
              {c.date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1)
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

function todayDate(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
```

- [ ] **Step 3: Verify build.**

```bash
npm run build
```

Expected: passes.

- [ ] **Step 4: Commit.**

```bash
git add src/styles/editorial.css src/components/mobile/date-sheet/editorial-calendar.tsx
git commit -m "mobile: editorial range calendar primitive (two-month grid)"
```

---

## Task 4: Bottom-sheet shell (shared)

**Files:**
- Create: `src/components/mobile/date-sheet/date-sheet-shell.tsx`
- Modify: `src/styles/editorial.css` (append sheet block)

- [ ] **Step 1: Add sheet CSS.**

Append to `src/styles/editorial.css`:

```css
/* ─────────────────────────────────────────────────────────────────
   Mobile bottom sheet — paired with <DateSheetShell />.
   Editorial register: hairline-bold border on top, paper bg, no shadow. */

.m-sheet__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 18, 14, 0.32);
  z-index: 80;
  animation: mSheetFade 160ms cubic-bezier(0.32, 0.72, 0, 1);
}

.m-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 81;
  background: var(--paper);
  border-top: 1px solid var(--hairline-bold);
  border-top-left-radius: 2px;
  border-top-right-radius: 2px;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  animation: mSheetUp 220ms cubic-bezier(0.32, 0.72, 0, 1);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.m-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--hairline);
}

.m-sheet__head-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.m-sheet__proofmark {
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 1px;
  display: inline-block;
}

.m-sheet__close {
  border: 0;
  background: transparent;
  color: var(--ink-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 4px 6px;
}
.m-sheet__close:hover { color: var(--ink); }

.m-sheet__body {
  padding: 14px 16px 16px;
  overflow-y: auto;
  flex: 1;
}

.m-sheet__readout {
  font-family: var(--font-dm-sans), ui-sans-serif, sans-serif;
  font-size: 12.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums lining-nums;
  color: var(--ink);
  margin-bottom: 12px;
}

.m-sheet__readout--placeholder { color: var(--ink-faint); font-weight: 400; }

.m-sheet__foot {
  display: flex;
  gap: 10px;
  padding: 12px 16px 14px;
  border-top: 1px solid var(--hairline);
}

.m-sheet__btn {
  flex: 1;
  font-family: var(--font-jetbrains-mono, "JetBrains Mono"), ui-monospace, monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  padding: 14px 0;
  border-radius: 2px;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}

.m-sheet__btn--ghost {
  background: transparent;
  color: var(--ink-muted);
  border: 1px solid var(--hairline-bold);
}
.m-sheet__btn--ghost:hover { color: var(--ink); }

.m-sheet__btn--primary {
  background: var(--accent);
  color: var(--paper);
  border: 1px solid var(--accent);
}
.m-sheet__btn--primary:disabled {
  background: var(--hairline);
  border-color: var(--hairline);
  color: var(--ink-faint);
  cursor: not-allowed;
}

@keyframes mSheetUp {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}
@keyframes mSheetFade {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .m-sheet, .m-sheet__backdrop { animation: none; }
}
```

- [ ] **Step 2: Create the shell component.**

Create [src/components/mobile/date-sheet/date-sheet-shell.tsx](../../../src/components/mobile/date-sheet/date-sheet-shell.tsx):

```tsx
"use client"

import { useEffect, type ReactNode } from "react"

type Props = {
  open: boolean
  onClose: () => void
  /** Caps cap shown in the header, e.g. "DATE RANGE". */
  dept: string
  children: ReactNode
  footer: ReactNode
}

export function DateSheetShell({ open, onClose, dept, children, footer }: Props) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="m-sheet__backdrop" onClick={onClose} aria-hidden />
      <div
        className="m-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={dept}
      >
        <div className="m-sheet__head">
          <span className="m-sheet__head-left">
            <span className="m-sheet__proofmark" aria-hidden />
            <span className="m-cap">{dept}</span>
          </span>
          <button
            type="button"
            className="m-sheet__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="m-sheet__body">{children}</div>
        <div className="m-sheet__foot">{footer}</div>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Verify build.**

```bash
npm run build
```

- [ ] **Step 4: Commit.**

```bash
git add src/styles/editorial.css src/components/mobile/date-sheet/date-sheet-shell.tsx
git commit -m "mobile: editorial bottom-sheet shell with backdrop + safe-area"
```

---

## Task 5: Toolbar custom-range sheet

**Files:**
- Create: `src/components/mobile/date-sheet/m-toolbar-custom-sheet.tsx`

- [ ] **Step 1: Create the component.**

Create [src/components/mobile/date-sheet/m-toolbar-custom-sheet.tsx](../../../src/components/mobile/date-sheet/m-toolbar-custom-sheet.tsx):

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { localDateStr } from "@/lib/dashboard-utils"
import { formatCustomRangeLong } from "@/lib/mobile/period"
import { DateSheetShell } from "./date-sheet-shell"
import { EditorialCalendar } from "./editorial-calendar"

type Props = {
  open: boolean
  onClose: () => void
  pathname: string
  searchParams: Record<string, string | undefined>
  initialStart: Date | null
  initialEnd: Date | null
}

export function MToolbarCustomSheet({
  open,
  onClose,
  pathname,
  searchParams,
  initialStart,
  initialEnd,
}: Props) {
  const router = useRouter()
  const [start, setStart] = useState<Date | null>(initialStart)
  const [end, setEnd] = useState<Date | null>(initialEnd)

  function apply() {
    if (!start || !end) return
    const merged: Record<string, string> = {}
    for (const [k, v] of Object.entries(searchParams)) {
      if (v != null && v !== "" && k !== "period" && k !== "start" && k !== "end" && k !== "grain") {
        merged[k] = v
      }
    }
    merged.period = "custom"
    merged.start = localDateStr(start)
    merged.end = localDateStr(end)
    const qs = new URLSearchParams(merged).toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
    onClose()
  }

  const readout = start && end
    ? formatCustomRangeLong(start, end)
    : start
    ? "Pick an end date"
    : "Pick a start date"

  return (
    <DateSheetShell
      open={open}
      onClose={onClose}
      dept="DATE RANGE"
      footer={
        <>
          <button type="button" className="m-sheet__btn m-sheet__btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="m-sheet__btn m-sheet__btn--primary"
            disabled={!start || !end}
            onClick={apply}
          >
            Apply
          </button>
        </>
      }
    >
      <div
        className={`m-sheet__readout${start && end ? "" : " m-sheet__readout--placeholder"}`}
      >
        {readout}
      </div>
      <EditorialCalendar
        initialStart={initialStart}
        initialEnd={initialEnd}
        onChange={(s, e) => {
          setStart(s)
          setEnd(e)
        }}
      />
    </DateSheetShell>
  )
}
```

- [ ] **Step 2: Verify build.**

```bash
npm run build
```

- [ ] **Step 3: Commit.**

```bash
git add src/components/mobile/date-sheet/m-toolbar-custom-sheet.tsx
git commit -m "mobile: toolbar custom-date sheet"
```

---

## Task 6: P&L custom-range sheet (with granularity toggle)

**Files:**
- Create: `src/components/mobile/date-sheet/m-pnl-custom-sheet.tsx`
- Modify: `src/styles/editorial.css` (append granularity-toggle block)

- [ ] **Step 1: Add granularity toggle CSS.**

Append to `src/styles/editorial.css`:

```css
/* Granularity toggle inside the P&L date sheet. Three pills, JetBrains
   Mono caps, accent fill on the active state — same accent visual register
   as the segmented toolbar but smaller. */
.m-grain-toggle {
  display: flex;
  border: 1px solid var(--hairline-bold);
  border-radius: 2px;
  margin-top: 16px;
  overflow: hidden;
}
.m-grain-toggle__item {
  flex: 1;
  padding: 10px 0;
  font-family: var(--font-jetbrains-mono, "JetBrains Mono"), ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-muted);
  background: transparent;
  border: 0;
  border-right: 1px solid var(--hairline);
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}
.m-grain-toggle__item:last-child { border-right: 0; }
.m-grain-toggle__item:hover { color: var(--ink); }
.m-grain-toggle__item.is-active {
  color: var(--accent-dark);
  background: var(--accent-bg);
}
.m-grain-toggle__label {
  display: block;
  margin-top: 14px;
  margin-bottom: 4px;
  font-family: var(--font-jetbrains-mono, "JetBrains Mono"), ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.m-grain-toggle__hint {
  margin-top: 6px;
  font-family: var(--font-jetbrains-mono, "JetBrains Mono"), ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
```

- [ ] **Step 2: Create the component.**

Create [src/components/mobile/date-sheet/m-pnl-custom-sheet.tsx](../../../src/components/mobile/date-sheet/m-pnl-custom-sheet.tsx):

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { localDateStr } from "@/lib/dashboard-utils"
import { formatCustomRangeLong } from "@/lib/mobile/period"
import { autoGrain } from "@/lib/mobile/pnl-period"
import type { Granularity } from "@/lib/pnl"
import { DateSheetShell } from "./date-sheet-shell"
import { EditorialCalendar } from "./editorial-calendar"

type Props = {
  open: boolean
  onClose: () => void
  pathname: string
  searchParams: Record<string, string | undefined>
  initialStart: Date | null
  initialEnd: Date | null
  initialGrain: Granularity | null
}

const GRAIN_OPTIONS: Array<{ value: Granularity; short: string }> = [
  { value: "daily", short: "DAILY" },
  { value: "weekly", short: "WEEKLY" },
  { value: "monthly", short: "MONTHLY" },
]

export function MPnLCustomSheet({
  open,
  onClose,
  pathname,
  searchParams,
  initialStart,
  initialEnd,
  initialGrain,
}: Props) {
  const router = useRouter()
  const [start, setStart] = useState<Date | null>(initialStart)
  const [end, setEnd] = useState<Date | null>(initialEnd)
  // null = "auto"; once user taps a pill, this holds their override.
  const [grainOverride, setGrainOverride] = useState<Granularity | null>(initialGrain)

  // When the range changes, if the user hasn't explicitly chosen a grain,
  // the displayed grain follows autoGrain.
  const effectiveGrain: Granularity =
    grainOverride ??
    (start && end ? autoGrain(start, end) : "weekly")

  // If the range changes such that the override now matches the auto value,
  // collapse back to auto (so URL omits &grain=).
  useEffect(() => {
    if (grainOverride && start && end && grainOverride === autoGrain(start, end)) {
      setGrainOverride(null)
    }
  }, [grainOverride, start, end])

  function apply() {
    if (!start || !end) return
    const merged: Record<string, string> = {}
    for (const [k, v] of Object.entries(searchParams)) {
      if (v != null && v !== "" && k !== "period" && k !== "start" && k !== "end" && k !== "grain") {
        merged[k] = v
      }
    }
    merged.period = "custom"
    merged.start = localDateStr(start)
    merged.end = localDateStr(end)
    if (grainOverride) merged.grain = grainOverride
    const qs = new URLSearchParams(merged).toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
    onClose()
  }

  const readout = start && end
    ? formatCustomRangeLong(start, end)
    : start
    ? "Pick an end date"
    : "Pick a start date"

  const auto = start && end ? autoGrain(start, end) : null

  return (
    <DateSheetShell
      open={open}
      onClose={onClose}
      dept="DATE RANGE"
      footer={
        <>
          <button type="button" className="m-sheet__btn m-sheet__btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="m-sheet__btn m-sheet__btn--primary"
            disabled={!start || !end}
            onClick={apply}
          >
            Apply
          </button>
        </>
      }
    >
      <div
        className={`m-sheet__readout${start && end ? "" : " m-sheet__readout--placeholder"}`}
      >
        {readout}
      </div>

      <EditorialCalendar
        initialStart={initialStart}
        initialEnd={initialEnd}
        onChange={(s, e) => {
          setStart(s)
          setEnd(e)
        }}
      />

      <span className="m-grain-toggle__label">GRANULARITY</span>
      <div className="m-grain-toggle" role="tablist" aria-label="Granularity">
        {GRAIN_OPTIONS.map((g) => {
          const active = g.value === effectiveGrain
          return (
            <button
              key={g.value}
              type="button"
              role="tab"
              aria-selected={active}
              className={`m-grain-toggle__item${active ? " is-active" : ""}`}
              onClick={() => {
                // Tapping the auto-suggested grain reverts to auto; otherwise sets override.
                if (auto && g.value === auto) {
                  setGrainOverride(null)
                } else {
                  setGrainOverride(g.value)
                }
              }}
            >
              {g.short}
            </button>
          )
        })}
      </div>
      {auto && (
        <span className="m-grain-toggle__hint">
          {grainOverride ? `OVERRIDDEN · AUTO WOULD BE ${auto.toUpperCase()}` : `AUTO · ${auto.toUpperCase()}`}
        </span>
      )}
    </DateSheetShell>
  )
}
```

- [ ] **Step 3: Verify build.**

```bash
npm run build
```

- [ ] **Step 4: Commit.**

```bash
git add src/styles/editorial.css src/components/mobile/date-sheet/m-pnl-custom-sheet.tsx
git commit -m "mobile: P&L custom-date sheet with granularity toggle"
```

---

## Task 7: Custom pill trigger + wire into shared toolbar

**Files:**
- Create: `src/components/mobile/date-sheet/custom-pill-trigger.tsx`
- Modify: `src/components/mobile/m-toolbar.tsx`
- Modify: `src/app/(mobile)/m/page.tsx`
- Modify: `src/app/(mobile)/m/analytics/page.tsx`
- Modify: `src/app/(mobile)/m/operations/page.tsx`
- Modify: `src/app/(mobile)/m/orders/page.tsx`
- Modify: `src/app/(mobile)/m/invoices/page.tsx`

- [ ] **Step 1: Create the trigger component.**

Create [src/components/mobile/date-sheet/custom-pill-trigger.tsx](../../../src/components/mobile/date-sheet/custom-pill-trigger.tsx):

```tsx
"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import type { Granularity } from "@/lib/pnl"

const MToolbarCustomSheet = dynamic(
  () => import("./m-toolbar-custom-sheet").then((m) => m.MToolbarCustomSheet),
  { ssr: false },
)
const MPnLCustomSheet = dynamic(
  () => import("./m-pnl-custom-sheet").then((m) => m.MPnLCustomSheet),
  { ssr: false },
)

type Props = {
  pathname: string
  searchParams: Record<string, string | undefined>
  variant: "toolbar" | "pnl"
  /** True when `period=custom` is active for this page. */
  isActive: boolean
  /** Short label shown on the pill when active (e.g. "MAR 5 → APR 20"). */
  activeLabel?: string
  initialStart: Date | null
  initialEnd: Date | null
  /** P&L only: granularity from URL (or null if auto). */
  initialGrain?: Granularity | null
}

export function CustomPillTrigger({
  pathname,
  searchParams,
  variant,
  isActive,
  activeLabel,
  initialStart,
  initialEnd,
  initialGrain,
}: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        className={`m-segmented__item${isActive ? " is-active" : ""}`}
        style={{ padding: "10px 6px", fontSize: 9.5 }}
        onClick={() => setOpen(true)}
      >
        {isActive && activeLabel ? activeLabel : "CUSTOM"}
      </button>
      {variant === "toolbar" ? (
        <MToolbarCustomSheet
          open={open}
          onClose={() => setOpen(false)}
          pathname={pathname}
          searchParams={searchParams}
          initialStart={initialStart}
          initialEnd={initialEnd}
        />
      ) : (
        <MPnLCustomSheet
          open={open}
          onClose={() => setOpen(false)}
          pathname={pathname}
          searchParams={searchParams}
          initialStart={initialStart}
          initialEnd={initialEnd}
          initialGrain={initialGrain ?? null}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: Update `m-toolbar.tsx` to render the Custom pill and accept the richer range.**

Replace [src/components/mobile/m-toolbar.tsx](../../../src/components/mobile/m-toolbar.tsx):

```tsx
import Link from "next/link"
import {
  MOBILE_PERIODS,
  formatCustomRangeShort,
  type MobileRange,
} from "@/lib/mobile/period"
import { MobileStoreSelect, type ToolbarStore } from "./m-store-select"
import { CustomPillTrigger } from "./date-sheet/custom-pill-trigger"

export type { ToolbarStore }

type Props = {
  /** Current pathname (e.g. "/m" or "/m/analytics") — used to keep the
   *  period segments routing back to the same page. */
  pathname: string
  /** All search params currently on the URL. Preserved when the toolbar
   *  swaps store or period so per-page filters (?status, ?platform, etc.)
   *  don't get dropped. */
  searchParams: Record<string, string | undefined>
  stores: ToolbarStore[]
  storeId: string | null
  /** Resolved range — either a named period or a custom window. */
  range: MobileRange
}

/**
 * Server-rendered toolbar. Named pills are <a> tags so navigation is pure
 * URL — back/forward + opening in new tab Just Works. The Custom pill is a
 * tiny client island because it opens an interactive bottom sheet.
 */
export function MToolbar({
  pathname,
  searchParams,
  stores,
  storeId,
  range,
}: Props) {
  const isCustom = range.kind === "custom"
  return (
    <div
      className="dock-in dock-in-1 m-toolbar"
      style={{
        margin: "0 -16px 14px",
        padding: "0 16px",
        background: "rgba(255, 253, 247, 0.55)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 0",
        }}
      >
        <span className="m-cap">STORE</span>
        <MobileStoreSelect
          stores={stores}
          storeId={storeId}
          pathname={pathname}
          searchParams={searchParams}
        />
      </div>
      <div
        className="m-segmented"
        role="tablist"
        aria-label="Period"
        style={{ margin: "0 -16px" }}
      >
        {MOBILE_PERIODS.map((p) => {
          const active = !isCustom && range.period === p.value
          // When swapping to a named period, drop start/end/grain.
          const next = withParams(searchParams, {
            period: p.value,
            start: null,
            end: null,
            grain: null,
          })
          const href = next ? `${pathname}?${next}` : pathname
          return (
            <Link
              key={p.value}
              href={href}
              role="tab"
              aria-selected={active}
              prefetch={false}
              className={`m-segmented__item${active ? " is-active" : ""}`}
              style={{ padding: "10px 6px", fontSize: 9.5 }}
            >
              {p.short}
            </Link>
          )
        })}
        <CustomPillTrigger
          variant="toolbar"
          pathname={pathname}
          searchParams={searchParams}
          isActive={isCustom}
          activeLabel={isCustom ? formatCustomRangeShort(range.start, range.end) : undefined}
          initialStart={isCustom ? range.start : null}
          initialEnd={isCustom ? range.end : null}
        />
      </div>
    </div>
  )
}

function withParams(
  current: Record<string, string | undefined>,
  patch: Record<string, string | null | undefined>,
): string {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(current)) {
    if (v != null && v !== "") merged[k] = v
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") delete merged[k]
    else merged[k] = v
  }
  const params = new URLSearchParams(merged)
  return params.toString()
}
```

- [ ] **Step 3: Migrate the five consumer pages.**

For each of [src/app/(mobile)/m/page.tsx](../../../src/app/(mobile)/m/page.tsx), [analytics/page.tsx](../../../src/app/(mobile)/m/analytics/page.tsx), [operations/page.tsx](../../../src/app/(mobile)/m/operations/page.tsx), [orders/page.tsx](../../../src/app/(mobile)/m/orders/page.tsx), [invoices/page.tsx](../../../src/app/(mobile)/m/invoices/page.tsx), make the following edits:

1. Replace `import { ..., parsePeriod, periodToDateRange, ... } from "@/lib/mobile/period"` with also importing `parseMobileRange` and the type `MobileRange`.
2. Replace `const period = parsePeriod(sp.period)` with:
   ```ts
   const range = parseMobileRange({ period: sp.period, start: sp.start, end: sp.end })
   ```
3. Wherever the page calls `periodToDateRange(period)`, replace with:
   ```ts
   const window = range.kind === "custom"
     ? { startDate: range.start, endDate: range.end }
     : periodToDateRange(range.period)
   ```
   …and update downstream consumers to use `window.startDate` / `window.endDate`.
4. Replace `<MToolbar … period={period} />` with `<MToolbar … range={range} />`.
5. For pages that call `toHourlyPeriod(period)` (e.g. analytics' hourly chart): if `range.kind === "custom"`, fall back to passing `null` and have the chart show "Hourly comparison unavailable for custom ranges" — or omit the hourly section. The simplest: render hourly only when `range.kind === "named"`, else hide that panel.
6. For each page that previously parsed `searchParams.period` etc., make sure `searchParams.start`, `searchParams.end`, and (P&L only, later) `searchParams.grain` are read into the `sp` object passed to `parseMobileRange`.

**Concrete page-by-page checklist** (read each file before editing — paths above):

- [ ] `src/app/(mobile)/m/page.tsx` — home dashboard. Probably uses `period` in net-total calc; convert to `window` directly.
- [ ] `src/app/(mobile)/m/analytics/page.tsx` — uses `toHourlyPeriod`. Hide the hourly section when `range.kind === "custom"`; otherwise existing logic. Pass `range` into `<MToolbar />`.
- [ ] `src/app/(mobile)/m/operations/page.tsx` — convert to `range` + `window` and update toolbar prop.
- [ ] `src/app/(mobile)/m/orders/page.tsx` — convert to `range` + `window` and update toolbar prop.
- [ ] `src/app/(mobile)/m/invoices/page.tsx` — already imports `MToolbar`. Convert to `range` and pass through. (May not need a window if the page filters by something other than date.)

- [ ] **Step 4: Verify build, then dev-server check.**

```bash
npm run build
```

Expected: passes with no type errors.

Then:

```bash
npm run dev
```

In Chrome at iPhone 14 viewport, sign in and visit each:
- `http://localhost:3000/m` — confirm Custom pill appears at the right of the segmented row, opens a sheet that slides up.
- Pick a 7-day window in the calendar, tap Apply. URL becomes `?period=custom&start=YYYY-MM-DD&end=YYYY-MM-DD`. The Custom pill now shows the date range and is active.
- Tap "WK" — URL drops `start`/`end`, period reverts.
- Repeat smoke test on `/m/analytics`, `/m/operations`, `/m/orders`, `/m/invoices`.
- Browser back/forward must navigate cleanly between named and custom URLs.

- [ ] **Step 5: Commit.**

```bash
git add src/components/mobile/date-sheet/custom-pill-trigger.tsx \
        src/components/mobile/m-toolbar.tsx \
        src/app/\(mobile\)/m/page.tsx \
        src/app/\(mobile\)/m/analytics/page.tsx \
        src/app/\(mobile\)/m/operations/page.tsx \
        src/app/\(mobile\)/m/orders/page.tsx \
        src/app/\(mobile\)/m/invoices/page.tsx
git commit -m "mobile: wire Custom pill into shared toolbar across /m pages"
```

---

## Task 8: P&L toolbar + wire into P&L pages

**Files:**
- Create: `src/components/mobile/m-pnl-toolbar.tsx`
- Modify: `src/app/(mobile)/m/pnl/page.tsx`
- Modify: `src/app/(mobile)/m/pnl/[storeId]/page.tsx`

- [ ] **Step 1: Create the P&L toolbar.**

Create [src/components/mobile/m-pnl-toolbar.tsx](../../../src/components/mobile/m-pnl-toolbar.tsx):

```tsx
import Link from "next/link"
import {
  MOBILE_PNL_PERIODS,
  type MobilePnLRange,
} from "@/lib/mobile/pnl-period"
import { formatCustomRangeShort } from "@/lib/mobile/period"
import { CustomPillTrigger } from "./date-sheet/custom-pill-trigger"

type Props = {
  pathname: string
  searchParams: Record<string, string | undefined>
  range: MobilePnLRange
}

export function MPnLToolbar({ pathname, searchParams, range }: Props) {
  const isCustom = range.kind === "custom"
  return (
    <div
      className="dock-in dock-in-1 m-toolbar"
      style={{
        margin: "0 -16px 14px",
        padding: "0 16px",
        background: "rgba(255, 253, 247, 0.55)",
      }}
    >
      <div
        className="m-segmented"
        role="tablist"
        aria-label="P&L period"
        style={{ margin: "0 -16px" }}
      >
        {MOBILE_PNL_PERIODS.map((p) => {
          const active = !isCustom && range.period === p.value
          const next = withParams(searchParams, {
            period: p.value,
            start: null,
            end: null,
            grain: null,
          })
          const href = next ? `${pathname}?${next}` : pathname
          return (
            <Link
              key={p.value}
              href={href}
              role="tab"
              aria-selected={active}
              prefetch={false}
              className={`m-segmented__item${active ? " is-active" : ""}`}
              style={{ padding: "10px 6px", fontSize: 9 }}
            >
              {p.short}
            </Link>
          )
        })}
        <CustomPillTrigger
          variant="pnl"
          pathname={pathname}
          searchParams={searchParams}
          isActive={isCustom}
          activeLabel={isCustom ? formatCustomRangeShort(range.start, range.end) : undefined}
          initialStart={isCustom ? range.start : null}
          initialEnd={isCustom ? range.end : null}
          initialGrain={isCustom && !range.grainAuto ? range.grain : null}
        />
      </div>
    </div>
  )
}

function withParams(
  current: Record<string, string | undefined>,
  patch: Record<string, string | null | undefined>,
): string {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(current)) {
    if (v != null && v !== "") merged[k] = v
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") delete merged[k]
    else merged[k] = v
  }
  return new URLSearchParams(merged).toString()
}
```

- [ ] **Step 2: Update `/m/pnl/page.tsx` to read URL state and render the toolbar.**

Replace [src/app/(mobile)/m/pnl/page.tsx](../../../src/app/(mobile)/m/pnl/page.tsx):

```tsx
import Link from "next/link"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getAllStoresPnL } from "@/app/actions/store-actions"
import { parsePnLRange, pnlRangeToState } from "@/lib/mobile/pnl-period"
import { PageHead } from "@/components/mobile/page-head"
import {
  MastheadFigures,
  type MastheadCell,
} from "@/components/mobile/masthead-figures"
import { Panel } from "@/components/mobile/panel"
import { MPnLToolbar } from "@/components/mobile/m-pnl-toolbar"

export const dynamic = "force-dynamic"

const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const fmtPct = (n: number) => `${n.toFixed(1)}%`

const PNL_PERIOD_LABELS: Record<string, string> = {
  "this-week": "this week",
  "last-week": "last week",
  "this-month": "this month",
  "last-month": "last month",
  "last-8-weeks": "last 8 weeks",
}

export default async function MobilePnLPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")
  if (session.user.role !== "OWNER") redirect("/m")

  const sp = normalize(await searchParams)
  const range = parsePnLRange(sp)
  const state = pnlRangeToState(range)

  const result = await getAllStoresPnL({
    startDate: state.startDate,
    endDate: state.endDate,
    granularity: state.granularity,
  })

  const subLabel =
    range.kind === "custom"
      ? `Custom · ${state.granularity}`
      : `${PNL_PERIOD_LABELS[range.period]} · all stores`

  if ("error" in result) {
    return (
      <>
        <PageHead dept="P&L" title="Profit & Loss" sub={subLabel} />
        <MPnLToolbar pathname="/m/pnl" searchParams={sp} range={range} />
        <div className="m-empty dock-in dock-in-2">
          <strong>Couldn&apos;t load P&amp;L.</strong> {result.error}
        </div>
      </>
    )
  }

  const cells: MastheadCell[] = [
    { label: "GROSS", value: fmtMoney(result.combined.grossSales), sub: "all stores" },
    { label: "COGS", value: fmtPct(result.combined.cogsPct), sub: fmtMoney(result.combined.cogsValue) },
    { label: "BOTTOM", value: fmtMoney(result.combined.bottomLine), sub: fmtPct(result.combined.marginPct) },
  ]

  const sorted = [...result.perStore].sort((a, b) => b.grossSales - a.grossSales)

  return (
    <>
      <PageHead dept="P&L" title="Profit & Loss" sub={subLabel} />
      <MPnLToolbar pathname="/m/pnl" searchParams={sp} range={range} />
      <MastheadFigures cells={cells} />

      <div style={{ marginTop: 14 }} className="dock-in dock-in-3">
        <Panel dept={`${result.storeCount} STORES`} title="By store" flush>
          <div style={{ padding: "0 0 4px 0" }}>
            {sorted.map((s) => (
              <Link
                key={s.storeId}
                href={`/m/pnl/${s.storeId}${qsFor(sp)}`}
                className="inv-row"
                style={{
                  gridTemplateColumns: "1fr auto auto",
                  gap: 12,
                  padding: "16px 20px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="inv-row__vendor-name">{s.storeName}</span>
                  <span
                    style={{
                      fontFamily:
                        "var(--font-jetbrains-mono), ui-monospace, monospace",
                      fontSize: 10,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: "var(--ink-faint)",
                    }}
                  >
                    {`COGS ${fmtPct(s.cogsPct)} · MARGIN ${fmtPct(s.marginPct)}`}
                  </span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className="inv-row__total">{fmtMoney(s.grossSales)}</span>
                  <div
                    style={{
                      fontFamily: "var(--font-dm-sans), ui-sans-serif, sans-serif",
                      fontSize: 11,
                      color: s.bottomLine >= 0 ? "var(--ink-muted)" : "var(--subtract)",
                      fontVariantNumeric: "tabular-nums lining-nums",
                    }}
                  >
                    {`${s.bottomLine >= 0 ? "" : "−"}${fmtMoney(Math.abs(s.bottomLine))}`}
                  </div>
                </div>
                <span
                  className="m-section-row__chev"
                  aria-hidden
                  style={{ alignSelf: "center" }}
                >
                  ›
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </>
  )
}

function normalize(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) out[k] = v[0]
    else out[k] = v
  }
  return out
}

function qsFor(sp: Record<string, string | undefined>): string {
  // Carry the date selection into the per-store drilldown.
  const merged: Record<string, string> = {}
  for (const k of ["period", "start", "end", "grain"]) {
    const v = sp[k]
    if (v) merged[k] = v
  }
  const qs = new URLSearchParams(merged).toString()
  return qs ? `?${qs}` : ""
}
```

- [ ] **Step 3: Update `/m/pnl/[storeId]/page.tsx` similarly.**

Read [src/app/(mobile)/m/pnl/[storeId]/page.tsx](../../../src/app/(mobile)/m/pnl/[storeId]/page.tsx) and apply the same pattern:

1. Add `searchParams: Promise<Record<string, string | string[] | undefined>>` to the page props.
2. Replace `const range = defaultPnLRangeState()` with:
   ```ts
   const sp = normalize(await searchParams)
   const range = parsePnLRange(sp)
   const state = pnlRangeToState(range)
   ```
3. Pass `state.startDate`, `state.endDate`, `state.granularity` into `getStorePnL`.
4. Render `<MPnLToolbar pathname={`/m/pnl/${storeId}`} searchParams={sp} range={range} />` after `<PageHead />` (and before any data panels).
5. Add the `normalize()` helper at the bottom of the file (same as in step 2).
6. Update the `sub` prop on PageHead to reflect the chosen period (mirror the `subLabel` logic from step 2).

- [ ] **Step 4: Verify build + dev-server check.**

```bash
npm run build
```

Then:

```bash
npm run dev
```

At iPhone 14 viewport, signed in as OWNER, visit `http://localhost:3000/m/pnl`:
- Default loads "Last 8 weeks" (the `8 WKS` pill is active).
- Tap each named pill — confirms data refreshes and only the tapped pill is active.
- Tap **CUSTOM**, pick a 30-day range, tap Apply. URL is `?period=custom&start=…&end=…`. Granularity readout shows "AUTO · WEEKLY". Override to MONTHLY → URL adds `&grain=monthly`. Tap WEEKLY (auto for 30 days) → `&grain=` drops back out.
- Tap a store row — drilldown URL carries `?period=custom&start=…&end=…&grain=…` so the per-store page lands on the same window.
- Reload the per-store URL with the params — server-rendered page lands on the right state.

- [ ] **Step 5: Commit.**

```bash
git add src/components/mobile/m-pnl-toolbar.tsx \
        src/app/\(mobile\)/m/pnl/page.tsx \
        "src/app/(mobile)/m/pnl/[storeId]/page.tsx"
git commit -m "mobile: P&L finance toolbar + custom range with granularity"
```

---

## Task 9: Final cross-check + push

- [ ] **Step 1: Full build + lint.**

```bash
npm run build
```

Expected: clean build, no type errors, no new warnings. If anything regressed, fix before continuing.

- [ ] **Step 2: Manual smoke pass on every affected route.**

`npm run dev` and at iPhone 14:
- `/m`, `/m/analytics`, `/m/operations`, `/m/orders`, `/m/invoices` — toolbar shows 5 pills (Today/Yest/Wk/Last Wk/Custom). Custom flow works on each.
- `/m/pnl` — finance toolbar shows 6 pills (This Wk/Last Wk/This Mo/Last Mo/8 Wks/Custom). Default lands on 8 Wks.
- `/m/pnl/[storeId]` — same toolbar, same defaults; URL params honored.
- Tap "Custom" → calendar slides up. Pick start (e.g. last month's 5th) → tap a date earlier than start → confirms it becomes the new start. Pick a valid end → Apply. URL updates.
- Toggle granularity on the P&L sheet — auto label shows correct value; override sticks.
- Reduced-motion preference (DevTools → Rendering → Emulate CSS prefers-reduced-motion: reduce): sheet still opens but slide animation is disabled.
- Navigate away and back — state restored from URL.
- Open `/m/pnl?period=custom&start=2026-04-01&end=2026-05-15&grain=daily` directly — page renders with the right window and the granularity hint shows "AUTO WOULD BE WEEKLY" (because override differs from auto).

- [ ] **Step 3: Push.**

```bash
git push
```

Expected: pushes to `origin/main`. Confirm the push succeeded.

---

## Self-review notes

- All file paths are absolute from repo root and exist or are explicitly marked Create.
- All code blocks are full and runnable; no "..." placeholders.
- TDD adapted to "type-check + manual viewport check" because the project ships no test runner. Documented in the verification convention.
- `parsePeriod()` is intentionally kept exported in `period.ts` for back-compat during the migration; pages that need the new `parseMobileRange()` migrate one-by-one in Task 7.
- `EditorialCalendar` is decoupled from sheets and URL — it only emits `(start, end)` to its parent. Both sheets share it.
- `CustomPillTrigger` lazy-imports the heavier sheet code with `next/dynamic({ ssr: false })`, so the calendar JS stays out of the initial page bundle until the user taps Custom.
- The P&L module reuses `PNL_PRESETS.compute()` from `src/components/pnl/pnl-date-presets.ts` for named periods — no duplicated date math.
- Editorial tokens only; never `bg-sky-*` or shadcn `<Card>`.
- The push step lives in its own task (Task 9) per the user's explicit ask: "after its done lets commit and push."
