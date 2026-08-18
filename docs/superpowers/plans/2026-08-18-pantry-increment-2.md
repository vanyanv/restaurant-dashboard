# Pantry Increment 2 — Clear the Fold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the spend-ranked ledger on the first screen by collapsing the review inbox to a one-line bar and moving the auto-match decision log off the owner's pantry to the DEVELOPER-only audit page.

**Architecture:** Two admin surfaces currently sit above the ledger and own ~750px of a 900px viewport. The review inbox (`review-inbox.tsx`) keeps its cards but starts collapsed behind a hairline summary bar that carries the `#review` anchor and auto-expands when linked to. The auto-match strip (`auto-match-activity.tsx`, 274 lines of scores, candidates and model reasoning) moves wholesale to `admin/monitoring/ingredient-audit`, and the pantry keeps only a slim notice that renders when the ladder actually **linked** something — never for SHADOW proposals — expanding to a minimal row list with Undo. Summary logic is pure and lives in `src/lib/pantry-attention.ts` so it can be tested without a DOM.

**Tech Stack:** Next.js 16 App Router (server sections + client components), React 19, Vitest, Tailwind v4 with the editorial tokens, `lucide-react` icons.

**Spec:** [`docs/superpowers/specs/2026-08-17-pantry-ledger-design.md`](../specs/2026-08-17-pantry-ledger-design.md) — increment 2 in the scope table. Increment 1's plan and its closure record: [`2026-08-17-pantry-ledger.md`](2026-08-17-pantry-ledger.md).

## Increment 2 decisions (user, 2026-08-18)

1. **The pantry keeps a one-line "linked" notice, not the full log.** Scores, candidates, margins and model reasoning move to the audit page. The pantry shows `N linked this week` with an expander to the rows and their Undo. **In SHADOW mode it renders nothing at all** — a proposal that changed no data is not news for an owner.
2. **The review inbox becomes a slim bar above the ledger**, expanding in place. Not below the ledger: a queue you have to scroll 45 rows to reach stops getting worked.
3. Everything increment 1 shipped stays exactly as it is. This increment moves and collapses; it deletes no capability.

## Global Constraints

Copied from the spec and `CLAUDE.md`; every task inherits these.

- **Editorial tokens only** on `/dashboard/*`: `--ink`, `--ink-muted`, `--ink-faint`, `--paper`, `--paper-deep`, `--hairline`, `--hairline-bold`, `--accent`, `--accent-dark`, `--accent-bg`. Never `bg-sky-*`, `text-emerald-*`, and so on.
- **Two-tier typography.** Fraunces italic (`font-display`) for prose and display titles only. Numbers render in DM Sans 500–600 with tabular lining numerals. Captions, folios, SKUs and status labels use JetBrains Mono (`font-mono`), uppercase, tracked.
- **Red means money moving against you** and nothing else. The review bar's dollar total is ink, not red; the pulsing `--accent-dark` dot stays as the queue's marker because it means "unreviewed", which is the one other thing the page already uses it for.
- **`listCanonicalIngredients()` is not modified.** Mobile (`src/app/(mobile)/m/ingredients/page.tsx`) and two recipe surfaces consume it.
- **Whole-project gate:** `npm test && npx tsc --noEmit && npm run build`. There is no ESLint in this repo and `next lint` was removed in Next 16.
- **Do not restructure `ingredient-audit-client.tsx` (792 lines).** Tripwire #5 applies. This plan adds a sibling component to that route; it does not split the client.
- **No `"use server"` on re-export shims** — it breaks Next.js re-exports.

---

### Task 1: Attention summaries and a shared money formatter

Pure functions first, so the two UI tasks have something tested to render. `formatMoney` is lifted out of `pantry-ledger.tsx`, where it is currently a file-local `money` const, so the new bar and the ledger cannot drift apart on rounding.

**Files:**
- Create: `src/lib/pantry-attention.ts`
- Create: `tests/lib/pantry-attention.test.ts`
- Modify: `src/lib/pantry-format.ts` — add `formatMoney`
- Modify: `tests/lib/pantry-format.test.ts` — cover `formatMoney`
- Modify: `src/app/dashboard/ingredients/components/ledger/pantry-ledger.tsx:26-27` — delete the local `money` and import `formatMoney`

