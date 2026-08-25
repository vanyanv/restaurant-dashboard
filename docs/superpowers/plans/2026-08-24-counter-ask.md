# Counter Ask Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ⌘K open something. Build the Ask surface that says what it is answering about *before* you type, and wire the fifty section heads that have been offering to answer a question and couldn't.

**Architecture:** One client component mounted once in `AppShell`, opened by ⌘K or by any `data-ask-about` button anywhere on the page via event delegation — so a `Section` needs no wiring and stays a server component. It derives its context (page, store, range) from the route and search params rather than being told, so the context can never disagree with what the reader is looking at.

**Tech Stack:** React 19, Next.js 16 App Router, TypeScript 7, Tailwind v4 `ct-` utilities, Vitest 4 + Testing Library, Playwright.

**Spec:** [`docs/superpowers/specs/2026-08-23-counter-design-system-design.md`](../specs/2026-08-23-counter-design-system-design.md)

**The three notes this plan closes:**
- **Note 46** — "Two surfaces promised ⌘K and nothing opened." The topbar button and the Overview ask bar both printed the shortcut, the palette was fully designed, and it was mounted nowhere. Fourteen rules of dead CSS behind an advertised shortcut, which is worse than never mentioning it.
- **Note 55** — "Fifty section heads offered to answer a question and none of them could." The same defect, fifty times over. The fix was to make the button carry its own question — which `Section` already does, emitting `data-ask-about`. This plan builds its first consumer.
- **Note 43** — Ask is the longest-held page in the product (3m 31s median against 1m 12s on Overview) and was the only one of the forty-five with no states, no store and no range. It answered for a store you were not looking at.

## Global Constraints

- Branch `dashboardv2`. Never rebase, merge or push.
- Gate: `npm test && npm run tokens && npx tsc --noEmit && npm run build`. Baseline **187 files, 2037 passed | 8 skipped**. The 8 skips are deliberate inherited defects — never touch them.
- No ESLint. No `Co-Authored-By: Claude` line. **Never `prisma migrate dev`.**
- Colour ONLY via `ct-` utilities or `"var(--ct-…)"`. Radii `rounded-ct` / `rounded-ct-sm` only.
- `framer-motion` only under `src/components/counter/motion/`.
- **Use the existing OpenAI integration.** `src/lib/chat/` and `src/app/api/chat/route.ts` already exist and work. Do NOT introduce a second provider or a parallel chat stack.
- Component tests are `.tsx` with `// @vitest-environment jsdom` first line. Under React 19 + RTL 16, use `fireEvent` for anything whose assertion depends on a state update — raw `.click()` does not commit before the next line.
- Do not touch untracked files you did not create. Do not commit `.next/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/counter/ask-context.ts` | What a question is about, derived from route + params |
| `src/components/counter/ask/ask-surface.tsx` | The ⌘K overlay |
| `src/components/counter/shell/app-shell.tsx` | Modified: mount it once |
| `src/components/counter/index.ts` | Modified: export it |
| `DESIGN.md` | Modified: an Ask section |

---

### Task 1: What a question is about

Note 43's defect was that Ask had no store and no range, so it answered for a store you were not looking at. Deriving the context rather than passing it means it cannot drift.

**Files:**
- Create: `src/lib/counter/ask-context.ts`
- Test: `tests/lib/counter/ask-context.test.ts`

**Interfaces:**
- Consumes: `NAV_GROUPS`, `isActive` from `@/lib/counter/nav`; `PRESETS` from `@/lib/counter/date-range`.
- Produces: `describeAskContext({ pathname, params, storeName, today })`, `type AskContext`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { describeAskContext } from "@/lib/counter/ask-context"

const TODAY = new Date(2026, 7, 24)
const base = { params: new URLSearchParams(), storeName: null, today: TODAY }

