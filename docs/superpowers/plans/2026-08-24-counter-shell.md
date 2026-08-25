# Counter Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frame every Counter page sits inside — the rail that reaches all seventeen destinations, the wordmark, and the shell that owns entry motion — and fix the hydration defect that mounting the theme toggle would otherwise make live.

**Architecture:** `AppShell` is a client component owning the two-column grid and the per-section entry index; `Rail` and `Wordmark` are presentational. The rail's seventeen items are declared once in `src/lib/counter/nav.ts` so no page hand-writes a route. `Section` stays a server component — the shell, not the section, owns motion.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 7, Tailwind v4 `ct-` utilities, Vitest 4 + Testing Library, Playwright for the render proof.

**Spec:** [`docs/superpowers/specs/2026-08-23-counter-design-system-design.md`](../specs/2026-08-23-counter-design-system-design.md) — §5.1 is the rail.

**Prototype:** [`docs/counter/counter-prototype.html`](../../counter/counter-prototype.html) — its `GROUPS` array and `.rail` styles are what this replaces.

## Global Constraints

- Branch `dashboardv2`. Never rebase, merge or push.
- Gate: `npm test && npm run tokens && npx tsc --noEmit && npm run build`. Baseline **179 files, 1979 passed | 8 skipped**. The 8 skips are deliberate inherited design-prototype defects — never touch them.
- No ESLint. No `Co-Authored-By: Claude` line. Never `prisma migrate dev` — no schema here.
- Colour ONLY by reference: `ct-` utilities in class names, `"var(--ct-…)"` where a raw string is required. No hex, `oklch()`, `rgb()`, `hsl()`, `bg-white`, `text-black`, or Tailwind palette colours.
- Radii `rounded-ct` / `rounded-ct-sm` only.
- `framer-motion` may be imported ONLY under `src/components/counter/motion/` — and nothing there imports it today. A shell transition belongs in `counter.css` keyframes gated by `useReducedMotion()`, following `useEntry`.
- Bricolage (`font-ct-display`) is for page titles and the wordmark ONLY.
- Component tests are `.tsx` with `// @vitest-environment jsdom` as the first line.
- Do not touch untracked files you did not create. Do not commit `.next/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/components/counter/theme-provider.tsx` | Modified: stop reading client-only state during render |
| `src/lib/counter/nav.ts` | The seventeen destinations, in five groups, declared once |
| `src/components/counter/shell/wordmark.tsx` | The brand mark |
| `src/components/counter/shell/rail.tsx` | The navigation rail |
| `src/components/counter/shell/app-shell.tsx` | The two-column frame; owns the entry index |
| `src/components/counter/index.ts` | Modified: export the shell |
| `DESIGN.md` | Modified: a Shell section |

Deferred to the next plan, deliberately: `Topbar`, `StoreSwitcher`, `DateControl`, and the ⌘K `AskSurface`. Those are stateful controls with their own logic; this plan is the frame they mount into.

---

### Task 1: Fix `theme-provider`'s hydration defect — before anything mounts it

Plan 3 removed exactly this pattern from `useReducedMotion` after it caused `Hydration failed` on 6 of 6 navigations. `theme-provider.tsx` still has it, and this plan is the one that gives it a consumer.

**Files:**
- Modify: `src/components/counter/theme-provider.tsx`
- Modify: `tests/app/counter-theme.test.tsx`

**Interfaces:**
- Produces: unchanged public API — `CounterThemeProvider`, `useCounterTheme`, `themeNoFlashScript`.

- [ ] **Step 1: Read the current initialisers and understand why they are unsafe**

`theme-provider.tsx` initialises state with `useState(() => readStored())` and `useState(() => systemPrefersDark())`. Both read client-only values **during render**. On the server they return the fallback; on the client's first render they return the real value. That is the identical shape Plan 3 removed from `useReducedMotion`, and it produced a hydration failure that discarded and remounted the subtree.

It is inert today only because nothing consumes the context — `CounterThemeProvider` is already mounted app-wide at `src/app/layout.tsx`, but `ThemeToggle` has no importer. The moment a consumer renders from `theme`, the mismatch is live.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { CounterThemeProvider, useCounterTheme } from "@/components/counter/theme-provider"

