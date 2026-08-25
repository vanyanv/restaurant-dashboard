# Counter Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two controls that scope every figure in the product — the store switcher and the date control — plus the topbar that holds them, so a page never has to ask which store or which range it is showing.

**Architecture:** Both controls are URL-driven: they read and write search params, so a range or a store is shareable, bookmarkable and survives a reload. Neither owns data. `DateControl` is pure presentation over `src/lib/counter/date-range.ts`, which already has the twelve presets, four comparison modes, bucketing and steppers under test.

**Tech Stack:** Next.js 16 App Router (`useSearchParams`/`useRouter`), React 19, TypeScript 7, Tailwind v4 `ct-` utilities, Vitest 4 + Testing Library, Playwright for the popover proof.

**Spec:** [`docs/superpowers/specs/2026-08-23-counter-design-system-design.md`](../specs/2026-08-23-counter-design-system-design.md) — §5.3 covers both controls.

**Prototype:** [`docs/counter/counter-prototype.html`](../../counter/counter-prototype.html).

## Global Constraints

- Branch `dashboardv2`. Never rebase, merge or push.
- Gate: `npm test && npm run tokens && npx tsc --noEmit && npm run build`. Baseline **183 files, 2007 passed | 8 skipped**. The 8 skips are deliberate inherited design-prototype defects — never touch them.
- No ESLint. No `Co-Authored-By: Claude` line. **Never `prisma migrate dev`** — no schema changes in this plan.
- Colour ONLY via `ct-` utilities or `"var(--ct-…)"`. Radii `rounded-ct` / `rounded-ct-sm` only.
- `framer-motion` only under `src/components/counter/motion/`.
- `font-ct-display` is page titles and the wordmark only.
- Component tests are `.tsx` with `// @vitest-environment jsdom` first line.
- Do not touch untracked files you did not create. Do not commit `.next/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/counter/url-state.ts` | Reading and writing the range and store as search params |
| `src/components/counter/shell/store-switcher.tsx` | Pick a store, or all of them |
| `src/components/counter/shell/date-control.tsx` | 12 presets, 4 comparisons, steppers |
| `src/components/counter/shell/topbar.tsx` | Breadcrumb, sync status, and the two controls |
| `src/components/counter/index.ts` | Modified: export them |
| `DESIGN.md` | Modified: a Controls section |

---

### Task 1: URL state

The range and the store belong in the URL, not in React state. A figure someone is looking at should survive a reload and be shareable — and note 19's warning that "a range that only changes the label is a lie" applies just as much to a range that vanishes on refresh.

**Files:**
- Create: `src/lib/counter/url-state.ts`
- Test: `tests/lib/counter/url-state.test.ts`

**Interfaces:**
- Consumes: `PresetId`, `ComparisonId`, `resolvePreset`, `PRESETS`, `COMPARISONS` from `@/lib/counter/date-range`.
- Produces: `readCounterParams(params: URLSearchParams, today: Date)`, `writeCounterParams(current, next)`, `type CounterParams`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { readCounterParams, writeCounterParams } from "@/lib/counter/url-state"

const TODAY = new Date(2026, 7, 24)

describe("readCounterParams", () => {
  it("defaults to yesterday and prior-period when nothing is set", () => {
    // Yesterday, not today: an owner opening the dashboard in the morning
    // wants the day that finished, not the one that has barely started.
    const p = readCounterParams(new URLSearchParams(), TODAY)
    expect(p.presetId).toBe("yesterday")
    expect(p.comparisonId).toBe("prev")
    expect(p.storeId).toBeNull()
  })

  it("reads a preset, a comparison and a store", () => {
    const p = readCounterParams(
      new URLSearchParams("range=d30&cmp=year&store=hollywood"),
      TODAY,
    )
    expect(p.presetId).toBe("d30")
    expect(p.comparisonId).toBe("year")
    expect(p.storeId).toBe("hollywood")
  })

  it("resolves the preset to a real range", () => {
    const p = readCounterParams(new URLSearchParams("range=d7"), TODAY)
    expect(p.range.end).toEqual(TODAY)
    expect(p.range.start).toEqual(new Date(2026, 7, 18))
  })

  it("falls back to the default on an unknown preset rather than throwing", () => {
    // A URL is user input. A hand-edited or stale param must not crash a page.
    const p = readCounterParams(new URLSearchParams("range=nonsense"), TODAY)
    expect(p.presetId).toBe("yesterday")
  })

  it("falls back on an unknown comparison too", () => {
    expect(readCounterParams(new URLSearchParams("cmp=sideways"), TODAY).comparisonId).toBe("prev")
  })

  it("drops the weekday comparison when the range is too long for it to mean anything", () => {
    // comparisonRange returns null past 7 days, so offering it would render an
    // empty comparison. Reading it back as "prev" keeps the page coherent.
    const p = readCounterParams(new URLSearchParams("range=d30&cmp=weekday"), TODAY)
    expect(p.comparisonId).toBe("prev")
  })

  it("keeps the weekday comparison when the range is short enough", () => {
    expect(readCounterParams(new URLSearchParams("range=d7&cmp=weekday"), TODAY).comparisonId)
      .toBe("weekday")
  })
})

