# Counter Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real Counter page — and with it the adapter pattern that the other fifty-two will follow.

**Architecture:** A page is a server component that composes primitives. It calls exactly one adapter, which is the only new server code: the adapter calls the existing actions in `src/app/actions/` and `src/lib/`, classifies each result into `SectionData`, and returns a record of sections. Pages never import Prisma or an action, never branch on status, and never format a number themselves.

**Tech Stack:** Next.js 16 App Router (server components), React 19, TypeScript 7, Tailwind v4 `ct-` utilities, Vitest 4 with mocked Prisma, Playwright.

**Spec:** [`docs/superpowers/specs/2026-08-23-counter-design-system-design.md`](../specs/2026-08-23-counter-design-system-design.md) — §3.1 is the adapter contract, §5.2 is Overview.

## Global Constraints

- Branch `dashboardv2`. Never rebase, merge or push.
- Gate: `npm test && npm run tokens && npx tsc --noEmit && npm run build`. Baseline **189 files, 2056 passed | 8 skipped**. The 8 skips are deliberate inherited defects — never touch them.
- No ESLint. No `Co-Authored-By: Claude` line.
- **Never `prisma migrate dev`** — it would reset the production database. This plan reads data and changes no schema.
- Colour ONLY via `ct-` utilities or `"var(--ct-…)"`. Radii `rounded-ct` / `rounded-ct-sm` only.
- `framer-motion` only under `src/components/counter/motion/`.
- **A page may not import Prisma or a server action directly, and may not inspect `SectionData.status`.** `npm run tokens` fails the build on both. Adapters under `src/lib/counter/adapters/**` are exempt from the status rule — they construct `SectionData`.
- `font-ct-display` is the page title and the wordmark only.
- Component tests are `.tsx` with `// @vitest-environment jsdom` first line; under React 19 + RTL 16 use `fireEvent` where a state update is asserted.
- Screenshots: `scale: "css"` is NOT reliable evidence for `light-dark()`/`oklch()` backgrounds on this headless Chromium. Corroborate with `getComputedStyle` or pixel sampling.
- Do not touch untracked files you did not create. Do not commit `.next/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/counter/adapters/types.ts` | The shape every adapter returns |
| `src/lib/counter/adapters/overview.ts` | Overview's data, classified into six states |
| `src/app/dashboard/page.tsx` | **Replaced.** The Counter Overview page |
| `src/app/dashboard/counter-overview-client.tsx` | The client island holding the controls |
| `DESIGN.md` | Modified: a Pages section |

The existing `src/app/dashboard/components/**` (the editorial shell, masthead, ledger, skeletons) stays untouched — other editorial routes still import from it, and it dies with them in the final cleanup phase.

---

### Task 1: The adapter contract

Every page after this one copies this shape. Getting it right here is worth more than getting Overview right.

**Files:**
- Create: `src/lib/counter/adapters/types.ts`
- Test: `tests/lib/counter/adapters/types.test.ts`

**Interfaces:**
- Consumes: `SectionData` from `@/lib/counter/section-data`.
- Produces: `type PageSections<T>`, `classify`, `type AdapterResult`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { classify } from "@/lib/counter/adapters/types"
import { empty, notComputed } from "@/lib/counter/section-data"