function Probe() {
  const { theme, resolved } = useCounterTheme()
  return <span data-testid="v">{`${theme}/${resolved}`}</span>
}

describe("theme-provider hydration safety", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-theme")
  })

  it("first render is SSR-safe even when a choice is stored", () => {
    // The server cannot see localStorage, so it renders "system". If the
    // client's FIRST render disagrees, React discards the tree — which is
    // exactly what happened to useCountUp in the previous plan.
    localStorage.setItem("counter-theme", "dark")
    const { container } = render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
    // Whatever it settles on, the value captured during the first commit must
    // be the SSR-safe default, not the stored one.
    expect(container.querySelector("[data-testid=v]")).toBeTruthy()
    // After effects run it reconciles to the stored choice.
    expect(screen.getByTestId("v").textContent).toBe("dark/dark")
  })

  it("still resolves system to the OS preference after mount", () => {
    render(<CounterThemeProvider><Probe /></CounterThemeProvider>)
    expect(screen.getByTestId("v").textContent).toMatch(/^system\/(light|dark)$/)
  })

  it("survives a storage accessor that throws", () => {
    const original = Storage.prototype.getItem
    try {
      Storage.prototype.getItem = () => { throw new Error("blocked") }
      expect(() => render(<CounterThemeProvider><Probe /></CounterThemeProvider>)).not.toThrow()
    } finally {
      Storage.prototype.getItem = original
    }
  })
})
```

- [ ] **Step 3: Run it to verify the first test fails**

Run: `npx vitest run tests/app/counter-theme.test.tsx`
Expected: the hydration-safety test FAILS, because the initialiser reads storage during render.

- [ ] **Step 4: Apply the fix**

Change both `useState` initialisers to SSR-safe constants — `"system"` for the theme, `false` for `systemDark` — and read the real values in the existing mount effect. The effect already calls `applyTheme`; extend it to also reconcile `theme` from storage and `systemDark` from `matchMedia`.

Add a comment naming what this guards, mirroring `use-reduced-motion.ts`: reading client-only state during render is what produced hydration failures in `useCountUp` and `useEntry`, so no initialiser in Counter may do it. Note also that `themeNoFlashScript` already stamps `data-theme` before React renders — so React's first render must NOT attempt to agree with the DOM; the effect reconciles.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/app/counter-theme.test.tsx`
Expected: PASS, all tests including the pre-existing ones. If a pre-existing test asserted the old render-time read, change the TEST to assert the new contract and say which you changed.

- [ ] **Step 6: Commit**

```bash
git add src/components/counter/theme-provider.tsx tests/app/counter-theme.test.tsx
git commit -m "fix(counter): the theme provider stops reading client state during render"
```

---

### Task 2: The seventeen destinations, declared once

Note 24: "A rail item is a decision, not an inventory. Thirty-two items is not navigation, it is a table of contents. Seventeen fits in one glance without scrolling."

**Files:**
- Create: `src/lib/counter/nav.ts`
- Test: `tests/lib/counter/nav.test.ts`

**Interfaces:**
- Produces: `NAV_GROUPS`, `type NavId`, `type NavItem`, `type NavGroup`, `navById`, `isActive`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { NAV_GROUPS, navById, isActive, type NavId } from "@/lib/counter/nav"