describe("writeCounterParams", () => {
  it("sets what changed and leaves the rest alone", () => {
    const next = writeCounterParams(new URLSearchParams("range=d7&other=keep"), { presetId: "d30" })
    expect(next.get("range")).toBe("d30")
    expect(next.get("other")).toBe("keep")
  })

  it("removes a param set back to its default, so URLs stay short", () => {
    const next = writeCounterParams(new URLSearchParams("range=d30"), { presetId: "yesterday" })
    expect(next.get("range")).toBeNull()
  })

  it("clears the store when set to null — 'all stores' is the absence of a store", () => {
    const next = writeCounterParams(new URLSearchParams("store=hollywood"), { storeId: null })
    expect(next.get("store")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/counter/url-state.test.ts`
Expected: FAIL — cannot resolve `@/lib/counter/url-state`.

- [ ] **Step 3: Write the implementation**

```ts
import {
  COMPARISONS, PRESETS, comparisonRange, resolvePreset,
  type ComparisonId, type DateRange, type PresetId,
} from "./date-range"

/**
 * The range and the store live in the URL.
 *
 * A figure an owner is looking at should survive a reload and be shareable —
 * "look at this week's prime cost" is a link, not a description of which
 * controls to click. It also means the back button works on a range change,
 * which is what a reader expects when a page's numbers changed.
 *
 * Everything here treats the URL as UNTRUSTED. A hand-edited, stale or
 * truncated param must fall back to a sane default rather than throw — a
 * dashboard that 500s on a bad query string is worse than one that shows
 * yesterday.
 */

export interface CounterParams {
  presetId: PresetId
  comparisonId: ComparisonId
  /** null means all stores — the absence of a store, not a magic "all" id. */
  storeId: string | null
  range: DateRange
}

/**
 * Yesterday, not today. An owner opening the dashboard in the morning wants the
 * day that finished, not the one that has barely started — a half-day of
 * figures compared against a whole one reads as a collapse.
 */
const DEFAULT_PRESET: PresetId = "yesterday"
const DEFAULT_COMPARISON: ComparisonId = "prev"

const isPreset = (v: string | null): v is PresetId =>
  v !== null && PRESETS.some((p) => p.id === v)

const isComparison = (v: string | null): v is ComparisonId =>
  v !== null && COMPARISONS.some((c) => c.id === v)

export function readCounterParams(params: URLSearchParams, today: Date): CounterParams {
  const rawPreset = params.get("range")
  const presetId: PresetId = isPreset(rawPreset) ? rawPreset : DEFAULT_PRESET

  const range = resolvePreset(presetId, today)

  const rawCmp = params.get("cmp")
  let comparisonId: ComparisonId = isComparison(rawCmp) ? rawCmp : DEFAULT_COMPARISON

  // The weekday comparison has no meaning past a week — `comparisonRange`
  // returns null there. Offering it anyway would render an empty comparison
  // beside real figures, which reads as "no change" rather than "not asked".
  if (comparisonId === "weekday" && comparisonRange(range, "weekday") === null) {
    comparisonId = DEFAULT_COMPARISON
  }

  const store = params.get("store")

  return { presetId, comparisonId, storeId: store === null || store === "" ? null : store, range }
}

/**
 * Writes only what changed, and DROPS anything at its default so a shared URL
 * stays short and readable. `?range=d30` beats
 * `?range=d30&cmp=prev&store=` for a link someone pastes into a message.
 */
export function writeCounterParams(
  current: URLSearchParams,
  next: Partial<Pick<CounterParams, "presetId" | "comparisonId" | "storeId">>,
): URLSearchParams {
  const out = new URLSearchParams(current)

  if (next.presetId !== undefined) {
    if (next.presetId === DEFAULT_PRESET) out.delete("range")
    else out.set("range", next.presetId)
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/counter/url-state.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter/url-state.ts tests/lib/counter/url-state.test.ts
git commit -m "feat(counter): the range and the store live in the URL"
```

---

### Task 2: `StoreSwitcher`

Note 25: "The store switcher deletes a whole class of route." Every `/[storeId]` page existed because there was no other way to scope a page to one store. With a switcher, a per-store view is a parameter, not seventeen more routes.

**Files:**
- Create: `src/components/counter/shell/store-switcher.tsx`
- Test: `tests/components/counter/shell/store-switcher.test.tsx`

**Interfaces:**
- Produces: `<StoreSwitcher stores selectedId onSelect>`, `interface SwitchableStore { id: string; name: string; stage: "trading" | "warming_up" | "pre_open" }`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { StoreSwitcher } from "@/components/counter/shell/store-switcher"

const stores = [
  { id: "hollywood", name: "Hollywood", stage: "trading" as const },
  { id: "glendale", name: "Glendale", stage: "pre_open" as const },
  { id: "vannuys", name: "Van Nuys", stage: "warming_up" as const },
]

describe("StoreSwitcher", () => {
  it("offers every store plus all of them", () => {
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByRole("radio", { name: /all stores/i })).toBeTruthy()
    expect(screen.getByRole("radio", { name: /hollywood/i })).toBeTruthy()
    expect(screen.getAllByRole("radio")).toHaveLength(4)
  })

  it("marks the selection with aria-checked, not just colour", () => {
    render(<StoreSwitcher stores={stores} selectedId="hollywood" onSelect={() => {}} />)
    const checked = screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")
    expect(checked).toHaveLength(1)
    expect(checked[0].textContent).toContain("Hollywood")
  })

  it("treats a null selection as all stores", () => {
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByRole("radio", { name: /all stores/i }).getAttribute("aria-checked")).toBe("true")
  })

  it("reports the chosen store, and null for all", () => {
    const onSelect = vi.fn()
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={onSelect} />)
    screen.getByRole("radio", { name: /hollywood/i }).click()
    expect(onSelect).toHaveBeenCalledWith("hollywood")
    screen.getByRole("radio", { name: /all stores/i }).click()
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it("names a store's stage, because a pre-open store has no figures for a reason", () => {
    // Note 58: the model has three stages and only two were ever expressible.
    // A reader seeing an empty Glendale needs to know it is not trading yet,
    // not that the sync failed.
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText(/opening soon/i)).toBeTruthy()
    expect(screen.getByText(/warming up/i)).toBeTruthy()
  })

  it("is a radiogroup with an accessible name", () => {
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByRole("radiogroup", { name: /store/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/shell/store-switcher.test.tsx`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

- A `role="radiogroup"` with `aria-label="Store"`, containing one `role="radio"` button per store plus an "All stores" option first.
- `aria-checked` carries the selection; colour is the sighted affordance only. Selected: `bg-ct-accent-wash text-ct-accent-hi`. Others: `text-ct-ink`, `hover:bg-ct-sunk`.
- Each non-trading store shows its stage beside the name in `font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3` — "opening soon" for `pre_open`, "warming up" for `warming_up`, nothing for `trading`. Note 58: the model has three stages and only two were ever expressible in the old interface, so a reader seeing an empty Glendale could not tell "not trading yet" from "the sync failed".
- `onSelect(null)` for "All stores" — the absence of a store, not a magic id.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/shell/store-switcher.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/shell/store-switcher.tsx tests/components/counter/shell/store-switcher.test.tsx
git commit -m "feat(counter): a switcher that deletes a class of route"
```

---

### Task 3: `DateControl`

The spec calls this "the most-used control in the product". The logic is already built and tested in `date-range.ts`; this is the surface over it.

**Files:**
- Create: `src/components/counter/shell/date-control.tsx`
- Test: `tests/components/counter/shell/date-control.test.tsx`

**Interfaces:**
- Consumes: `PRESETS`, `COMPARISONS`, `comparisonRange`, `dayCount`, `stepRange` from `@/lib/counter/date-range`.
- Produces: `<DateControl presetId comparisonId range onPreset onComparison onStep>`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { DateControl } from "@/components/counter/shell/date-control"

const range = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }
const props = {
  presetId: "d7" as const,
  comparisonId: "prev" as const,
  range,
  onPreset: () => {},
  onComparison: () => {},
  onStep: () => {},
}

describe("DateControl", () => {
  it("shows the current range in words", () => {
    render(<DateControl {...props} />)
    expect(screen.getByRole("button", { name: /last 7 days/i })).toBeTruthy()
  })

  it("opens a menu offering all twelve presets", () => {
    render(<DateControl {...props} />)
    screen.getByRole("button", { name: /last 7 days/i }).click()
    expect(within(screen.getByRole("menu", { name: /range/i })).getAllByRole("menuitemradio")).toHaveLength(12)
  })

  it("shows each preset's own length, so a reader picks by span not by name", () => {
    render(<DateControl {...props} />)
    screen.getByRole("button", { name: /last 7 days/i }).click()
    expect(screen.getByRole("menuitemradio", { name: /last 30 days/i }).textContent).toMatch(/30 days/)
  })

  it("steps back and forward by the span, not by a calendar unit", () => {
    const onStep = vi.fn()
    render(<DateControl {...props} onStep={onStep} />)
    screen.getByRole("button", { name: /previous period/i }).click()
    expect(onStep).toHaveBeenCalledWith(-1)
    screen.getByRole("button", { name: /next period/i }).click()
    expect(onStep).toHaveBeenLastCalledWith(1)
  })

  it("offers all four comparisons when the range is short enough", () => {
    render(<DateControl {...props} />)
    screen.getByRole("button", { name: /vs the prior period/i }).click()
    expect(within(screen.getByRole("menu", { name: /comparison/i })).getAllByRole("menuitemradio")).toHaveLength(4)
  })

  it("does NOT offer the weekday comparison on a long range", () => {
    // comparisonRange returns null past 7 days. A control that offers it would
    // render an empty comparison, which reads as "no change" rather than
    // "that question does not apply here".
    render(
      <DateControl
        {...props}
        presetId="d30"
        range={{ start: new Date(2026, 6, 26), end: new Date(2026, 7, 24) }}
      />,
    )
    screen.getByRole("button", { name: /vs the prior period/i }).click()
    const items = within(screen.getByRole("menu", { name: /comparison/i })).getAllByRole("menuitemradio")
    expect(items).toHaveLength(3)
    expect(items.map((i) => i.textContent).join(" ")).not.toMatch(/weekday/i)
  })

  it("closes on Escape without choosing anything", () => {
    const onPreset = vi.fn()
    render(<DateControl {...props} onPreset={onPreset} />)
    const trigger = screen.getByRole("button", { name: /last 7 days/i })
    trigger.click()
    expect(screen.getByRole("menu", { name: /range/i })).toBeTruthy()
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(screen.queryByRole("menu", { name: /range/i })).toBeNull()
    expect(onPreset).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/shell/date-control.test.tsx`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

Requirements the tests pin down, plus three the design does:
- A trigger button labelled with the current preset's name, opening a `role="menu"` with `aria-label="Range"` of twelve `menuitemradio`s. Each shows its name AND its own length ("Last 30 days · 30 days"), because a reader picks by span, not by name.
- Two stepper buttons, `aria-label`led "Previous period" and "Next period", calling `onStep(-1)` and `onStep(1)`. They walk by the span you are on — `stepRange` already does that; the control just reports the direction.
- A comparison trigger showing the current comparison's `label`, opening a `role="menu"` with `aria-label="Comparison"`. **Filter out any comparison whose `comparisonRange(range, id)` is `null`** — that is what drops `weekday` past a week.
- Escape closes any open menu without selecting. Clicking outside does too.
- **Note 21: the popover must measure its own frame.** The prototype's range picker is 438px wide, which is wider than a phone. Right-anchor it when there is room and flip when there is not, rather than letting it overflow the viewport. Implement it, and verify it in Task 5 — a jsdom test cannot prove it.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/shell/date-control.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/shell/date-control.tsx tests/components/counter/shell/date-control.test.tsx
git commit -m "feat(counter): the most-used control in the product"
```

---

### Task 4: `Topbar`

**Files:**
- Create: `src/components/counter/shell/topbar.tsx`
- Test: `tests/components/counter/shell/topbar.test.tsx`
- Modify: `src/components/counter/index.ts`

**Interfaces:**
- Consumes: `NAV_GROUPS`, `navById`, `isActive` from `@/lib/counter/nav`; `StoreSwitcher`; `DateControl`.
- Produces: `<Topbar pathname title syncedAt? children?>`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Topbar } from "@/components/counter/shell/topbar"

describe("Topbar", () => {
  it("names the page it is on", () => {
    render(<Topbar pathname="/dashboard/invoices" title="Invoices" />)
    expect(screen.getByRole("heading", { name: "Invoices" })).toBeTruthy()
  })

  it("shows a breadcrumb back to the parent on a detail route", () => {
    // The route IS the hierarchy (note 48): /dashboard/invoices/I28517 makes
    // Invoices the parent, and nothing is hand-wired.
    render(<Topbar pathname="/dashboard/invoices/I28517" title="Invoice I28517" />)
    const crumb = screen.getByRole("navigation", { name: /breadcrumb/i })
    expect(crumb.textContent).toContain("Invoices")
  })

  it("shows no breadcrumb on a top-level page", () => {
    render(<Topbar pathname="/dashboard/invoices" title="Invoices" />)
    expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).toBeNull()
  })

  it("says when the figures were last synced", () => {
    render(<Topbar pathname="/dashboard" title="Overview" syncedAt={new Date(2026, 7, 24, 9, 0)} />)
    expect(screen.getByText(/synced/i)).toBeTruthy()
  })

  it("renders its controls slot", () => {
    render(<Topbar pathname="/dashboard" title="Overview"><span>controls</span></Topbar>)
    expect(screen.getByText("controls")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/shell/topbar.test.tsx`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

- An `<h1>` carrying the title in `font-ct-display` — this is a page title, the one place Bricolage belongs besides the wordmark.
- A breadcrumb `<nav aria-label="Breadcrumb">` shown ONLY when the pathname is deeper than its matching nav destination. Derive the parent from `NAV_GROUPS` via `isActive`; never hand-wire a parent.
- A sync line when `syncedAt` is given, in `font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3`.
- A `children` slot on the right for the controls.
- Export `Topbar`, `StoreSwitcher` and `DateControl` from the barrel. `boundary.test.ts` now walks `shell/` too, so all three must be re-exported or it fails.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/shell/topbar.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the boundary test**

Run: `npx vitest run tests/components/counter/boundary.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/counter/shell/topbar.tsx src/components/counter/index.ts tests/components/counter/shell/topbar.test.tsx
git commit -m "feat(counter): a topbar that reads the hierarchy off the route"
```

---

### Task 5: Drive the controls in a browser

jsdom cannot prove a popover stays on screen, because it has no layout. Note 21 is specifically about that: "A popover that leaves its frame is broken, not clever."

**Files:**
- Create: `docs/counter/controls-verification.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Build a harness and drive it**

A throwaway route rendering `AppShell` with a `Topbar` containing a `StoreSwitcher` and a `DateControl`. `npm run dev`, Playwright, credentials in `.env.test.local`.

- [ ] **Step 2: Prove the popover stays on screen (note 21)**

Open the range menu at three viewport widths — 1440, 900, and 390 (a phone). At each, measure the menu's bounding box and assert it lies entirely within the viewport: `left >= 0` and `right <= innerWidth`. The prototype's picker is 438px wide, which is wider than a 390px phone, so the 390 case is the one that matters. Report the measured boxes.

- [ ] **Step 3: Prove the weekday comparison disappears on a long range**

With the range set to "Last 30 days", open the comparison menu and confirm three options, none of them weekday. Then set "Last 7 days" and confirm four. This is `comparisonRange` returning `null` reaching the surface — verify it end to end rather than trusting the unit test.

- [ ] **Step 4: Prove the URL round-trips**

Pick a preset, a comparison and a store; read `window.location.search`; reload; confirm the controls come back in the same state. Then confirm a default selection REMOVES its param rather than writing it. Report the URLs.

- [ ] **Step 5: Check both themes and the console**

Screenshot the open menus in light and dark. Zero console errors in both. Report the count.

- [ ] **Step 6: Write `docs/counter/controls-verification.md`** with every measurement and screenshot path, then delete the harness and confirm `git diff` is clean.

- [ ] **Step 7: Document in DESIGN.md**

Add a Controls section: the range and store live in the URL and why; the twelve presets each show their own span; steppers walk by the span you are on, not a calendar unit; the weekday comparison is withheld past a week because it has no meaning there; and the popover measures its own frame (note 21).

- [ ] **Step 8: Run the full gate**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
```

- [ ] **Step 9: Commit**

```bash
git add DESIGN.md docs/counter/controls-verification.md
git commit -m "docs(counter): the controls, driven and recorded"
```

---

## Done when

- The range and store round-trip through the URL, with defaults dropped
- The store switcher offers all stores plus each one, naming non-trading stages
- The date control offers twelve presets with their spans, four comparisons filtered by what is meaningful, and steppers that walk by span
- The popover stays on screen at 390px, measured
- `docs/counter/controls-verification.md` records it
- Full gate green

## Next plan

Plan 6 — the ⌘K `AskSurface`, whose first consumer is the `data-ask-about`
attribute `Section` has been emitting since Plan 2 (note 55: it was rendered on
fifty pages and wired to none). Then Overview: the first real page.