**Interfaces:**
- Consumes: `UnmatchedLineItemGroup` from `@/app/actions/ingredient-match-actions`, `RecentAutoMatch` from `@/app/actions/ingredient-auto-match-actions`.
- Produces:
  - `formatMoney(n: number): string` in `@/lib/pantry-format`
  - `summarizeReviewQueue(groups: ReviewQueueInput[]): ReviewQueueSummary`
  - `summarizeAutoMatchNotice(decisions: AutoMatchNoticeInput[]): AutoMatchNoticeSummary`
  - types `ReviewQueueInput`, `ReviewQueueSummary`, `AutoMatchNoticeInput`, `AutoMatchNoticeSummary`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/pantry-attention.test.ts`:

```ts
// The collapsed bars are the only thing an owner sees of these two queues on
// first paint, so their headline numbers are the contract. SHADOW decisions
// are deliberately invisible: the ladder proposed a link and wrote nothing,
// which is a developer's business, not the owner's.

import { describe, it, expect } from "vitest"
import {
  summarizeReviewQueue,
  summarizeAutoMatchNotice,
} from "@/lib/pantry-attention"

const group = (over: Partial<{ vendorName: string; totalSpend: number }> = {}) => ({
  vendorName: "Vitco Foodservice",
  totalSpend: 100,
  ...over,
})

const decision = (
  over: Partial<{ status: "APPLIED" | "UNDONE" | "SHADOW"; linkedLineItemCount: number }> = {},
) => ({
  status: "APPLIED" as const,
  linkedLineItemCount: 3,
  ...over,
})

describe("summarizeReviewQueue", () => {
  it("counts the groups and sums their spend", () => {
    const s = summarizeReviewQueue([
      group({ totalSpend: 2972 }),
      group({ totalSpend: 891 }),
      group({ totalSpend: 270 }),
    ])
    expect(s.count).toBe(3)
    expect(s.totalSpend).toBe(4133)
  })

  it("reports an empty queue as not worth showing", () => {
    const s = summarizeReviewQueue([])
    expect(s.count).toBe(0)
    expect(s.show).toBe(false)
  })

  it("shows a queue that has any group at all, however cheap", () => {
    // A $0 group is still an unmatched invoice line. Hiding it would leave
    // items permanently unreviewable from this page.
    expect(summarizeReviewQueue([group({ totalSpend: 0 })]).show).toBe(true)
  })
})

describe("summarizeAutoMatchNotice", () => {
  it("counts only decisions that actually wrote a link", () => {
    const s = summarizeAutoMatchNotice([
      decision({ status: "APPLIED" }),
      decision({ status: "APPLIED" }),
      decision({ status: "UNDONE" }),
    ])
    expect(s.liveCount).toBe(2)
    expect(s.undoneCount).toBe(1)
    expect(s.linkedLineCount).toBe(6)
    expect(s.show).toBe(true)
  })

  it("stays silent in shadow mode", () => {
    // The whole point of SHADOW is that nothing was written. An owner has
    // nothing to undo and nothing to check.
    const s = summarizeAutoMatchNotice([
      decision({ status: "SHADOW" }),
      decision({ status: "SHADOW" }),
    ])
    expect(s.liveCount).toBe(0)
    expect(s.show).toBe(false)
  })

  it("still shows when every live decision has been undone", () => {
    // The record that the automation was corrected here is the point of the
    // row; it is also what suppresses a re-link.
    const s = summarizeAutoMatchNotice([decision({ status: "UNDONE" })])
    expect(s.liveCount).toBe(0)
    expect(s.undoneCount).toBe(1)
    expect(s.show).toBe(true)
  })

  it("reports nothing to show on an empty week", () => {
    expect(summarizeAutoMatchNotice([]).show).toBe(false)
  })
})
```

Append to `tests/lib/pantry-format.test.ts`:

```ts
describe("formatMoney", () => {
  it("renders whole dollars with thousands separators", () => {
    expect(formatMoney(175226)).toBe("$175,226")
    expect(formatMoney(4133)).toBe("$4,133")
    expect(formatMoney(0)).toBe("$0")
  })

  it("rounds to the dollar rather than showing cents", () => {
    // Ledger totals are for scale, not reconciliation; cents on a $57k figure
    // are noise, and the invoice page is where exact math lives.
    expect(formatMoney(57695.62)).toBe("$57,696")
  })
})
```

Add `formatMoney` to that file's existing import from `@/lib/pantry-format`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/pantry-attention.test.ts tests/lib/pantry-format.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/pantry-attention"` and `formatMoney is not a function`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/pantry-attention.ts`:

```ts
/**
 * Summaries for the two attention queues that sit above the pantry ledger.
 *
 * Both queues used to render in full on first paint and together owned ~750px
 * of a 900px viewport, which is why the ledger — the reason the page exists —
 * started below the fold. These summaries are what the collapsed bars show.
 *
 * Kept free of React so the counting rules (what SHADOW means, what an undone
 * decision still owes the reader) are testable on their own.
 */

