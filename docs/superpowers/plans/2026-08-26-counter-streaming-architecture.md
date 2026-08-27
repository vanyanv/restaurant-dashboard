# Counter — Streaming Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make every Counter route navigate without remounting the chrome, paint before its data resolves, and stream each section independently — and make the `SectionData.loading` state reachable for the first time.

**Architecture:** The shell moves from four page clients into two layouts. Each route gains a loading boundary. Sections move behind their own Suspense boundaries fed by promises rather than awaited values.

**Spec:** `docs/superpowers/specs/2026-08-26-counter-streaming-architecture-design.md`

**Tech Stack:** Next.js 16.3.2 (App Router), React 19.2.8, `reactCompiler: true`.

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

- **`npm run fidelity` must pass at the end of EVERY task, not only at the end of the plan.** Four surfaces are gated and green today. This plan is a large structural change to gated pages; the gate is the only thing standing between it and silent visual drift.
- **No figure changes.** This plan moves no money. If a number on screen changes, the task is wrong.
- `npm run tokens` enforces on `src/app/dashboard/**`, `src/app/(mobile)/m/**`, `src/components/counter/**`, `src/lib/counter/**`: no colour literal outside `src/styles/counter.css`, no generic Tailwind palette colour, **no page branching on a `SectionData` status**, **no page importing Prisma or a server action directly**, no direct `framer-motion` import.
- **The no-status-branching rule must survive this refactor.** If pages end up reading `.status` to decide what to suspend, the change has failed and must be redesigned.
- `Section` remains the sole state renderer. `SectionData` keeps all six states.
- Whole-project gate before every commit: `npm test && npm run tokens && npx tsc --noEmit && npm run build`.
- **e2e sits outside that gate** — run `npx playwright test e2e/` explicitly on any task touching routing, layouts or the harness.
- `src/styles/counter-components.css` is GENERATED. Never hand-edit. `src/styles/counter-repairs.css` is hand-written.
- No `Co-Authored-By: Claude` line.

---

## Sequencing note — read before starting

This plan must land **before** the remaining tasks of
`docs/superpowers/plans/2026-08-26-counter-needs-you-fidelity.md` (Tasks 3-10),
because those tasks build four more pages against the pattern this plan
replaces. Tasks 1 and 2 of that plan are already complete and are unaffected —
they add presentational primitives with no data fetching.

After this plan completes, the Needs-you plan's page tasks (5, 6, 8, 9) need
their composition sections rewritten against the new shell contract. That
rewrite is Task 6 here.

---

## Task 1: Move the chrome into the layouts

**Files:**
- Modify: `src/app/dashboard/layout.tsx`, `src/app/(mobile)/m/layout.tsx`
- Modify: `src/components/counter/shell/app-shell.tsx`
- Modify: `src/app/dashboard/counter-overview-client.tsx`, `src/app/dashboard/orders/counter-orders-client.tsx`, `src/app/dashboard/orders/[id]/counter-order-client.tsx`, `src/app/dashboard/pnl/counter-pnl-client.tsx`, and the four phone equivalents
- Test: `tests/components/counter-app-shell.test.tsx`, `tests/app/counter-layout.test.tsx`

**Why this works:** the chrome is already URL-driven. The date control and store
switcher write through `writeCounterParams` and read through
`readCounterParams`; they are `useSearchParams()` consumers wearing callback
props. In the layout they read and push directly, and the prop drilling
disappears rather than relocating.

- [ ] **Step 1: Capture the current DOM as the contract**

Before changing anything, snapshot the rendered landmark sequence of all four
gated surfaces:

```bash
npm run fidelity
npx tsx scripts/fidelity-report.ts > /tmp/before-fidelity.txt
```

The DOM after this task must be **byte-identical**. That is the whole safety
argument for the task, so establish it first.

- [ ] **Step 2: Write the failing test**

