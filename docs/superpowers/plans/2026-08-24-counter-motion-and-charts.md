# Counter Motion and Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the motion layer every Counter surface animates through, then the `<Chart>` and `<Toast>` primitives that depend on it — with `prefers-reduced-motion` honoured in exactly one place and proven at runtime, not assumed.

**Architecture:** Three hooks own all motion. Nothing else in the codebase imports `framer-motion`, which `npm run tokens` enforces. `<Chart>` wraps Recharts 3 directly (the Plan 1 spike settled that), and budgets for a proven asymmetry: a line variant needs no interaction wiring, a bar variant needs `Cell` plus per-series mouse state for dimming and a custom `shape` render prop for the stagger. Per Plan 2's R3, `<Chart>` takes plain data — `<Section>` remains the sole renderer of `SectionData` states.

**Tech Stack:** React 19, TypeScript 7, Recharts 3, framer-motion 13 (behind `motion/` only), Tailwind v4 `ct-` utilities, Vitest 4 + Testing Library (jsdom per-file), Playwright for the runtime motion proof.

**Spec:** [`docs/superpowers/specs/2026-08-23-counter-design-system-design.md`](../specs/2026-08-23-counter-design-system-design.md)

**Spike this plan consumes:** [`docs/counter/recharts-3-spike.md`](../../counter/recharts-3-spike.md) — read the "known asymmetry" section before Task 5.

**Prototype:** [`docs/counter/counter-prototype.html`](../../counter/counter-prototype.html) — its `chart()` function is what `<Chart>` replaces.

## Global Constraints

- Branch is `dashboardv2`. Never rebase, merge or push.
- Gate: `npm test && npm run tokens && npx tsc --noEmit && npm run build`. Baseline: **173 files, 1946 passed | 8 skipped**. The 8 skips are deliberate inherited design-prototype defects — never touch them.
- No ESLint in this repo. Commit messages carry no `Co-Authored-By: Claude` line.
- **Never `prisma migrate dev`.** This plan touches no schema and no database.
- Colour ONLY from `ct-` utilities. No hex, `oklch()`, `rgb()`, `hsl()`, `bg-white`, `text-black`, or Tailwind palette colours. Radii `rounded-ct` / `rounded-ct-sm` only.
- **`framer-motion` may be imported ONLY inside `src/components/counter/motion/`.** `npm run tokens` fails the build otherwise.
- Motion values are fixed by the design and are not yours to tune: section entry **36ms** apart finishing inside **330ms**; figures count up over **480ms**; lines stroke on over **720ms**; bars grow from the baseline **26ms** apart; non-hovered bars dim to **42%**.
- Component tests are `.tsx` with `// @vitest-environment jsdom` as the first line.
- Do not touch untracked files you did not create. Do not commit `.next/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/components/counter/motion/use-reduced-motion.ts` | The single source of truth for whether motion runs at all |
| `src/components/counter/motion/use-entry.ts` | One orchestrated entry per screen — sections rise in reading order |
| `src/components/counter/motion/use-count-up.ts` | A figure counts up to what it already says |
| `src/components/counter/motion/use-chart-draw.ts` | Whether a chart should animate, and with what duration |
| `src/components/counter/surface/toast.tsx` | Consequential actions answer back |
| `src/components/counter/surface/chart.tsx` | The chart primitive — line and bar variants over Recharts 3 |
| `src/components/counter/index.ts` | Modified: export the new primitives |
| `DESIGN.md` | Modified: a Motion section stating the values and the one place they live |

---

### Task 1: `useReducedMotion` — the one place the question is asked

Every other hook consults this. Getting it wrong disables motion everywhere or, worse, ignores a user's explicit accessibility setting.

**Files:**
- Create: `src/components/counter/motion/use-reduced-motion.ts`
- Test: `tests/components/counter/motion/use-reduced-motion.test.tsx`

**Interfaces:**
- Produces: `useReducedMotion(): boolean`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useReducedMotion } from "@/components/counter/motion/use-reduced-motion"

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
  }
  vi.stubGlobal("matchMedia", () => mql)
  return {
    mql,
    fire: (next: boolean) => {
      mql.matches = next
      listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent))
    },
  }
}