describe("classify", () => {
  it("wraps a resolved value as ready", async () => {
    const sd = await classify(() => Promise.resolve({ n: 1 }), { retryAction: "sync" })
    expect(sd).toEqual({ status: "ready", data: { n: 1 } })
  })

  it("turns a thrown error into a named failure, not a crashed page", async () => {
    // One section failing must not take the page with it. That is how this app
    // already behaves, and the reader keeps every figure that did load.
    const sd = await classify(
      () => Promise.reject(new Error("Otter sync timed out")),
      { retryAction: "retrySync" },
    )
    expect(sd).toEqual({
      status: "failed", error: "Otter sync timed out", retryAction: "retrySync",
    })
  })

  it("uses a generic message when the thrown thing is not an Error", async () => {
    const sd = await classify(() => Promise.reject("boom"), { retryAction: "x" })
    expect(sd.status).toBe("failed")
    if (sd.status === "failed") expect(sd.error).toBe("Something went wrong loading this section")
  })

  it("reports empty when the caller says the result is empty", async () => {
    const sd = await classify(() => Promise.resolve([]), {
      retryAction: "x",
      isEmpty: (v) => v.length === 0,
      emptyReason: "no_match",
    })
    expect(sd).toEqual(empty("no_match"))
  })

  it("prefers a caller's pre_open reason, because a store with no customers is not a filter miss", async () => {
    const sd = await classify(() => Promise.resolve([]), {
      retryAction: "x",
      isEmpty: (v) => v.length === 0,
      emptyReason: "pre_open",
    })
    expect(sd).toEqual(empty("pre_open"))
  })

  it("marks a section stale when the caller supplies a last-good time", async () => {
    const at = new Date(2026, 7, 24, 9, 0)
    const sd = await classify(() => Promise.resolve({ n: 1 }), { retryAction: "x", staleSince: at })
    expect(sd).toEqual({ status: "stale", data: { n: 1 }, lastGoodAt: at })
  })

  it("never throws, whatever the loader does — a page must always render", async () => {
    await expect(
      classify(() => { throw new Error("sync throw") }, { retryAction: "x" }),
    ).resolves.toMatchObject({ status: "failed" })
  })

  it("owed() short-circuits without calling the loader at all", async () => {
    let called = false
    const sd = await classify(() => { called = true; return Promise.resolve(1) }, {
      retryAction: "x",
      owed: "clock-in/out leak ledger",
    })
    expect(sd).toEqual(notComputed("clock-in/out leak ledger"))
    // A section nobody has built must not pay for a query.
    expect(called).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/counter/adapters/types.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

```ts
import {
  empty, failed, notComputed, ready, stale,
  type EmptyReason, type SectionData,
} from "@/lib/counter/section-data"

/**
 * What every Counter page adapter returns.
 *
 * An adapter is the ONLY new server code a page needs. It calls the actions
 * and library functions that already exist, and its entire job is to classify
 * each result into one of the six states. Everything downstream — the six
 * renderings, the retry, the em-dashes — is already built.
 *
 * `npm run tokens` forbids a page from importing Prisma or an action directly,
 * and from inspecting `SectionData.status`. This is where both of those live
 * instead.
 */
export type PageSections = Record<string, SectionData<unknown>>

export interface ClassifyOptions<T> {
  /** A name a client can map to a handler. Not a function — a SectionData must stay serialisable. */
  retryAction: string
  /** When set, the loader is never called and the section reports owed work. */
  owed?: string
  isEmpty?: (value: T) => boolean
  /** Which empty. A pre-open store is not a filter that matched nothing. */
  emptyReason?: EmptyReason
  /** When the last successful sync ran, if the current one failed. */
  staleSince?: Date
}

/**
 * Runs one loader and classifies its outcome. It NEVER throws: a section that
 * fails becomes a `failed` section, and the rest of the page renders with every
 * figure that did load. A page that 500s because one query timed out throws
 * away good numbers the reader could have used.
 */
export async function classify<T>(
  load: () => T | Promise<T>,
  opts: ClassifyOptions<T>,
): Promise<SectionData<T>> {
  // Owed work short-circuits BEFORE the loader runs. A section nobody has
  // built yet must not pay for a query to prove it.
  if (opts.owed !== undefined) return notComputed<T>(opts.owed)

  try {
    const value = await load()

    if (opts.isEmpty?.(value)) return empty<T>(opts.emptyReason ?? "no_match")
    if (opts.staleSince) return stale(value, opts.staleSince)
    return ready(value)
  } catch (err) {
    return failed<T>(
      err instanceof Error ? err.message : "Something went wrong loading this section",
      opts.retryAction,
    )
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/counter/adapters/types.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter/adapters/types.ts tests/lib/counter/adapters/types.test.ts
git commit -m "feat(counter): the adapter contract fifty-two pages will follow"
```

---

### Task 2: Overview's adapter

**Files:**
- Create: `src/lib/counter/adapters/overview.ts`
- Test: `tests/lib/counter/adapters/overview.test.ts`

**Interfaces:**
- Consumes: `classify`; `toQueryBounds` from `@/lib/counter/date-range`; existing actions.
- Produces: `getOverviewSections({ range, storeId })` returning named `SectionData`s.

- [ ] **Step 1: Read what already exists before writing anything**

These are real and tested; do NOT reimplement them:
- `getSplhSeries` in `src/app/actions/splh-actions.ts` — sales per labour hour, note 30's second number.
- `getCogsKpis`, `getCogsStoreOverview` in `src/lib/cogs.ts`.
- `getInvoiceSummary` in `src/app/actions/invoice-actions.ts`.
- `isOperational`, `partitionByLifecycle`, `LIFECYCLE_LABEL` in `src/lib/store-lifecycle.ts`.
- `toQueryBounds(range)` in `src/lib/counter/date-range.ts` — **use it.** Counter's `end` is a local midnight while the existing queries expect an inclusive `23:59:59` end. Passing Counter's range straight through silently drops the last day of every range.

Read each signature before calling it. Report anything whose shape does not match what this task assumes.

- [ ] **Step 2: Write the failing test**

Mock the actions with `vi.mock` and assert the classification, not the numbers:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/app/actions/splh-actions", () => ({ getSplhSeries: vi.fn() }))
vi.mock("@/lib/cogs", () => ({ getCogsKpis: vi.fn(), getCogsStoreOverview: vi.fn() }))
vi.mock("@/app/actions/invoice-actions", () => ({ getInvoiceSummary: vi.fn() }))

import { getSplhSeries } from "@/app/actions/splh-actions"
import { getCogsStoreOverview } from "@/lib/cogs"
import { getInvoiceSummary } from "@/app/actions/invoice-actions"
import { getOverviewSections } from "@/lib/counter/adapters/overview"

const range = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }

describe("getOverviewSections", () => {
  beforeEach(() => vi.resetAllMocks())

  it("returns every section the page composes, named", async () => {
    vi.mocked(getSplhSeries).mockResolvedValue([] as never)
    vi.mocked(getCogsStoreOverview).mockResolvedValue([] as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    const s = await getOverviewSections({ range, storeId: null })
    for (const key of ["lead", "ledger", "invoices", "needsYou", "modelCall"]) {
      expect(s[key]).toBeDefined()
    }
  })

  it("classifies a thrown loader as failed without taking the page down", async () => {
    vi.mocked(getSplhSeries).mockRejectedValue(new Error("Otter sync timed out"))
    vi.mocked(getCogsStoreOverview).mockResolvedValue([] as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    const s = await getOverviewSections({ range, storeId: null })
    expect(s.lead.status).toBe("failed")
    // Every other section still resolved.
    expect(s.ledger.status).not.toBe("failed")
  })

  it("reports owed sections without querying for them", async () => {
    vi.mocked(getSplhSeries).mockResolvedValue([] as never)
    vi.mocked(getCogsStoreOverview).mockResolvedValue([] as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    const s = await getOverviewSections({ range, storeId: null })
    // The design calls for these and no server code computes them yet.
    expect(s.needsYou.status).toBe("not_computed")
    expect(s.modelCall.status).toBe("not_computed")
  })

  it("passes INCLUSIVE query bounds, not Counter's midnight end", async () => {
    vi.mocked(getSplhSeries).mockResolvedValue([] as never)
    vi.mocked(getCogsStoreOverview).mockResolvedValue([] as never)
    vi.mocked(getInvoiceSummary).mockResolvedValue({} as never)
    await getOverviewSections({ range, storeId: null })
    const passed = vi.mocked(getSplhSeries).mock.calls[0][0] as { endDate: Date }
    // Counter's end is 00:00 on the 24th. An inclusive query needs the whole
    // day, or every range silently loses its last day.
    expect(passed.endDate.getHours()).toBeGreaterThan(0)
  })

  it("never throws, however badly the loaders behave", async () => {
    vi.mocked(getSplhSeries).mockRejectedValue(new Error("a"))
    vi.mocked(getCogsStoreOverview).mockRejectedValue(new Error("b"))
    vi.mocked(getInvoiceSummary).mockRejectedValue(new Error("c"))
    await expect(getOverviewSections({ range, storeId: null })).resolves.toBeDefined()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/lib/counter/adapters/overview.test.ts`
Expected: FAIL — cannot resolve the adapter.

- [ ] **Step 4: Write the adapter**

- One `classify` call per section, all awaited together with `Promise.all` so a slow section does not serialise the page.
- `lead`, `ledger` and `invoices` load real data. `needsYou` and `modelCall` are `owed` — the design calls for them and no server code computes them. Name the owed work honestly: "alerts and decisions queue" and "the model's call for this day".
- Convert the range with `toQueryBounds` before calling anything.
- A module comment explaining that this is the ONLY new server code a page needs, and that a page importing an action directly is a lint failure.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/lib/counter/adapters/overview.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/counter/adapters/overview.ts tests/lib/counter/adapters/overview.test.ts
git commit -m "feat(counter): Overview's data, classified"
```

---

### Task 3: The page

**Files:**
- Create: `src/app/dashboard/counter-overview-client.tsx`
- Replace: `src/app/dashboard/page.tsx`
- Test: `tests/app/counter-overview.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { CounterOverviewClient } from "@/app/dashboard/counter-overview-client"
import { ready, failed, notComputed, empty } from "@/lib/counter/section-data"

const base = {
  pathname: "/dashboard",
  params: new URLSearchParams(),
  stores: [{ id: "hollywood", name: "Hollywood", stage: "trading" as const }],
  today: new Date(2026, 7, 25),
}

const sections = {
  lead: ready({ netSales: 7468, orders: 376, avgTicket: 19.86, splh: 71.93 }),
  ledger: ready([{ storeId: "hollywood", store: "Hollywood", orders: 376, net: 7468 }]),
  invoices: ready({ spend: 63203, count: 34, needsReview: 6 }),
  needsYou: notComputed("alerts and decisions queue"),
  modelCall: notComputed("the model's call for this day"),
}

describe("Counter Overview", () => {
  it("renders the page title", () => {
    render(<CounterOverviewClient {...base} sections={sections} />)
    expect(screen.getByRole("heading", { name: /overview/i })).toBeTruthy()
  })

  it("shows the two numbers an owner checks", () => {
    // Note 30: net sales says whether the day happened; sales per labour hour
    // says whether it was worth having.
    render(<CounterOverviewClient {...base} sections={sections} />)
    expect(screen.getByText("$7,468")).toBeTruthy()
    expect(screen.getByText("$71.93")).toBeTruthy()
  })

  it("names owed sections instead of showing a zero", () => {
    render(<CounterOverviewClient {...base} sections={sections} />)
    expect(screen.getByText(/alerts and decisions queue/)).toBeTruthy()
    expect(screen.queryByText("$0")).toBeNull()
  })

  it("renders a failed section as a failure and keeps the rest of the page", () => {
    render(
      <CounterOverviewClient
        {...base}
        sections={{ ...sections, lead: failed("Otter sync timed out", "retrySync") }}
      />,
    )
    expect(screen.getByRole("alert")).toBeTruthy()
    // The ledger still rendered.
    expect(screen.getByText("Hollywood")).toBeTruthy()
  })

  it("renders a pre-open store's empty state with its reason", () => {
    render(
      <CounterOverviewClient {...base} sections={{ ...sections, ledger: empty("pre_open") }} />,
    )
    expect(screen.getByText(/not trading yet/i)).toBeTruthy()
  })

  it("never inspects a section's status itself — the lint proves that, this asserts the result", () => {
    // All six states render through Section. If a page ever branched on status
    // it would diverge from the others; this catches the symptom.
    for (const s of [ready({}), failed("x", "y"), notComputed("z"), empty("no_match")]) {
      const { unmount } = render(
        <CounterOverviewClient {...base} sections={{ ...sections, invoices: s }} />,
      )
      expect(screen.getByRole("heading", { name: /overview/i })).toBeTruthy()
      unmount()
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/app/counter-overview.test.tsx`
Expected: FAIL — cannot resolve the client module.

- [ ] **Step 3: Write the client island and the page**

`counter-overview-client.tsx` (`"use client"`):
- Holds `AppShell` + `Topbar` + `StoreSwitcher` + `DateControl`, reading and writing the URL with `readCounterParams`/`writeCounterParams` via `useRouter`/`useSearchParams`.
- Renders each section inside an `EntryItem` so the page enters in reading order.
- Composes: a `Strip` for the lead (net sales, orders, avg ticket, SPLH), a `Table` for the per-store ledger, a `Strip` for invoices, and `Section`s for the two owed ones.
- **Passes `params`, `storeName` and `today` into `AppShell`** so the Ask surface's context sentence is right — Plan 6 shipped with every live mount falling back to "All stores".

`page.tsx` (server component):
- Session check and redirect exactly as the current page does — read it first and preserve the auth behaviour verbatim.
- Loads stores, calls `getOverviewSections`, renders the client island.
- Imports NO action directly and never touches `.status`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/app/counter-overview.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the lint holds on a real page**

Run: `npm run tokens`
Expected: `Counter rules: clean`. This is the first page written under the rules — if it fails, fix the page, never the rule.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/dashboard/counter-overview-client.tsx tests/app/counter-overview.test.tsx
git commit -m "feat(counter): the first page"
```

---

### Task 4: Look at it

**Files:**
- Create: `docs/counter/overview-verification.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Load the real page in a browser**

`npm run dev`, Playwright, credentials in `.env.test.local`. Go to `/dashboard` — the real route, not a harness. Sign in. Screenshot in both themes.

**Remember `scale: "css"` is unreliable for these backgrounds on this build — corroborate with `getComputedStyle` or pixel sampling before believing two screenshots look the same.**

- [ ] **Step 2: Describe what you see, honestly**

- Does it read as a page an owner would use, or as a demo of components?
- Are the two lead numbers (net sales, sales per labour hour) the first things you see? Note 30's whole argument is that an owner checks two numbers.
- Do the owed sections read as honest missing work, or as broken?
- Does the per-store ledger read at a glance?
- In dark, does anything disappear?
- **Anything that looks wrong is the point of this task.** Say it plainly.

- [ ] **Step 3: Exercise the controls on the real page**

Change the range; confirm the figures change and the URL updates. Change the store; same. Press ⌘K; confirm the context sentence names Overview, the selected store and the range in effect. Reload; confirm state survives. Report each.

- [ ] **Step 4: Check the states are reachable**

Confirm at least one section renders its `not_computed` state on the live page, and that it names the owed work rather than showing zero.

- [ ] **Step 5: Console and bundle**

Report console errors in both themes. Run `npm run bundle:check` and compare `/dashboard` against `docs/counter/baseline-bundles.txt`. The Counter page replaces a heavier editorial one — report whether it is lighter or heavier and by how much.

- [ ] **Step 6: Write `docs/counter/overview-verification.md`**, add a Pages section to `DESIGN.md` describing the adapter contract and that a page composes primitives and calls exactly one adapter.

- [ ] **Step 7: Run the full gate**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
```

- [ ] **Step 8: Commit**

```bash
git add DESIGN.md docs/counter/overview-verification.md
git commit -m "docs(counter): the first page, seen"
```

---

## Done when

- `classify` turns any loader outcome into one of six states and never throws
- Overview's adapter loads real data for the lead, ledger and invoices, and names two owed sections without querying for them
- `/dashboard` renders Counter, passes `npm run tokens`, and preserves the existing auth behaviour
- The controls change the figures and the URL; ⌘K names the right context
- `docs/counter/overview-verification.md` records what it looks like, with the bundle comparison
- Full gate green

## Next plan

Plan 8 — **P&L**, the highest-value screen and the one note 60 is about: prime
cost read 56.2% on Overview and 57.9% on the P&L for the same range, because one
counted hourly wages and the other hourly cost. `src/lib/counter/prime-cost.ts`
arrives there, with its first caller, and Overview switches to it in the same
change so the two cannot disagree.