```tsx
// tests/app/counter-layout.test.tsx
// The point of the whole task: the chrome survives a navigation.
it("keeps one rail instance mounted across a route change", async () => {
  const { rerender, container } = render(<DashboardLayout><OverviewPage /></DashboardLayout>)
  const railBefore = container.querySelector(".rail")
  rerender(<DashboardLayout><OrdersPage /></DashboardLayout>)
  expect(container.querySelector(".rail")).toBe(railBefore)  // same node, not an equal one
})

it("renders exactly one AppShell for a page, not one per page component", () => {
  expect(container.querySelectorAll(".rail")).toHaveLength(1)
  expect(container.querySelectorAll(".topbar")).toHaveLength(1)
})
```

`toBe` on the node identity is the assertion that matters — an equal-but-new
node is exactly the bug.

- [ ] **Step 3: Run it and watch it fail.** Expected: two rails, or a new node.

- [ ] **Step 4: Split `AppShell`**

`AppShell` keeps: rail, topbar, store switcher, ask surface, theme. It reads
`usePathname()` and `useSearchParams()` itself instead of taking `pathname`,
`params`, `presetId`, `onSelectPreset`, `selectedStoreId`, `onSelectStore`.

`PageHead` (already a separate component) keeps: `title`, `sub`, `crumbLeaf`,
`actions`.

Pages render `<PageHead …>` followed by their sections, as `children` of the
layout's shell.

- [ ] **Step 5: Run it and watch it pass.**

- [ ] **Step 6: Prove the DOM did not move**

```bash
npm run fidelity
```

**All four surfaces must still pass with the same baselines.** If any reds,
diff the landmark sequence against `/tmp/before-fidelity.txt` and fix the
composition — do not adjust the baseline. A changed baseline here means the
refactor changed the page, which this task forbids.