describe("useReducedMotion", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("is false when the user has expressed no preference", () => {
    mockMatchMedia(false)
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false)
  })

  it("is true when the user prefers reduced motion", () => {
    mockMatchMedia(true)
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true)
  })

  it("reacts when the preference changes mid-session", () => {
    const { fire } = mockMatchMedia(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
    act(() => fire(true))
    expect(result.current).toBe(true)
  })

  it("defaults to REDUCED when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined)
    // Erring toward no motion is the safe default: a missed animation is a
    // cosmetic loss, an unwanted one can cause real harm.
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true)
  })

  it("removes its listener on unmount", () => {
    const { mql } = mockMatchMedia(false)
    const spy = vi.spyOn(mql, "removeEventListener")
    renderHook(() => useReducedMotion()).unmount()
    expect(spy).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/motion/use-reduced-motion.test.tsx`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

```ts
"use client"

import { useEffect, useState } from "react"

const QUERY = "(prefers-reduced-motion: reduce)"

/**
 * The single place Counter asks whether motion should run.
 *
 * Every motion hook consults this, so honouring the preference is one
 * decision rather than a discipline repeated in every animated component —
 * which is the same reason `SectionData` exists for states.
 *
 * It defaults to REDUCED when `matchMedia` is unavailable (SSR, a test
 * environment, an old embedded webview). A missed animation is a cosmetic
 * loss; an unwanted one can trigger vestibular symptoms in people who
 * specifically asked not to have it. The safe default is the still one.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof matchMedia === "function" ? matchMedia(QUERY).matches : true,
  )

  useEffect(() => {
    if (typeof matchMedia !== "function") return
    const mql = matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener("change", onChange)
    // Re-read on mount: the value may have changed between the initial
    // render and the effect, and on the server it was always `true`.
    setReduced(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return reduced
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/motion/use-reduced-motion.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/motion/use-reduced-motion.ts tests/components/counter/motion/use-reduced-motion.test.tsx
git commit -m "feat(counter): one place motion asks whether to run"
```

---

### Task 2: `useEntry` — sections rise in reading order

Prototype note 27: the entry animation exists to show the shape of the page arriving in reading order, which is what streaming actually does here. It finishes in 330ms.

**Files:**
- Create: `src/components/counter/motion/use-entry.ts`
- Test: `tests/components/counter/motion/use-entry.test.tsx`

**Interfaces:**
- Consumes: `useReducedMotion`.
- Produces: `useEntry(index: number): { style: CSSProperties }`, and the constants `ENTRY_STAGGER_MS = 36`, `ENTRY_DURATION_MS = 220`, `ENTRY_TOTAL_MS = 330`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useEntry, ENTRY_STAGGER_MS, ENTRY_TOTAL_MS } from "@/components/counter/motion/use-entry"

function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

describe("useEntry", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("staggers each section 36ms after the one before it", () => {
    setReducedMotion(false)
    expect(renderHook(() => useEntry(0)).result.current.style.animationDelay).toBe("0ms")
    expect(renderHook(() => useEntry(1)).result.current.style.animationDelay).toBe("36ms")
    expect(renderHook(() => useEntry(4)).result.current.style.animationDelay).toBe("144ms")
  })

  it("finishes inside 330ms however many sections there are", () => {
    setReducedMotion(false)
    // The stagger is capped so a long page does not animate for two seconds.
    const last = renderHook(() => useEntry(40)).result.current.style
    const delay = parseInt(String(last.animationDelay), 10)
    const duration = parseInt(String(last.animationDuration), 10)
    expect(delay + duration).toBeLessThanOrEqual(ENTRY_TOTAL_MS)
  })

  it("emits NO animation at all under reduced motion", () => {
    setReducedMotion(true)
    const style = renderHook(() => useEntry(3)).result.current.style
    expect(style.animationName).toBeUndefined()
    expect(style.animationDelay).toBeUndefined()
    expect(style.opacity).toBeUndefined()
  })

  it("exposes the stagger as a constant so nobody retypes 36", () => {
    expect(ENTRY_STAGGER_MS).toBe(36)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/motion/use-entry.test.tsx`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

```ts
"use client"

import type { CSSProperties } from "react"
import { useReducedMotion } from "./use-reduced-motion"

/** Sections rise 36ms apart, in reading order. */
export const ENTRY_STAGGER_MS = 36
/** Each section's own rise. */
export const ENTRY_DURATION_MS = 220
/** The whole orchestration is over by here, however long the page is. */
export const ENTRY_TOTAL_MS = 330

/**
 * One orchestrated entry per screen (note 27). The animation exists to show
 * the shape of the page arriving in reading order — which is what streaming
 * actually does here — not to decorate it.
 *
 * The stagger is CAPPED. A forty-section page would otherwise animate for a
 * second and a half, and the last section would arrive long after the reader
 * started reading the first.
 */
export function useEntry(index: number): { style: CSSProperties } {
  const reduced = useReducedMotion()
  if (reduced) return { style: {} }

  const maxDelay = ENTRY_TOTAL_MS - ENTRY_DURATION_MS
  const delay = Math.min(index * ENTRY_STAGGER_MS, maxDelay)

  return {
    style: {
      animationName: "ct-entry",
      animationDuration: `${ENTRY_DURATION_MS}ms`,
      animationDelay: `${delay}ms`,
      animationTimingFunction: "var(--ct-ease)",
      animationFillMode: "both",
    },
  }
}
```

- [ ] **Step 4: Define the keyframes**

Append to `src/styles/counter.css`, after the `@theme inline` block:

```css
/* The one entry animation. Declared here rather than in a component so the
 * keyframe name is a token like any other, and so `useEntry` stays pure
 * TypeScript with no style injection. */
@keyframes ct-entry {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
```

Confirm this does not disturb the token tests, which assert the file declares no `@media (prefers-color-scheme)` block and no `[data-theme]` selector:

Run: `npx vitest run tests/styles/counter-tokens.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/motion/use-entry.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/counter/motion/use-entry.ts src/styles/counter.css tests/components/counter/motion/use-entry.test.tsx
git commit -m "feat(counter): sections rise in reading order, and stop by 330ms"
```

---

### Task 3: `useCountUp` — a figure counts up to what it already says

**Files:**
- Create: `src/components/counter/motion/use-count-up.ts`
- Test: `tests/components/counter/motion/use-count-up.test.tsx`

**Interfaces:**
- Consumes: `useReducedMotion`.
- Produces: `useCountUp(value: number, opts?: { durationMs?: number }): number`, constant `COUNT_UP_MS = 480`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useCountUp, COUNT_UP_MS } from "@/components/counter/motion/use-count-up"

function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches, media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {}, removeEventListener: () => {},
  }))
}

describe("useCountUp", () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())

  it("returns the final value immediately under reduced motion", () => {
    setReducedMotion(true)
    expect(renderHook(() => useCountUp(7468)).result.current).toBe(7468)
  })

  it("starts below the target and arrives at it exactly", () => {
    setReducedMotion(false)
    const { result } = renderHook(() => useCountUp(7468))
    expect(result.current).toBeLessThan(7468)
    act(() => { vi.advanceTimersByTime(COUNT_UP_MS + 50) })
    // Exactly the target, not 7467.98 — a figure that lands one cent short
    // after animating is worse than one that never animated.
    expect(result.current).toBe(7468)
  })

  it("restarts toward a new target when the value changes", () => {
    setReducedMotion(false)
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 100 },
    })
    act(() => { vi.advanceTimersByTime(COUNT_UP_MS + 50) })
    expect(result.current).toBe(100)
    rerender({ v: 200 })
    act(() => { vi.advanceTimersByTime(COUNT_UP_MS + 50) })
    expect(result.current).toBe(200)
  })

  it("handles a negative target", () => {
    setReducedMotion(false)
    const { result } = renderHook(() => useCountUp(-2208))
    act(() => { vi.advanceTimersByTime(COUNT_UP_MS + 50) })
    expect(result.current).toBe(-2208)
  })

  it("is 480ms by the design's choosing", () => {
    expect(COUNT_UP_MS).toBe(480)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/motion/use-count-up.test.tsx`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

```ts
"use client"

import { useEffect, useRef, useState } from "react"
import { useReducedMotion } from "./use-reduced-motion"

export const COUNT_UP_MS = 480

/**
 * A figure counts up to what it already says.
 *
 * The subtlety worth getting right: the animation must END on the exact
 * target. Interpolating by elapsed-time fraction and stopping when the clock
 * runs out can leave a figure a fraction short, and a dashboard that renders
 * $7,467.98 where the data says $7,468 has done something worse than not
 * animating at all.
 */
export function useCountUp(value: number, opts: { durationMs?: number } = {}): number {
  const duration = opts.durationMs ?? COUNT_UP_MS
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(() => (reduced ? value : 0))
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      return
    }
    const from = 0
    const start = performance.now()

    const tick = (now: number) => {
      const elapsed = now - start
      if (elapsed >= duration) {
        setDisplay(value) // exact, always
        return
      }
      const t = elapsed / duration
      // Ease-out: fast at first, settling into the figure.
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (value - from) * eased)
      frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [value, duration, reduced])

  return display
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/motion/use-count-up.test.tsx`
Expected: PASS, 5 tests. If `requestAnimationFrame` does not advance under fake timers in this jsdom version, stub it to call back via `setTimeout(fn, 16)` inside the test rather than changing the implementation.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/motion/use-count-up.ts tests/components/counter/motion/use-count-up.test.tsx
git commit -m "feat(counter): figures count up, and land exactly"
```

---

### Task 4: `useChartDraw` and `<Toast>`

Two small pieces batched: the hook `<Chart>` will consult, and the acknowledgement every consequential action owes.

**Files:**
- Create: `src/components/counter/motion/use-chart-draw.ts`
- Create: `src/components/counter/surface/toast.tsx`
- Test: `tests/components/counter/motion/use-chart-draw.test.tsx`
- Test: `tests/components/counter/toast.test.tsx`

**Interfaces:**
- Consumes: `useReducedMotion`.
- Produces: `useChartDraw(): { animate: boolean; lineDurationMs: number; barStaggerMs: number }`, constants `LINE_DRAW_MS = 720`, `BAR_STAGGER_MS = 26`; `<Toast message tone? onDismiss?>` and `type ToastTone = "ok" | "warn" | "bad"`.

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useChartDraw, LINE_DRAW_MS, BAR_STAGGER_MS } from "@/components/counter/motion/use-chart-draw"

function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches, media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {}, removeEventListener: () => {},
  }))
}

describe("useChartDraw", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("animates with the design's durations by default", () => {
    setReducedMotion(false)
    const r = renderHook(() => useChartDraw()).result.current
    expect(r).toEqual({ animate: true, lineDurationMs: LINE_DRAW_MS, barStaggerMs: BAR_STAGGER_MS })
  })

  it("reports animate:false under reduced motion, and zero durations", () => {
    setReducedMotion(true)
    const r = renderHook(() => useChartDraw()).result.current
    expect(r.animate).toBe(false)
    expect(r.lineDurationMs).toBe(0)
    expect(r.barStaggerMs).toBe(0)
  })

  it("carries the design's numbers, not invented ones", () => {
    expect(LINE_DRAW_MS).toBe(720)
    expect(BAR_STAGGER_MS).toBe(26)
  })
})
```

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { Toast } from "@/components/counter/surface/toast"

describe("Toast", () => {
  it("announces itself to a screen reader without stealing focus", () => {
    render(<Toast message="Saved" />)
    const el = screen.getByRole("status")
    expect(el.textContent).toContain("Saved")
    expect(el).toHaveAttribute("aria-live", "polite")
  })

  it("uses assertive announcement only for a failure", () => {
    render(<Toast message="Could not post to COGS" tone="bad" />)
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive")
  })

  it("offers dismissal when a handler is given, and none otherwise", () => {
    const onDismiss = vi.fn()
    const { unmount } = render(<Toast message="Saved" onDismiss={onDismiss} />)
    screen.getByRole("button", { name: /dismiss/i }).click()
    expect(onDismiss).toHaveBeenCalled()
    unmount()
    render(<Toast message="Saved" />)
    expect(screen.queryByRole("button")).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/components/counter/motion/use-chart-draw.test.tsx tests/components/counter/toast.test.tsx`
Expected: FAIL — cannot resolve either module.

- [ ] **Step 3: Write both**

`src/components/counter/motion/use-chart-draw.ts`:

```ts
"use client"

import { useReducedMotion } from "./use-reduced-motion"

/** A line strokes itself on over 720ms. */
export const LINE_DRAW_MS = 720
/** Bars grow from the baseline, 26ms apart. */
export const BAR_STAGGER_MS = 26

/**
 * Whether a chart should draw itself, and how fast.
 *
 * Returns zeroed durations rather than just `animate:false` so a caller can
 * pass the numbers straight through to Recharts without branching — Recharts
 * treats a zero duration as "appear immediately", which is exactly what
 * reduced motion should mean.
 */
export function useChartDraw(): {
  animate: boolean
  lineDurationMs: number
  barStaggerMs: number
} {
  const reduced = useReducedMotion()
  return reduced
    ? { animate: false, lineDurationMs: 0, barStaggerMs: 0 }
    : { animate: true, lineDurationMs: LINE_DRAW_MS, barStaggerMs: BAR_STAGGER_MS }
}
```

`src/components/counter/surface/toast.tsx`:

```tsx
export type ToastTone = "ok" | "warn" | "bad"

const TONE: Record<ToastTone, string> = {
  ok: "border-ct-good bg-ct-good-wash text-ct-ink",
  warn: "border-ct-warn bg-ct-warn-wash text-ct-ink",
  bad: "border-ct-bad bg-ct-bad-wash text-ct-ink",
}

/**
 * Every consequential button answers back — Saved, Committed, Approved and
 * posted to COGS. An action that changes something and says nothing leaves the
 * reader wondering whether it worked.
 *
 * A failure is announced assertively because the reader needs to know now; a
 * success is polite, because interrupting someone to say "it worked" is noise.
 */
export function Toast({
  message,
  tone = "ok",
  onDismiss,
}: {
  message: string
  tone?: ToastTone
  onDismiss?: () => void
}) {
  const bad = tone === "bad"
  return (
    <div
      role={bad ? "alert" : "status"}
      aria-live={bad ? "assertive" : "polite"}
      className={`flex items-center gap-3 rounded-ct border px-4 py-2 text-ct-body ${TONE[tone]}`}
    >
      <span>{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-auto font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3 hover:text-ct-ink"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/counter/motion/use-chart-draw.test.tsx tests/components/counter/toast.test.tsx`
Expected: PASS, 3 + 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/motion/use-chart-draw.ts src/components/counter/surface/toast.tsx tests/components/counter/motion/use-chart-draw.test.tsx tests/components/counter/toast.test.tsx
git commit -m "feat(counter): chart timings in one place, and actions that answer back"
```

---

### Task 5: `<Chart>` — the line variant

Read `docs/counter/recharts-3-spike.md` before starting. It proved, in a real browser, that everything in this task is free: hover anywhere with the nearest reading winning, a full-height crosshair, a dot per series, a card naming every series, and a 720ms stroke-on measured at `0px → 1584.6/1585.27px` between t=0 and t=714ms.

**Files:**
- Create: `src/components/counter/surface/chart.tsx`
- Test: `tests/components/counter/chart.test.tsx`

**Interfaces:**
- Consumes: `useChartDraw`; `TABULAR`, `money`, `moneyCompact` from `@/lib/counter/format`.
- Produces: `<Chart variant labels series height? formatValue? comparisonLabel?>`, `interface ChartSeries { name: string; data: (number | null)[]; bandClass?: string }`.

Per Plan 2's R3, `<Chart>` takes plain data. `<Section>` is the sole renderer of `SectionData` states — do NOT add state branching here.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { Chart } from "@/components/counter/surface/chart"

function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches, media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {}, removeEventListener: () => {},
  }))
}

const labels = ["Aug 18", "Aug 19", "Aug 20"]
const series = [{ name: "Net sales", data: [7100, 7400, 7468] }]

describe("Chart — line", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("renders a chart region with an accessible name", () => {
    setReducedMotion(false)
    render(<Chart variant="line" labels={labels} series={series} title="Revenue trend" />)
    expect(screen.getByRole("img", { name: /revenue trend/i })).toBeTruthy()
  })

  it("degrades to a single reading when there is only one label", () => {
    setReducedMotion(false)
    // "A single day is one reading, not a chart." Drawing one point as a bar
    // fills the panel edge to edge and says nothing.
    render(<Chart variant="line" labels={["Aug 24"]} series={[{ name: "Net sales", data: [7468] }]} title="t" />)
    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.getByText("Net sales")).toBeTruthy()
    expect(screen.getByText("Aug 24")).toBeTruthy()
  })

  it("renders an em-dash for a null reading in the degraded view", () => {
    setReducedMotion(false)
    render(<Chart variant="line" labels={["Aug 24"]} series={[{ name: "Net sales", data: [null] }]} title="t" />)
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("provides a text summary so the data is reachable without the picture", () => {
    setReducedMotion(false)
    render(<Chart variant="line" labels={labels} series={series} title="Revenue trend" />)
    const table = screen.getByRole("table", { name: /revenue trend/i })
    expect(table.textContent).toContain("Aug 20")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/chart.test.tsx`
Expected: FAIL — cannot resolve `@/components/counter/surface/chart`.

- [ ] **Step 3: Implement the line variant and the degradation**

Build `src/components/counter/surface/chart.tsx` with:
- `"use client"` at the top — Recharts needs the browser.
- The single-reading degradation FIRST, before any Recharts import path runs: when `labels.length < 2`, render each series as a label/value pair rather than a chart, using an em-dash for `null`. This is the prototype's own behaviour and the reason is in its comment: one point drawn as a chart fills the panel and says nothing.
- For the line variant: `LineChart` with a `Line` per series, `animationDuration={lineDurationMs}` and `isAnimationActive={animate}` from `useChartDraw`, a `Tooltip` with `cursor` enabled so the crosshair renders, and axis-based tooltip behaviour (Recharts' default for `LineChart`) so hovering anywhere on the plot resolves the nearest reading.
- Colour: series get `ct-` token colours via CSS custom properties, NOT literals. `npm run tokens` forbids `rgb(`/hex here. If you need a raw colour string for a Recharts prop, read it from a CSS variable rather than writing one — and if that proves impossible, STOP and report rather than adding a lint suppression. The linter's module comment documents that the honest options are a one-file allowlist or an inline suppression, and says explicitly not to build either speculatively; this is the first real consumer, so it is a decision to escalate, not to make.
- A visually-hidden `<table>` summarising labels and values, labelled by the chart title, so the numbers are reachable without the picture. Give the chart container `role="img"` and an `aria-label` of the title.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/chart.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the design rules hold**

Run: `npm run tokens`
Expected: `Counter rules: clean`. If it flags a colour in this file, do not suppress it — report it.

- [ ] **Step 6: Commit**

```bash
git add src/components/counter/surface/chart.tsx tests/components/counter/chart.test.tsx
git commit -m "feat(counter): the line chart, and the single reading that is not one"
```

---

### Task 6: `<Chart>` — the bar variant, and its asymmetry

The spike is explicit that this is where the work is. Line charts need no interaction wiring; bars need `Cell` plus per-series mouse state for the 42% dim, and a custom `shape` render prop with hand-written keyframes for the 26ms stagger. Budget for it rather than assuming both variants are equally thin.

**Files:**
- Modify: `src/components/counter/surface/chart.tsx`
- Modify: `src/styles/counter.css` (the bar-grow keyframes)
- Test: `tests/components/counter/chart.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

```tsx
  it("renders a bar per reading", () => {
    setReducedMotion(false)
    const { container } = render(
      <Chart variant="bar" labels={labels} series={series} title="Orders" />,
    )
    expect(container.querySelectorAll(".recharts-rectangle").length).toBeGreaterThanOrEqual(3)
  })

  it("dims every bar except the hovered one to 42%", () => {
    setReducedMotion(false)
    const { container } = render(
      <Chart variant="bar" labels={labels} series={series} title="Orders" />,
    )
    const bars = container.querySelectorAll("[data-bar-index]")
    expect(bars.length).toBe(3)
    // No hover yet: nothing is dimmed.
    expect([...bars].every((b) => b.getAttribute("fill-opacity") === "1")).toBe(true)
  })

  it("emits no growth animation under reduced motion", () => {
    setReducedMotion(true)
    const { container } = render(
      <Chart variant="bar" labels={labels} series={series} title="Orders" />,
    )
    const bar = container.querySelector("[data-bar-index]") as HTMLElement | null
    expect(bar?.style.animationName ?? "").toBe("")
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/chart.test.tsx`
Expected: the three new tests FAIL; the four line tests still pass.

- [ ] **Step 3: Implement the bar variant**

- `BarChart` with a `Bar` per series.
- Dimming: hold a `hoverIndex` in state, set it from the `Bar`'s `onMouseEnter(_, index)` and clear it on `onMouseLeave`. Render one `<Cell>` per datum with `fillOpacity={hoverIndex === null || hoverIndex === index ? 1 : 0.42}`. Give each `Cell` a `data-bar-index` attribute so the behaviour is testable without a real pointer.
- Stagger: set `isAnimationActive={false}` on the `Bar` and supply a custom `shape` that renders a `<rect>` whose `style.animation` uses a `ct-bar-grow` keyframe with `animationDelay: index * barStaggerMs`. When `barStaggerMs` is 0 (reduced motion), emit no animation at all rather than a zero-duration one.
- Add to `src/styles/counter.css`:

```css
/* Bars grow from the baseline. Paired with a custom `shape` on the Bar,
 * because Recharts animates a whole bar series on one shared timer and the
 * design calls for each bar to arrive 26ms after the one before it. */
@keyframes ct-bar-grow {
  from { transform: scaleY(0); }
  to   { transform: scaleY(1); }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/chart.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/surface/chart.tsx src/styles/counter.css tests/components/counter/chart.test.tsx
git commit -m "feat(counter): bars dim to 42% and arrive 26ms apart"
```

---

### Task 7: Prove reduced motion at runtime, and close the plan

`prefers-reduced-motion` is the one thing in the spike that was never verified in a browser — its "it works by default" claim rested on reading `.d.ts` files. Every unit test in this plan stubs `matchMedia`, which proves the hooks branch correctly and proves nothing about whether the browser agrees.

**Files:**
- Modify: `src/components/counter/index.ts`
- Modify: `DESIGN.md`
- Create: `docs/counter/motion-verification.md`

- [ ] **Step 1: Export the new primitives**

Add to `src/components/counter/index.ts`:

```ts
export { Chart, type ChartSeries } from "./surface/chart"
export { Toast, type ToastTone } from "./surface/toast"
export { useEntry, ENTRY_STAGGER_MS, ENTRY_DURATION_MS, ENTRY_TOTAL_MS } from "./motion/use-entry"
export { useCountUp, COUNT_UP_MS } from "./motion/use-count-up"
export { useChartDraw, LINE_DRAW_MS, BAR_STAGGER_MS } from "./motion/use-chart-draw"
export { useReducedMotion } from "./motion/use-reduced-motion"
```

Run: `npx vitest run tests/components/counter/boundary.test.ts`
Expected: PASS — the barrel still must not re-export anything from `state/`.

- [ ] **Step 2: Prove reduced motion in a real browser**

Build a throwaway harness page rendering a `Chart` (both variants), a figure using `useCountUp`, and a section using `useEntry`. Drive it with Playwright twice:

```
await page.emulateMedia({ reducedMotion: "reduce" })
await page.emulateMedia({ reducedMotion: "no-preference" })
```

For each, record: whether the line path carries a `stroke-dasharray` mid-render, whether any bar has a non-empty `animation-name`, whether the counted figure's first painted value equals its final value, and whether any element carries an `animation-delay`.

Expected under `reduce`: no `animation-name` anywhere, the figure's first value IS its final value, no entry delays. Under `no-preference`: the opposite, with the measured durations near 720ms and 26ms.

Write both sets of observations to `docs/counter/motion-verification.md` — this is the evidence file, and it is the thing the spike could not produce. Delete the harness afterwards and confirm `git diff` is clean.

- [ ] **Step 3: Document the motion system**

Add to `DESIGN.md`:

```markdown
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
```

- [ ] **Step 4: Run the full gate**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
```

Expected: all pass, at least 1946 + this plan's tests, 8 skips unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/index.ts DESIGN.md docs/counter/motion-verification.md
git commit -m "feat(counter): motion proven off when it should be, not assumed"
```

---

## Done when

- `src/components/counter/motion/` holds four hooks; nothing outside it imports `framer-motion`
- `<Chart>` renders line and bar variants, degrades a single reading to a figure, and carries a text summary
- `<Toast>` announces politely, or assertively for a failure
- `docs/counter/motion-verification.md` records real-browser observations under both media settings
- Full gate green

## Next plan

Plan 4 — the shell: `AppShell`, `Rail` (17 items, 5 groups), `Topbar`,
`StoreSwitcher`, `DateControl` (12 presets, 4 comparisons, steppers) and the ⌘K
`AskSurface`. Carry forward: the DateControl must not offer the `weekday`
comparison when the range exceeds 7 days (`comparisonRange` returns `null`
there); it must pass a midnight-normalised `today`; the shell owns the
`data-ask-about` consumer, and until it exists no page should ship `askAbout`;
and `<Table>` needs a height-constrained container for its sticky head.