describe("describeAskContext", () => {
  it("names the page from the route, not from a caller", () => {
    expect(describeAskContext({ ...base, pathname: "/dashboard/invoices" }).page).toBe("Invoices")
  })

  it("keeps the parent's name on a detail route", () => {
    expect(describeAskContext({ ...base, pathname: "/dashboard/invoices/I28517" }).page).toBe("Invoices")
  })

  it("falls back to Dashboard on an unrecognised route rather than throwing", () => {
    expect(describeAskContext({ ...base, pathname: "/dashboard/nowhere" }).page).toBe("Dashboard")
  })

  it("names the range in the reader's words", () => {
    const c = describeAskContext({ ...base, pathname: "/dashboard", params: new URLSearchParams("range=d30") })
    expect(c.range).toBe("Last 30 days")
  })

  it("says all stores when no store is selected", () => {
    expect(describeAskContext({ ...base, pathname: "/dashboard" }).store).toBe("All stores")
  })

  it("names the selected store when one is given", () => {
    const c = describeAskContext({
      ...base, pathname: "/dashboard",
      params: new URLSearchParams("store=hollywood"), storeName: "Hollywood",
    })
    expect(c.store).toBe("Hollywood")
  })

  it("falls back to the id when the name is not known yet", () => {
    // The switcher's store list may not have loaded. Showing the id is worse
    // than showing a name and far better than showing nothing, because the
    // whole point is that the reader can see what is being answered.
    const c = describeAskContext({
      ...base, pathname: "/dashboard", params: new URLSearchParams("store=hollywood"),
    })
    expect(c.store).toBe("hollywood")
  })

  it("composes a sentence a reader can check before typing", () => {
    const c = describeAskContext({
      ...base, pathname: "/dashboard/pnl",
      params: new URLSearchParams("range=d7&store=hollywood"), storeName: "Hollywood",
    })
    expect(c.sentence).toBe("Answering about P&L · Hollywood · Last 7 days")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/counter/ask-context.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

```ts
import { PRESETS, type PresetId } from "./date-range"
import { NAV_GROUPS, isActive } from "./nav"

/**
 * What a question is about — derived, never passed.
 *
 * Note 43: Ask was the longest-held page in the product (a 3m 31s median
 * against 1m 12s on Overview) and the only one of forty-five with no states, no
 * store and no range. It answered for a store you were not looking at.
 *
 * Deriving the context from the same route and search params the page itself
 * reads means the two cannot disagree. A caller cannot pass a stale store.
 */

export interface AskContext {
  page: string
  store: string
  range: string
  /** One line the reader can check BEFORE typing — note 43's actual fix. */
  sentence: string
}

export function describeAskContext({
  pathname,
  params,
  storeName,
  today,
}: {
  pathname: string
  params: URLSearchParams
  /** The selected store's display name, if the switcher's list has loaded. */
  storeName: string | null
  today: Date
}): AskContext {
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => isActive(i, pathname))
  const page = item?.label ?? "Dashboard"

  const rawRange = params.get("range")
  const preset = PRESETS.find((p) => p.id === (rawRange as PresetId))
  // Same default as the controls: yesterday, because an owner opening the
  // dashboard in the morning wants the day that finished.
  const range = preset?.name ?? "Yesterday"

  const storeId = params.get("store")
  const store = storeId ? (storeName ?? storeId) : "All stores"

  return { page, store, range, sentence: `Answering about ${page} · ${store} · ${range}` }
}
```

Note the unused `today` parameter is deliberate — it keeps the signature stable for when a custom range needs formatting. If TypeScript complains, prefix it or use it; do not change the caller's shape.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/lib/counter/ask-context.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/counter/ask-context.ts tests/lib/counter/ask-context.test.ts
git commit -m "feat(counter): a question knows what it is about"
```

---

### Task 2: The surface

**Files:**
- Create: `src/components/counter/ask/ask-surface.tsx`
- Test: `tests/components/counter/ask/ask-surface.test.tsx`

**Interfaces:**
- Consumes: `describeAskContext`.
- Produces: `<AskSurface pathname params storeName today onSubmit? />`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AskSurface } from "@/components/counter/ask/ask-surface"

const props = {
  pathname: "/dashboard/pnl",
  params: new URLSearchParams("range=d7&store=hollywood"),
  storeName: "Hollywood",
  today: new Date(2026, 7, 24),
}

const openWith = (key: string, init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(document, { key, ...init })

describe("AskSurface", () => {
  it("is closed until asked for", () => {
    render(<AskSurface {...props} />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens on Cmd+K", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    expect(screen.getByRole("dialog", { name: /ask/i })).toBeTruthy()
  })

  it("opens on Ctrl+K too, because not every reader is on a Mac", () => {
    render(<AskSurface {...props} />)
    openWith("k", { ctrlKey: true })
    expect(screen.getByRole("dialog", { name: /ask/i })).toBeTruthy()
  })

  it("does NOT open on a bare k, which would fire while typing", () => {
    render(<AskSurface {...props} />)
    openWith("k")
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("says what it is answering about before anything is typed", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    expect(screen.getByText("Answering about P&L · Hollywood · Last 7 days")).toBeTruthy()
  })

  it("focuses the input on open, so the reader can just type", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /ask/i }))
  })

  it("closes on Escape", () => {
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("opens pre-filled when a section asks about itself", () => {
    // Note 55: the Ask about this button carries its own question, so the
    // surface does not have to guess what the reader meant.
    render(
      <>
        <button data-ask-about="Prime cost">Ask about this</button>
        <AskSurface {...props} />
      </>,
    )
    fireEvent.click(screen.getByText("Ask about this"))
    expect(screen.getByRole("dialog", { name: /ask/i })).toBeTruthy()
    expect((screen.getByRole("textbox", { name: /ask/i }) as HTMLInputElement).value)
      .toContain("Prime cost")
  })

  it("reports the question and the context it was asked in", () => {
    const onSubmit = vi.fn()
    render(<AskSurface {...props} onSubmit={onSubmit} />)
    openWith("k", { metaKey: true })
    const input = screen.getByRole("textbox", { name: /ask/i })
    fireEvent.change(input, { target: { value: "why is prime cost up" } })
    fireEvent.submit(input.closest("form")!)
    expect(onSubmit).toHaveBeenCalledWith(
      "why is prime cost up",
      expect.objectContaining({ page: "P&L", store: "Hollywood", range: "Last 7 days" }),
    )
  })

  it("prints the shortcut only where it works", () => {
    // Note 46: two surfaces printed ⌘K and nothing opened. Fourteen rules of
    // dead CSS behind an advertised shortcut is worse than never mentioning it.
    render(<AskSurface {...props} />)
    openWith("k", { metaKey: true })
    expect(screen.getByText(/esc/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/components/counter/ask/ask-surface.test.tsx`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

- `"use client"`. A `keydown` listener on `document` for `(metaKey || ctrlKey) && key === "k"`, and `Escape` to close. Prevent the browser default on the open shortcut.
- **Event delegation for `data-ask-about`:** one `click` listener on `document` that walks up from the target looking for `[data-ask-about]`, opens the surface, and pre-fills the input with the attribute's value. This is why `Section` needs no wiring and stays a server component — do NOT add a prop to `Section`.
- The dialog is `role="dialog"` with `aria-modal="true"` and an `aria-label` containing "Ask". It renders the context sentence ABOVE the input, in `font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3`.
- The input is a `<form>` with a labelled `<input>`. Submitting calls `onSubmit(question, context)`.
- A footer hint showing `Esc` to close.
- Focus the input on open. Restore focus to the previously focused element on close — a reader who pressed ⌘K mid-page should land back where they were.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/counter/ask/ask-surface.test.tsx`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/counter/ask tests/components/counter/ask
git commit -m "feat(counter): the shortcut that was advertised and mounted nowhere"
```

---

### Task 3: Mount it, and prove it in a browser

**Files:**
- Modify: `src/components/counter/shell/app-shell.tsx`
- Modify: `src/components/counter/index.ts`
- Create: `docs/counter/ask-verification.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Mount the surface once, in the shell**

Add `AskSurface` to `AppShell` so every Counter page gets it without opting in. `AppShell` already receives `pathname`; take `params`, `storeName` and `today` as optional props with sane defaults so existing callers do not break.

Export `AskSurface` from the barrel. `boundary.test.ts` walks `surface/` and `shell/` — check whether it should also walk `ask/`, and if so extend it. Report your reasoning either way.

- [ ] **Step 2: Prove ⌘K actually opens it**

This is note 46's entire point: the shortcut was advertised and mounted nowhere. A unit test proves the handler runs; only a browser proves it is mounted on a real page.

Harness route, `npm run dev`, Playwright. Press `Meta+k` and `Control+k`. Confirm the dialog appears. Press `Escape`, confirm it closes and focus returns to where it was. Report what you pressed and what happened.

- [ ] **Step 3: Prove a section's button opens it pre-filled**

Render a `Section` with `askAbout` inside the harness. Click its "Ask about this" button. Confirm the surface opens with the section's title in the input. **This is the first time note 55's fifty dead buttons do anything** — verify it end to end rather than trusting the delegation test.

- [ ] **Step 4: Prove the context line is right**

Navigate to a pathname with a store and range in the URL. Open the surface. Confirm the sentence names the page, the store and the range actually in effect. Change the range, reopen, confirm the sentence changed with it. Report both sentences.

- [ ] **Step 5: Both themes, zero console errors**

Screenshot the open surface in light and dark. Report the console-error count for each.

- [ ] **Step 6: Write `docs/counter/ask-verification.md`**, delete the harness, confirm `git diff` is clean of it.

- [ ] **Step 7: Document in DESIGN.md**

An Ask section: ⌘K opens it anywhere; it says what it is answering about before you type, derived from the route and params so it cannot disagree with the page; a section's "Ask about this" carries its own question via `data-ask-about` and reaches the surface by delegation, which is why `Section` needs no wiring and stays a server component.

- [ ] **Step 8: Run the full gate**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
```

- [ ] **Step 9: Commit**

```bash
git add src/components/counter DESIGN.md docs/counter/ask-verification.md tests
git commit -m "feat(counter): fifty dead buttons start working"
```

---

## Done when

- ⌘K and Ctrl+K open the surface on a real page, proven in a browser
- A `Section`'s "Ask about this" opens it pre-filled, by delegation, with no prop on `Section`
- The context sentence names the page, store and range actually in effect, and changes when they do
- Escape closes it and restores focus
- `docs/counter/ask-verification.md` records it
- Full gate green

## Next plan

Plan 7 — **Overview**: the first real page. It composes `AppShell` + `Topbar` +
the controls + `Section`/`Strip`/`Figure`/`Chart`/`Table` over real data from the
existing actions, in all six states, on desk and phone. Carry forward: the
`SectionData` adapters land in `src/lib/counter/adapters/`; `no-status-branch`
already exempts `src/lib/counter/**` so an adapter may branch on HTTP status; and
`useCountUp` restarts from 0 on a value change, which the DateControl will
trigger constantly — decide there whether a change should animate from the
previous display.