- [ ] **Step 7: Gate, e2e, commit**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
npx playwright test e2e/
git add -A src tests
git commit -m "perf(counter): the rail was being rebuilt on every navigation"
```

---

## Task 2: A loading boundary per Counter route

**Files:**
- Create: `src/app/dashboard/loading.tsx`, `src/app/dashboard/orders/loading.tsx`, `src/app/dashboard/orders/[id]/loading.tsx`, `src/app/dashboard/pnl/loading.tsx`, and the four phone equivalents under `src/app/(mobile)/m/`
- Test: `tests/app/counter-loading.test.tsx`

With the chrome in the layout (Task 1), a `loading.tsx` covers only the content
area — the rail stays put and the content shows skeletons.

Use the existing `Skeleton` from `src/components/counter/state/skeleton.tsx`.
Do not invent a second loading visual.

- [ ] **Step 1: Write the failing test** — each Counter route has a loading
  boundary, and it renders `Skeleton`, not a spinner or a blank.
- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch pass.**
- [ ] **Step 5: `npm run fidelity` — a loading boundary must not change the settled DOM.**
- [ ] **Step 6: Gate, e2e, commit**

```
git commit -m "feat(counter): a page that paints before its data arrives"
```

---

## Task 2b: Make the regression impossible to reintroduce

**Files:**
- Modify: `scripts/counter-lint.ts`
- Modify: `CLAUDE.md`, `DESIGN.md`
- Test: `tests/scripts/counter-lint.test.ts`

This project's own principle is that **the rules are a build failure, not prose
to remember** — `npm run tokens` already enforces five of them. The regression
this plan repairs happened because nothing checked for it, and fifty-one pages
remain to be built by copying the last one.

Two new rules on `src/app/dashboard/**` and `src/app/(mobile)/m/**`:

1. **`no-shell-in-page`** — a page or page client may not import or render
   `AppShell`. After Task 1 it belongs to a layout, and a page that mounts its
   own is the exact defect measured in the spec (4 mount sites, 0 layouts).
2. **`no-route-without-loading`** — every Counter route directory containing a
   `page.tsx` must contain a `loading.tsx`. This is a directory check rather
   than a regex, so it does not share the regex rules' documented holes.

Both must be checked against the same `LEGACY_BASELINE_COMMIT` exemption
mechanism the existing rules use, so the ~19 remaining editorial pages do not
fail the build before they are deleted.

Then record both in `CLAUDE.md` and `DESIGN.md` beside the five that exist —
the linter is the enforcement, the docs are the explanation, and this project
keeps both.

- [ ] **Step 1: Write the failing test** — a fixture page importing `AppShell`
  fails `no-shell-in-page`; a fixture route directory with a `page.tsx` and no
  `loading.tsx` fails `no-route-without-loading`.
- [ ] **Step 2: Run and watch fail.**
- [ ] **Step 3: Implement both rules.**
- [ ] **Step 4: Run and watch pass, then run `npm run tokens` on the real tree**
  and confirm it is clean — if it is not, Tasks 1 and 2 are incomplete and the
  linter has just told you where.
- [ ] **Step 5: Commit**

```
git commit -m "build(counter): a page that mounts its own shell now fails the build"
```

---

## Task 3: Sections stream independently

**Files:**
- Modify: `src/lib/counter/adapters/overview.ts`, `orders.ts`, `pnl.ts`
- Modify: `src/components/counter/surface/section.tsx`
- Modify: the eight page clients
- Test: `tests/components/counter-section-suspense.test.tsx`, `tests/lib/counter-adapter-streaming.test.ts`

**This is the task that carries the plan's real risk.** Read the spec's risk
section before starting.

Adapters gain a variant that returns a record of **promises** rather than an
awaited record of `SectionData`. Pages pass each promise to its own Suspense
boundary; `Section` unwraps with `use()`.

**The constraint that must survive:** `npm run tokens` forbids a page branching
on a `SectionData` status. A page must not read `.status` to decide what to
suspend. If the design requires that, stop and report — the design is wrong,
not the linter.

- [ ] **Step 1: Write the failing test**

```tsx
// The whole point: one slow section must not hold up a fast one.
it("paints a resolved section while a slower one is still pending", async () => {
  const fast = Promise.resolve(ready(STRIP))
  const slow = new Promise(() => {})           // never resolves
  render(<Page sections={{ strip: fast, chart: slow }} />)
  expect(await screen.findByText("$50,754")).toBeInTheDocument()
  expect(screen.getByTestId("chart-skeleton")).toBeInTheDocument()
})
```

- [ ] **Step 2: Run and watch fail** — today the page awaits everything, so
  nothing renders while `slow` is pending.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and watch pass.**
- [ ] **Step 5: Prove the isolation is real** — make the fast section slow and
  confirm the assertion flips. A test that passes with both sections resolved
  instantly proves nothing.
- [ ] **Step 6: `npm run fidelity`**, with attention to the harness capturing a
  fallback mid-stream. If it does, add an explicit settle condition to the
  harness **and say so in the report** — a settle condition is a way to paper
  over a slow page, and it must be a deliberate, visible choice.
- [ ] **Step 7: Gate, e2e, commit**

```
git commit -m "feat(counter): the strip no longer waits for the chart"
```

---

## Task 4: Make `loading` and `stale` reachable

**Files:**
- Modify: the eight page clients
- Test: `tests/app/counter-transitions.test.tsx`

Assign the two states the jobs the spec gives them:

| state | means | produced by |
|---|---|---|
| Suspense fallback | first paint | the boundary (Task 3) |
| `stale` | refetch in flight, previous data on screen | `useTransition` with prior data |
| `loading` | refetch in flight, nothing to show | `useTransition` with no prior data |

Filter and range changes push to the URL and trigger a server round-trip.
`useTransition`'s `isPending` is where both states come from.

- [ ] **Step 1: Write the failing test** — changing a filter with data on screen
  puts sections into `stale`, not into a blank; and `loading()` is produced
  somewhere for the first time in the codebase.
- [ ] **Step 2-4:** fail → implement → pass.
- [ ] **Step 5: `npm run fidelity`.**
- [ ] **Step 6: Gate, e2e, commit**

```
git commit -m "feat(counter): a six-state model with six reachable states"
```

---

## Task 5: Waterfalls, prefetch and pending feedback

**Files:**
- Modify: `src/app/dashboard/page.tsx`, `orders/page.tsx`, `pnl/page.tsx`, `orders/[id]/page.tsx` and phone equivalents
- Modify: `src/components/counter/shell/rail.tsx`

Three small independent changes, batched:

1. `Promise.all` for the independent `getOverviewStores()` / `getXSections()`
   pair on every page.
2. Rail links prefetch, so hovering the rail warms the destination.
3. Next 16's `useLinkStatus` gives the clicked rail item a pending state.

- [ ] **Step 1: Write the failing tests** — including one asserting the two
  fetches are concurrent, not sequential. Assert on call ordering, not on
  elapsed time; a timing assertion is flaky and proves nothing on a fast machine.
- [ ] **Step 2-4:** fail → implement → pass.
- [ ] **Step 5: `npm run fidelity`** — `useLinkStatus` adds a class to a rail
  item, and `.navbtn` sits inside a gated surface. Confirm the settled state is
  unchanged.
- [ ] **Step 6: Gate, e2e, commit**

```
git commit -m "perf(counter): two independent queries were waiting for each other"
```

---

## Task 6: Rewrite the Needs-you plan's page tasks against the new contract

**Files:**
- Modify: `docs/superpowers/plans/2026-08-26-counter-needs-you-fidelity.md` (Tasks 5, 6, 8, 9)
- Modify: `.superpowers/sdd/2026-08-26-counter-needs-you-fidelity/task-{5,6,8,9}-brief.md` (regenerate)

Those four tasks specify the pattern this plan replaces: a page that awaits
everything and hands one object to one client component that renders
`AppShell`. Left as written they would build four more pages the old way.

Rewrite their composition sections against the Task 1 shell contract and the
Task 3 streaming contract, then regenerate the briefs with
`scripts/task-brief`.

- [ ] **Step 1: Rewrite the four tasks.**
- [ ] **Step 2: Regenerate the four briefs.**
- [ ] **Step 3: Re-run the pre-flight scan** over the changed tasks — the same
  table, the same rows — and append the result to the Needs-you ledger.
- [ ] **Step 4: Commit** (docs only, no gate needed beyond `npm test`).

```
git commit -m "docs(counter): the Needs-you page tasks, against the new shell"
```

---

## Task 7: PPR — measured, not assumed

**Files:**
- Modify: `next.config.ts`
- Create: `docs/counter/ppr-measurement.md`

`ppr` and `cacheComponents` are both available on 16.3.2 and neither is enabled.
The static shell prerendering with dynamic holes streaming is the strongest
version of what this plan is about — and it is experimental, and it interacts
with dynamic APIs in ways that need measuring rather than assuming.

- [ ] **Step 1: Measure first.** Record TTFB and time-to-first-paint for all
  four gated surfaces as they stand after Task 5.
- [ ] **Step 2: Enable `ppr: "incremental"`** and opt in the Counter routes only.
- [ ] **Step 3: Measure again.** Same four surfaces, same method.
- [ ] **Step 4: `npm run fidelity` and `npx playwright test e2e/`.**
- [ ] **Step 5: Decide from the numbers.** Write both measurements into
  `docs/counter/ppr-measurement.md` with the verdict. **If it does not measurably
  help, revert it and record that** — an experimental flag carried for its name
  rather than its effect is a cost, not a feature.
- [ ] **Step 6: Commit.**

---

## Self-review

**Spec coverage.** A→Task 1, B→Task 2, enforcement→Task 2b, C→Task 3, "loading reachable"→Task 4,
D/E→Task 5, F→Task 7. The spec's sequencing note→Task 6.

**Placeholder scan.** Tasks 2, 4, 5 and 6 give test intent and assertions rather
than complete bodies. That is bounded: each is a small mechanical change against
a contract Task 1 and Task 3 establish in full. The two tasks carrying real risk
— 1 and 3 — have their key assertions written out, including the `toBe`
node-identity check that is the entire point of Task 1.

**The risk this plan carries.** Task 3 changes how gated pages render on four
surfaces that pass today. The mitigation is running `npm run fidelity` at every
step rather than at the end, and refusing to adjust a baseline to accommodate a
refactor that is supposed to be invisible. If a baseline needs changing, the
refactor changed the page and that is a finding, not a step.