export type ReviewQueueInput = {
  totalSpend: number
}

export type ReviewQueueSummary = {
  count: number
  totalSpend: number
  /** False only for an empty queue — any group at all is worth a bar. */
  show: boolean
}

export function summarizeReviewQueue(groups: ReviewQueueInput[]): ReviewQueueSummary {
  const totalSpend = groups.reduce((sum, g) => sum + g.totalSpend, 0)
  return { count: groups.length, totalSpend, show: groups.length > 0 }
}

export type AutoMatchNoticeInput = {
  status: "APPLIED" | "UNDONE" | "SHADOW"
  linkedLineItemCount: number
}

export type AutoMatchNoticeSummary = {
  /** Decisions that wrote a link and still stand. */
  liveCount: number
  /** Decisions that wrote a link and were reversed. Still shown: the row is
   *  the record of the correction, and it suppresses a re-link. */
  undoneCount: number
  /** Invoice lines touched by the standing links. */
  linkedLineCount: number
  show: boolean
}

export function summarizeAutoMatchNotice(
  decisions: AutoMatchNoticeInput[]
): AutoMatchNoticeSummary {
  let liveCount = 0
  let undoneCount = 0
  let linkedLineCount = 0

  for (const d of decisions) {
    // SHADOW wrote nothing. There is no link to inspect and nothing to undo,
    // so it never reaches the owner's pantry — it lives on the audit page.
    if (d.status === "APPLIED") {
      liveCount += 1
      linkedLineCount += d.linkedLineItemCount
    } else if (d.status === "UNDONE") {
      undoneCount += 1
    }
  }

  return {
    liveCount,
    undoneCount,
    linkedLineCount,
    show: liveCount + undoneCount > 0,
  }
}
```

Append to `src/lib/pantry-format.ts`:

```ts
/** Whole-dollar money for ledger totals and queue headlines. Lifted out of
 *  `pantry-ledger.tsx` so every pantry surface rounds the same way. */