describe("nav", () => {
  it("has exactly five groups in the design's order", () => {
    expect(NAV_GROUPS.map((g) => g.caption)).toEqual([
      "Today", "Money", "Menu", "Stock and suppliers", "Admin",
    ])
  })

  it("has exactly seventeen destinations — a rail item is a decision, not an inventory", () => {
    expect(NAV_GROUPS.flatMap((g) => g.items)).toHaveLength(17)
  })

  it("groups the destinations as the design specifies", () => {
    expect(NAV_GROUPS.map((g) => g.items.map((i) => i.id))).toEqual([
      ["overview", "ask", "needs-you", "orders"],
      ["analytics", "pnl", "cogs", "labor"],
      ["menu", "recipes"],
      ["invoices", "inventory", "ingredients", "vendors"],
      ["stores", "settings", "monitoring"],
    ])
  })

  it("gives every destination a route under /dashboard", () => {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
      expect(item.href.startsWith("/dashboard")).toBe(true)
    }
  })

  it("has no duplicate ids or routes", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items)
    expect(new Set(items.map((i) => i.id)).size).toBe(17)
    expect(new Set(items.map((i) => i.href)).size).toBe(17)
  })

  it("navById throws on an unknown id rather than returning undefined", () => {
    expect(navById("pnl").label).toBe("P&L")
    // @ts-expect-error — an unknown id must not type-check either
    expect(() => navById("nope")).toThrow(/unknown nav id/)
  })

  it("marks a destination active for its own route and its children", () => {
    // A detail route keeps its parent lit: /dashboard/invoices/I28517 is
    // still Invoices, which is where the breadcrumb comes from (note 48).
    expect(isActive(navById("invoices"), "/dashboard/invoices")).toBe(true)
    expect(isActive(navById("invoices"), "/dashboard/invoices/I28517")).toBe(true)
    expect(isActive(navById("invoices"), "/dashboard/inventory")).toBe(false)
  })

  it("does not let /dashboard light every item", () => {
    // Overview owns /dashboard exactly; a prefix match would light all 17.
    expect(isActive(navById("overview"), "/dashboard")).toBe(true)
    expect(isActive(navById("overview"), "/dashboard/orders")).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/counter/nav.test.ts`
Expected: FAIL — cannot resolve `@/lib/counter/nav`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The seventeen destinations the rail reaches, declared once.
 *
 * Note 24: "A rail item is a decision, not an inventory." The pre-Counter
 * dashboard had thirty-two entries, which is a table of contents rather than
 * navigation. Seventeen fits in one glance without scrolling.
 *
 * Pages that absorbed another page keep it as a VIEW rather than a rail item —
 * Menu holds Items, Profit and Mix; COGS holds theoretical-vs-actual — so this
 * list is destinations, not screens. And a per-store page is the store
 * switcher's destination, not an eighteenth item (note 25).
 */

export type NavId =
  | "overview" | "ask" | "needs-you" | "orders"
  | "analytics" | "pnl" | "cogs" | "labor"
  | "menu" | "recipes"
  | "invoices" | "inventory" | "ingredients" | "vendors"
  | "stores" | "settings" | "monitoring"

export interface NavItem {
  id: NavId
  label: string
  href: string
  /** lucide icon name, resolved by the Rail so this module stays render-free. */
  icon: string
  /**
   * When true, only an exact path match lights this item. Overview owns
   * `/dashboard` itself; without this a prefix match would light all seventeen.
   */
  exact?: boolean
}

export interface NavGroup {
  caption: string
  items: NavItem[]
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    caption: "Today",
    items: [
      { id: "overview", label: "Overview", href: "/dashboard", icon: "LayoutDashboard", exact: true },
      { id: "ask", label: "Ask", href: "/dashboard/ask", icon: "MessageSquare" },
      { id: "needs-you", label: "Needs you", href: "/dashboard/needs-you", icon: "Bell" },
      { id: "orders", label: "Orders", href: "/dashboard/orders", icon: "Receipt" },
    ],
  },
  {
    caption: "Money",
    items: [
      { id: "analytics", label: "Analytics", href: "/dashboard/analytics", icon: "ChartLine" },
      { id: "pnl", label: "P&L", href: "/dashboard/pnl", icon: "Wallet" },
      { id: "cogs", label: "COGS", href: "/dashboard/cogs", icon: "Coins" },
      { id: "labor", label: "Labor", href: "/dashboard/labor", icon: "Users" },
    ],
  },
  {
    caption: "Menu",
    items: [
      { id: "menu", label: "Menu", href: "/dashboard/menu", icon: "BookOpen" },
      { id: "recipes", label: "Recipes", href: "/dashboard/recipes", icon: "ChefHat" },
    ],
  },
  {
    caption: "Stock and suppliers",
    items: [
      { id: "invoices", label: "Invoices", href: "/dashboard/invoices", icon: "FileText" },
      { id: "inventory", label: "Inventory", href: "/dashboard/inventory", icon: "Package" },
      { id: "ingredients", label: "Ingredients", href: "/dashboard/ingredients", icon: "Carrot" },
      { id: "vendors", label: "Vendors", href: "/dashboard/vendors", icon: "Truck" },
    ],
  },
  {
    caption: "Admin",
    items: [
      { id: "stores", label: "Stores", href: "/dashboard/stores", icon: "Store" },
      { id: "settings", label: "Settings", href: "/dashboard/settings", icon: "Settings2" },
      { id: "monitoring", label: "Monitoring", href: "/dashboard/admin/monitoring", icon: "Activity" },
    ],
  },
] as const

const ALL = NAV_GROUPS.flatMap((g) => g.items)

export function navById(id: NavId): NavItem {
  const item = ALL.find((i) => i.id === id)
  // Throwing rather than returning undefined: a missing destination is a
  // programming error, and a silent undefined renders an unlabelled rail row.
  if (!item) throw new Error(`unknown nav id: ${id}`)
  return item
}

/**
 * A destination stays lit for its own children, because the route IS the
 * hierarchy (note 48): `/dashboard/invoices/I28517` is still Invoices, which
 * is where the breadcrumb and the phone's back button come from.
 */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/counter/nav.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter/nav.ts tests/lib/counter/nav.test.ts
git commit -m "feat(counter): seventeen destinations, declared once"
```

---

### Task 3: The wordmark and the rail

Note 15: the wordmark is the palette's alibi — Counter's red reads as a designer's choice until you put the logo next to it, at which point it reads as the brand.

**Files:**
- Create: `src/components/counter/shell/wordmark.tsx`
- Create: `src/components/counter/shell/rail.tsx`
- Test: `tests/components/counter/shell/rail.test.tsx`

**Interfaces:**
- Consumes: `NAV_GROUPS`, `isActive`, `navById` from `@/lib/counter/nav`.
- Produces: `<Wordmark />`, `<Rail pathname />`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { Rail } from "@/components/counter/shell/rail"

describe("Rail", () => {
  it("is a navigation landmark with an accessible name", () => {
    render(<Rail pathname="/dashboard" />)
    expect(screen.getByRole("navigation", { name: /sections/i })).toBeTruthy()
  })

  it("renders all seventeen destinations", () => {
    render(<Rail pathname="/dashboard" />)
    expect(screen.getAllByRole("link")).toHaveLength(17)
  })

  it("renders the five group captions", () => {
    render(<Rail pathname="/dashboard" />)
    for (const cap of ["Today", "Money", "Menu", "Stock and suppliers", "Admin"]) {
      expect(screen.getByText(cap)).toBeTruthy()
    }
  })

  it("marks exactly one destination current, and says so to a screen reader", () => {
    render(<Rail pathname="/dashboard/invoices" />)
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page")
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain("Invoices")
  })

  it("keeps the parent lit on a detail route", () => {
    render(<Rail pathname="/dashboard/invoices/I28517" />)
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page")
    expect(current[0].textContent).toContain("Invoices")
  })

  it("lights Overview alone on /dashboard, not all seventeen", () => {
    render(<Rail pathname="/dashboard" />)
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page")
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain("Overview")
  })

  it("groups its links so the caption names the set", () => {
    render(<Rail pathname="/dashboard" />)
    const money = screen.getByRole("group", { name: "Money" })
    expect(within(money).getAllByRole("link")).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/shell/rail.test.tsx`
Expected: FAIL — cannot resolve `@/components/counter/shell/rail`.

- [ ] **Step 3: Write the wordmark**

```tsx
/**
 * Note 15: "The wordmark is the palette's alibi." Counter's red and signal
 * yellow read as a designer's choice until the logo sits next to them, at
 * which point they read as the brand. It is the one place Bricolage appears
 * outside a page title.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-ct-display text-ct-lg font-extrabold tracking-tight text-ct-accent ${className}`}
    >
      Chris N Eddy&apos;s
    </span>
  )
}
```

- [ ] **Step 4: Write the rail**

Requirements the test pins down, plus two the design does:
- A `<nav aria-label="Sections">` containing five groups. Each group is `role="group"` with `aria-label` set to its caption, so a screen-reader user hears which set a destination belongs to.
- Each item is a `next/link`. The active one carries `aria-current="page"` — that attribute, not a colour, is what tells a screen reader where it is.
- The active item uses `bg-ct-accent-wash` with `text-ct-accent-hi`; the rest are `text-ct-ink` with a `hover:bg-ct-sunk`. Captions are `font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3`.
- Icons come from `lucide-react`, resolved by name from `item.icon`. Keep the icon `aria-hidden` — the label beside it is the accessible name, and an icon announced twice is noise.
- The rail is `212px` wide, matching the prototype's grid.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/shell/rail.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 6: Verify the design rules hold**

Run: `npm run tokens`
Expected: `Counter rules: clean`.

- [ ] **Step 7: Commit**

```bash
git add src/components/counter/shell tests/components/counter/shell
git commit -m "feat(counter): a rail that fits in one glance"
```

---

### Task 4: `AppShell` — the frame, and where motion lives

`Section` is deliberately a server component, so it cannot call `useEntry`. The shell owns the index and spreads the style — that decision is what keeps the sole state renderer on the server.

**Files:**
- Create: `src/components/counter/shell/app-shell.tsx`
- Test: `tests/components/counter/shell/app-shell.test.tsx`
- Modify: `src/components/counter/index.ts`

**Interfaces:**
- Consumes: `Rail`, `Wordmark`, `useEntry`.
- Produces: `<AppShell pathname topbar? children>`, `<EntryItem index children>`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { AppShell, EntryItem } from "@/components/counter/shell/app-shell"

function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches, media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {}, removeEventListener: () => {},
  }))
}

describe("AppShell", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("renders the rail and the page content", () => {
    setReducedMotion(true)
    render(<AppShell pathname="/dashboard"><p>page body</p></AppShell>)
    expect(screen.getByRole("navigation", { name: /sections/i })).toBeTruthy()
    expect(screen.getByText("page body")).toBeTruthy()
  })

  it("puts the page content in a main landmark", () => {
    setReducedMotion(true)
    render(<AppShell pathname="/dashboard"><p>page body</p></AppShell>)
    expect(within(screen.getByRole("main")).getByText("page body")).toBeTruthy()
  })

  it("offers a skip link so a keyboard user can pass seventeen rail items", () => {
    setReducedMotion(true)
    render(<AppShell pathname="/dashboard"><p>body</p></AppShell>)
    const skip = screen.getByRole("link", { name: /skip to content/i })
    expect(skip.getAttribute("href")).toBe("#ct-main")
  })

  it("EntryItem staggers by index when motion is allowed", () => {
    setReducedMotion(false)
    const { container } = render(
      <>
        <EntryItem index={0}><p>a</p></EntryItem>
        <EntryItem index={1}><p>b</p></EntryItem>
      </>,
    )
    const items = container.querySelectorAll("[data-entry-item]")
    expect((items[0] as HTMLElement).style.animationDelay).toBe("0ms")
    expect((items[1] as HTMLElement).style.animationDelay).toBe("36ms")
  })

  it("EntryItem emits no animation under reduced motion", () => {
    setReducedMotion(true)
    const { container } = render(<EntryItem index={3}><p>a</p></EntryItem>)
    const item = container.querySelector("[data-entry-item]") as HTMLElement
    expect(item.style.animationName).toBe("")
  })
})
```

Note: add `within` to the import from `@testing-library/react`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/shell/app-shell.test.tsx`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

- `AppShell` is `"use client"`. It renders a skip link, the rail in a `212px` column, an optional `topbar` slot, and `<main id="ct-main">` holding children.
- `EntryItem` is a thin client wrapper calling `useEntry(index)` and spreading the returned style onto a `div` carrying `data-entry-item`.
- Explain in a comment WHY `EntryItem` exists rather than `Section` calling `useEntry` itself: `Section` is the sole `SectionData` renderer and is deliberately a server component; making it call a hook would turn it into a client component and drag every page's data rendering to the client with it.
- The shell's background is `bg-ct-paper`; the rail column is `bg-ct-chrome` with a `border-r border-ct-line`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/shell/app-shell.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Export from the barrel**

Add to `src/components/counter/index.ts`:

```ts
export { AppShell, EntryItem } from "./shell/app-shell"
export { Rail } from "./shell/rail"
export { Wordmark } from "./shell/wordmark"
```

Run: `npx vitest run tests/components/counter/boundary.test.ts`
Expected: PASS — `state/` must still not be re-exported. Note that test asserts every `surface/*.tsx` is exported; confirm whether it also covers `shell/`, and if it does not, extend it so the shell is held to the same rule.

- [ ] **Step 6: Commit**

```bash
git add src/components/counter/shell/app-shell.tsx src/components/counter/index.ts tests/components/counter/shell/app-shell.test.tsx tests/components/counter/boundary.test.ts
git commit -m "feat(counter): the frame, and the client boundary motion needs"
```

---

### Task 5: Render it, look at it, and document it

Every defect that mattered in the previous three plans was invisible to the test suite. This task is where the shell stops being markup assertions and becomes something someone has actually seen.

**Files:**
- Modify: `DESIGN.md`
- Create: `docs/counter/shell-verification.md`

- [ ] **Step 1: Build a throwaway harness and look at it**

Create a temporary route rendering `AppShell` with a handful of `EntryItem`-wrapped `Section`s, at a realistic pathname such as `/dashboard/invoices`. Run `npm run dev`, drive it with Playwright (credentials in `.env.test.local` are configured and work), and capture screenshots at desktop width in BOTH themes.

Look at them and answer in words:
- Do the five groups read as five groups, or as one long list?
- Is the active item obvious at a glance without reading it?
- Does the wordmark carry the palette, as note 15 claims it does?
- Does the rail fit in one glance without scrolling at a normal viewport height? Note 24's whole argument is that seventeen does; verify it rather than trusting it.
- In dark, does the rail column separate from the page, or do `ct-chrome` and `ct-paper` merge?

- [ ] **Step 2: Verify entry motion actually runs here**

With `emulateMedia({ reducedMotion: "no-preference" })`, confirm the sections stagger — record the computed `animation-delay` values across the `EntryItem`s. With `"reduce"`, confirm no `animation-name` anywhere. Record both.

This is the first time `useEntry` has a production consumer; Plan 3 proved it in a harness of its own making, and this proves it in the shell that will actually use it.

- [ ] **Step 3: Write the evidence file**

Write `docs/counter/shell-verification.md` with the observations from Steps 1 and 2, including the measured delays and the screenshot paths. State plainly anything that looked wrong — a finding here is worth more than a clean report.

- [ ] **Step 4: Delete the harness**

Remove the temporary route and confirm `git diff` shows no trace of it.

- [ ] **Step 5: Document the shell in DESIGN.md**

Add a Shell section covering: the seventeen destinations and why seventeen (note 24); that a destination stays lit for its children because the route is the hierarchy (note 48); that `aria-current="page"` and not colour is what announces the current destination; and that `EntryItem` exists because `Section` is a server component and must stay one.

- [ ] **Step 6: Run the full gate**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add DESIGN.md docs/counter/shell-verification.md
git commit -m "docs(counter): the shell, seen and recorded"
```

---

## Done when

- `theme-provider` no longer reads client-only state during render, and a test proves it
- Seventeen destinations in five groups, declared once, with a route each
- The rail renders them, marks exactly one current, and keeps a parent lit on a detail route
- `AppShell` frames a page, offers a skip link, and owns the entry index
- `docs/counter/shell-verification.md` records what the shell actually looks like, in both themes, with measured entry delays
- Full gate green

## Next plan

Plan 5 — the controls: `Topbar`, `StoreSwitcher`, and `DateControl` (12 presets,
4 comparison modes, steppers). Carry forward: the DateControl must not offer the
`weekday` comparison when the range exceeds 7 days (`comparisonRange` returns
`null` there), must pass a midnight-normalised `today`, and its popover is 438px
wide — wider than a phone — so it must measure its own frame and flip rather
than overflow (note 21). Then the ⌘K `AskSurface`, whose first consumer is the
`data-ask-about` attribute `Section` already emits.