export function formatMoney(n: number): string {
  return (
    "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  )
}
```

In `src/app/dashboard/ingredients/components/ledger/pantry-ledger.tsx`, delete lines 26–27:

```ts
const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })
```

and import the shared one instead, extending the existing `@/lib/pantry-format` import if the file already has one:

```ts
import { formatMoney } from "@/lib/pantry-format"
```

Then rename every `money(` call site in that file to `formatMoney(` — there are five, at lines ~89, 104, 109, 114 and 198 (the last is the hidden-remainder line). `grep -c "money(" src/app/dashboard/ingredients/components/ledger/pantry-ledger.tsx` should report `0` when you are done.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/pantry-attention.test.ts tests/lib/pantry-format.test.ts && npx tsc --noEmit`
Expected: both PASS, typecheck clean. `tsc` is what catches a missed `money(` call site.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pantry-attention.ts src/lib/pantry-format.ts tests/lib/pantry-attention.test.ts tests/lib/pantry-format.test.ts src/app/dashboard/ingredients/components/ledger/pantry-ledger.tsx
git commit -m "feat(pantry): summarize the review and auto-match queues, share the money formatter"
```

---

### Task 2: Collapse the review inbox to a bar

The cards, the `MatchPickerSheet` wiring and the `onMatched`/`onCanonicalCreated` callbacks are unchanged — only their default visibility moves. The `#review` anchor is load-bearing: `src/components/app-sidebar.tsx:117` links to `/dashboard/ingredients#review`, and a bar that stayed collapsed when linked to would be a regression on a link that already had one bug (it used to point at a `?tab=review` param nothing read).

**Files:**
- Modify: `src/app/dashboard/ingredients/components/review-inbox.tsx` — collapsed bar, expand state, hash auto-expand
- Test: none. There is no component test harness in this repo; the pantry's UI contract is held by `tsc`, the build, and the browser pass in Task 5.

**Interfaces:**
- Consumes: `summarizeReviewQueue`, `formatMoney` from Task 1.
- Produces: no exported API change. `ReviewInbox` keeps its current props exactly.

- [ ] **Step 1: Add the collapsed bar**

Replace the component body's header/list region in `src/app/dashboard/ingredients/components/review-inbox.tsx`. Keep `ReviewCard` and the `MatchPickerSheet` block as they are.

```tsx
"use client"

import { useEffect, useState } from "react"
import { ArrowRight, ChevronDown, Receipt, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { summarizeReviewQueue } from "@/lib/pantry-attention"
import { formatMoney } from "@/lib/pantry-format"
import { prettifyIngredientName } from "../../recipes/components/ingredient-picker-utils"
import { MatchPickerSheet } from "./match-picker-sheet"
import type { UnmatchedLineItemGroup } from "@/app/actions/ingredient-match-actions"
import type { CanonicalIngredientSummary } from "@/types/recipe"

type Props = {
  groups: UnmatchedLineItemGroup[]
  canonicals: CanonicalIngredientSummary[]
  onMatched: (key: string, newCanonicalId: string) => void
  onCanonicalCreated: (created: CanonicalIngredientSummary) => void
}

const INITIAL_VISIBLE = 4

export function ReviewInbox({
  groups,
  canonicals,
  onMatched,
  onCanonicalCreated,
}: Props) {
  // Collapsed by default: this queue is 31 groups worth $4,133 against a
  // ledger that reports $175,226. It is a chore, not the headline, and it used
  // to push every ingredient below the fold.
  const [expanded, setExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // The sidebar's "Needs review" link is /dashboard/ingredients#review. Landing
  // on a collapsed bar would make that link look broken.
  useEffect(() => {
    if (window.location.hash === "#review") setExpanded(true)
  }, [])

  const summary = summarizeReviewQueue(groups)
  if (!summary.show) return null

  const visible = showAll ? groups : groups.slice(0, INITIAL_VISIBLE)
  const overflow = groups.length - INITIAL_VISIBLE
  const activeGroup =
    activeKey != null ? groups.find((g) => g.key === activeKey) ?? null : null

  return (
    <section
      id="review"
      className="scroll-mt-16 border-b border-[var(--hairline-bold)] bg-[var(--paper)]/60"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-8 py-3">
        <span
          className="inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent-dark)]"
          aria-hidden
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--accent-dark)]">
          § needs your review
        </span>
        <span className="text-[13px] font-medium tabular-nums text-[var(--ink)]">
          {summary.count} new {summary.count === 1 ? "item" : "items"} on your invoices
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
          {formatMoney(summary.totalSpend)}
        </span>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="review-queue"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
        >
          <ChevronDown className={cn("h-3 w-3 transition", expanded && "rotate-180")} />
          {expanded ? "Hide" : "Review"}
        </button>
      </div>

      {expanded && (
        <div
          id="review-queue"
          className="border-t border-dashed border-[var(--accent-dark)]/25 px-8 pb-6 pt-4"
          style={{
            background:
              "linear-gradient(180deg, rgba(252, 236, 236, 0.5) 0%, rgba(252, 236, 236, 0.1) 100%)",
          }}
        >
          <p className="max-w-xl font-mono text-[10px] leading-relaxed text-[var(--ink-muted)]">
            Match each to an existing pantry ingredient or create a new one.
            Matching once teaches the system — future invoices for the same
            vendor + SKU will auto-link.
          </p>

          <ul className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            {visible.map((g) => (
              <ReviewCard key={g.key} group={g} onOpen={() => setActiveKey(g.key)} />
            ))}
          </ul>

          {overflow > 0 && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
              >
                <ChevronDown className={cn("h-3 w-3 transition", showAll && "rotate-180")} />
                {showAll ? "Collapse" : `Show ${overflow} more`}
              </button>
            </div>
          )}
        </div>
      )}

      <MatchPickerSheet
        open={activeGroup != null}
        onOpenChange={(o) => {
          if (!o) setActiveKey(null)
        }}
        group={activeGroup}
        canonicals={canonicals}
        onMatched={onMatched}
        onCanonicalCreated={onCanonicalCreated}
      />
    </section>
  )
}
```

The `h2` display title is gone on purpose: a Fraunces italic headline is a claim on the reader's attention, and the collapsed state is explicitly not making that claim. The count now renders in DM Sans tabular per tripwire #2.

- [ ] **Step 2: Verify the anchor and the a11y wiring by reading the diff**

Confirm all four hold before moving on:
1. `id="review"` is still on the outermost `<section>`.
2. The expander is a real `<button>` with `aria-expanded` and `aria-controls="review-queue"`, and the expanded region carries `id="review-queue"`.
3. `useEffect` reads `window.location.hash` — not `useSearchParams`, which never sees a fragment.
4. No `bg-*`/`text-*` Tailwind palette colors were introduced.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/ingredients/components/review-inbox.tsx
git commit -m "feat(pantry): collapse the review inbox to a bar that expands in place"
```

---

### Task 3: Move the decision log to the audit page

`auto-match-activity.tsx` is the ladder's receipt: layer, confidence, margin, scored runner-ups, model reasoning, per-row undo. That is diagnostic work, and `admin/monitoring/ingredient-audit` is already the DEVELOPER-only room for it. The component moves as-is — no rewrite — and the window widens from 7 days to 30, because on the audit page you are looking back at a rollout rather than at this week.

**Files:**
- Move: `src/app/dashboard/ingredients/components/auto-match-activity.tsx` → `src/app/dashboard/admin/monitoring/ingredient-audit/components/auto-match-log.tsx` (via `git mv`, so history follows)
- Modify: the moved file — rename the export to `AutoMatchLog`, fix the two relative imports
- Modify: `src/app/dashboard/admin/monitoring/ingredient-audit/page.tsx` — load and render it above the audit table
- Delete: `src/app/dashboard/ingredients/components/sections/auto-match-section.tsx`
- Modify: `src/app/dashboard/ingredients/components/ingredients-shell.tsx` — drop the `AutoMatchSection` block and its comment

**Interfaces:**
- Consumes: `listRecentAutoMatches(days, opts?)` and `undoAutoMatch` from `@/app/actions/ingredient-auto-match-actions` (unchanged).
- Produces: `AutoMatchLog({ decisions, days }: { decisions: RecentAutoMatch[]; days: number })`.

- [ ] **Step 1: Move the file**

```bash
mkdir -p src/app/dashboard/admin/monitoring/ingredient-audit/components
git mv src/app/dashboard/ingredients/components/auto-match-activity.tsx \
       src/app/dashboard/admin/monitoring/ingredient-audit/components/auto-match-log.tsx
```

- [ ] **Step 2: Fix the moved file's exports and imports**

In `auto-match-log.tsx`:

```tsx
export function AutoMatchLog({ decisions, days }: Props) {
```

The two relative imports break at the new depth. Replace them with the aliased paths:

```tsx
import { prettifyIngredientName } from "@/app/dashboard/recipes/components/ingredient-picker-utils"
import { undoAutoMatch } from "@/app/actions/ingredient-auto-match-actions"
```

Everything else in the file — `INITIAL_VISIBLE`, `LAYER_LABEL`, the undo transition, the expandable candidate list — stays untouched.

- [ ] **Step 3: Render it on the audit page**

Rewrite `src/app/dashboard/admin/monitoring/ingredient-audit/page.tsx`:

```tsx
import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getIngredientAuditRows } from "@/lib/monitoring/ingredient-audit"
import { listRecentAutoMatches } from "@/app/actions/ingredient-auto-match-actions"
import { IngredientAuditClient } from "./ingredient-audit-client"
import { AutoMatchLog } from "./components/auto-match-log"

export const dynamic = "force-dynamic"

// The decision log used to sit on the owner's pantry, where its scores,
// margins and model reasoning were 356px of diagnostics above the ledger.
// Thirty days rather than seven: here you are reading a rollout, not a week.
const LOG_WINDOW_DAYS = 30

export default async function IngredientAuditPage() {
  const session = await getServerSession(authOptions)
  if (session?.user.role !== "DEVELOPER") notFound()

  const [rows, decisions] = await Promise.all([
    getIngredientAuditRows(session.user.accountId),
    listRecentAutoMatches(LOG_WINDOW_DAYS),
  ])

  return (
    <>
      <AutoMatchLog decisions={decisions} days={LOG_WINDOW_DAYS} />
      <IngredientAuditClient rows={rows} />
    </>
  )
}
```

`listRecentAutoMatches` keeps its default (SHADOW included) here — on the audit page shadow proposals are the entire point of a shadow rollout.

- [ ] **Step 4: Remove the strip from the pantry shell**

```bash
git rm src/app/dashboard/ingredients/components/sections/auto-match-section.tsx
```

In `src/app/dashboard/ingredients/components/ingredients-shell.tsx`, delete the `AutoMatchSection` import and this whole block, comment included:

```tsx
      {/* Above the review inbox (which lives inside PantrySection): what the
          automation already decided comes before what it is asking you to
          decide. Its own boundary so a decision-log failure never takes the
          pantry down with it. */}
      <SectionErrorBoundary label="Auto-match activity unavailable">
        <Suspense fallback={null}>
          <AutoMatchSection />
        </Suspense>
      </SectionErrorBoundary>
```

Task 4 puts a replacement block back in this exact position, so leave the surrounding structure alone.

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: both PASS. `tsc` catches any straggling import of the moved file.

- [ ] **Step 6: Commit**

```bash
git add -A src/app/dashboard/ingredients src/app/dashboard/admin/monitoring/ingredient-audit
git commit -m "refactor(pantry): move the auto-match decision log to the developer audit page"
```

---

### Task 4: A slim auto-match notice for the owner

The pantry keeps the one thing an owner needs from the ladder: it linked something without asking, here is what, undo it. Nothing renders while auto-match is in SHADOW — which is prod's current mode — so today this task returns the last ~356px to the ledger and pays off later, when the flag flips to `on`.

**Files:**
- Create: `src/app/dashboard/ingredients/components/auto-match-notice.tsx`
- Create: `src/app/dashboard/ingredients/components/sections/auto-match-notice-section.tsx`
- Modify: `src/app/dashboard/ingredients/components/ingredients-shell.tsx` — render the new section where `AutoMatchSection` was

**Interfaces:**
- Consumes: `summarizeAutoMatchNotice` (Task 1), `listRecentAutoMatches(7, { excludeShadow: true })`, `undoAutoMatch`, `RecentAutoMatch`.
- Produces: `AutoMatchNotice({ decisions, days })`, `AutoMatchNoticeSection()`.

- [ ] **Step 1: Build the notice**

Create `src/app/dashboard/ingredients/components/auto-match-notice.tsx`:

```tsx
"use client"

// What the ladder linked without asking, and how to take it back.
//
// This is the owner's half of the auto-match surface; the diagnostic half —
// confidence, margin, scored runner-ups, model reasoning — lives on
// /dashboard/admin/monitoring/ingredient-audit. The split is deliberate: an
// owner's question is "what did it change to my pantry", and answering that
// with a scoring table is why the ledger used to start below the fold.
//
// Renders nothing in SHADOW mode. A proposal that wrote no data is not news.

import { useState, useTransition } from "react"
import { ChevronDown, Undo2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { summarizeAutoMatchNotice } from "@/lib/pantry-attention"
import { prettifyIngredientName } from "../../recipes/components/ingredient-picker-utils"
import { undoAutoMatch } from "@/app/actions/ingredient-auto-match-actions"
import type { RecentAutoMatch } from "@/app/actions/ingredient-auto-match-actions"

type Props = {
  decisions: RecentAutoMatch[]
  days: number
}

export function AutoMatchNotice({ decisions, days }: Props) {
  const [expanded, setExpanded] = useState(false)
  // An undone row stays in place: it is the record that the automation was
  // corrected here, and it is what stops the ladder re-proposing the pairing.
  const [undoneIds, setUndoneIds] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  const summary = summarizeAutoMatchNotice(decisions)
  if (!summary.show) return null

  return (
    <section className="border-b border-[var(--hairline-bold)] bg-[var(--paper-deep)]/30">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-8 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-faint)]">
          § matched automatically
        </span>
        <span className="text-[13px] font-medium tabular-nums text-[var(--ink)]">
          {summary.liveCount} {summary.liveCount === 1 ? "item" : "items"} linked
          without you
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
          {summary.linkedLineCount} invoice{" "}
          {summary.linkedLineCount === 1 ? "line" : "lines"} · last {days} days
          {summary.undoneCount > 0 ? ` · ${summary.undoneCount} undone` : ""}
        </span>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="auto-match-notice"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--ink)] hover:text-[var(--ink)]"
        >
          <ChevronDown className={cn("h-3 w-3 transition", expanded && "rotate-180")} />
          {expanded ? "Hide" : "Review"}
        </button>
      </div>

      {expanded && (
        <ul
          id="auto-match-notice"
          className="border-t border-[var(--hairline)] px-8 py-3"
        >
          {decisions.map((d) => {
            const undone = d.status === "UNDONE" || undoneIds.has(d.id)
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-dashed border-[var(--hairline)] py-2 last:border-b-0"
              >
                <span
                  className={cn(
                    "text-[13px] text-[var(--ink)]",
                    undone && "text-[var(--ink-faint)] line-through"
                  )}
                >
                  {prettifyIngredientName(d.productName)}
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--ink-faint)]">
                  → {prettifyIngredientName(d.canonicalIngredientName ?? "—")} ·{" "}
                  {d.linkedLineItemCount}{" "}
                  {d.linkedLineItemCount === 1 ? "line" : "lines"}
                </span>

                {undone ? (
                  <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-faint)]">
                    Undone
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await undoAutoMatch(d.id)
                        setUndoneIds((prev) => new Set(prev).add(d.id))
                      })
                    }
                    className="ml-auto inline-flex items-center gap-1.5 border border-[var(--hairline-bold)] bg-[var(--paper)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--ink-muted)] transition hover:border-[var(--accent-dark)] hover:text-[var(--accent-dark)] disabled:opacity-50"
                  >
                    <Undo2 className="h-2.5 w-2.5" />
                    Undo
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
```

Check `undoAutoMatch`'s signature in `src/app/actions/ingredient-auto-match-actions.ts` before writing the handler and match it — it returns an `UndoAutoMatchResult`, and the moved `auto-match-log.tsx` is the reference for how the old strip called it.

- [ ] **Step 2: Build the server section**

Create `src/app/dashboard/ingredients/components/sections/auto-match-notice-section.tsx`:

```tsx
import { listRecentAutoMatches } from "@/app/actions/ingredient-auto-match-actions"
import { AutoMatchNotice } from "../auto-match-notice"

const WINDOW_DAYS = 7

/**
 * Server section for the owner-facing auto-match notice.
 *
 * `excludeShadow: true` is the whole difference from the audit page's log: a
 * SHADOW decision changed nothing, so it has nothing to say to an owner. While
 * `INGREDIENT_AUTO_MATCH` is in shadow — prod's current mode — this renders
 * nothing and the ledger starts at the top of the page.
 */
export async function AutoMatchNoticeSection() {
  const decisions = await listRecentAutoMatches(WINDOW_DAYS, { excludeShadow: true })
  return <AutoMatchNotice decisions={decisions} days={WINDOW_DAYS} />
}
```

- [ ] **Step 3: Wire it into the shell**

In `src/app/dashboard/ingredients/components/ingredients-shell.tsx`, import `AutoMatchNoticeSection` and put this where the old `AutoMatchSection` block was:

```tsx
      {/* What the automation already changed comes before what it is asking
          you to decide. One line unless there is something to undo, and
          nothing at all while auto-match is in shadow. Its own boundary so a
          decision-log failure never takes the pantry down with it. */}
      <SectionErrorBoundary label="Auto-match activity unavailable">
        <Suspense fallback={null}>
          <AutoMatchNoticeSection />
        </Suspense>
      </SectionErrorBoundary>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/ingredients
git commit -m "feat(pantry): keep a one-line auto-match notice with undo on the pantry"
```

---

### Task 5: Gate, measure the fold, verify

The point of this increment is a measurement, so take it rather than assuming it.

**Files:** none — verification only, then the plan's closure record.

- [ ] **Step 1: Full gate**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all PASS. `npm test` should still report 967+ passing with the new `pantry-attention` cases added.

- [ ] **Step 2: Measure the fold**

Start the dev server with `SERVICE_SHUTDOWN_AT=""`, sign in as `demo@restaurantos.com` (credentials in `.env.test.local`), open `/dashboard/ingredients` at 1440×900, and measure where the ledger begins:

```js
document.querySelector('[class*="pl-summary"]').getBoundingClientRect().top
```

Expected: under 150px (it was ~760px before this increment). Record the number in the closure section — that figure is what this increment bought.

- [ ] **Step 3: Verify behaviour in the browser**

1. The review bar reads `14 new items on your invoices · $4,133` and is collapsed.
2. Clicking `Review` expands the cards in place; `Match` still opens the picker sheet; matching an item removes its card and refreshes the ledger.
3. Loading `/dashboard/ingredients#review` directly lands with the queue **already expanded**.
4. The auto-match strip is gone from the pantry (prod is in SHADOW, so the notice renders nothing — confirm no empty bordered bar is left behind).
5. `/dashboard/admin/monitoring/ingredient-audit` shows the decision log above the audit table, still with scores, candidates and per-row undo, over a 30-day window.
6. As a non-DEVELOPER user the audit page still 404s.
7. `/m/ingredients` is unaffected.

- [ ] **Step 4: Record and commit**

Append a closure section to this plan in the same shape as increment 1's (gate results, a verification table, the measured fold number, anything deliberately deferred), then:

```bash
git add docs/superpowers/plans/2026-08-18-pantry-increment-2.md
git commit -m "docs(pantry): close increment 2 with the fold measurement and verification record"
git push origin main
```

---

## Self-review notes

- **Spec coverage:** the increment-2 row of the spec's scope table is "Collapse review inbox to a panel; move the auto-match decision log to `admin/monitoring/ingredient-audit` (already DEVELOPER-only) — moves, no delete." Task 2 collapses; Task 3 moves; Task 4 is the addition the user chose so that "moves, no delete" stays true for the owner's ability to undo a live link; Task 5 proves it.
- **Deliberately unchanged:** the Ledger/Cards toggle, the `?open=` deep link into the tile grid, `listCanonicalIngredients()`, the modifier drawer, and every loader increment 1 added.
- **Known risk:** Task 4's notice is unexercisable today. `INGREDIENT_AUTO_MATCH` is unset locally and SHADOW in prod, so `excludeShadow: true` returns an empty list and the component returns null on every surface you can reach. Its first real render will be the day the flag flips. Mitigation: verify it by temporarily flipping one `IngredientMatchDecision` row to `APPLIED` in a local database, or by rendering the component with a fixture in a scratch route — do not ship either.
- **Not addressed here:** `Fuel Surcharge` is still an ingredient, ingredient display names are still raw vendor strings, and `/dashboard/ingredients/prices` still renders the same 76 rows a second time. That last one is increment 3, which is the only increment that deletes and should wait until the ledger has been used in anger.
