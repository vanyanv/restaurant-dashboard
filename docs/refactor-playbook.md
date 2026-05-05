# Refactor Playbook — Splitting Oversized Files

Written after the Batch A split of `src/app/actions/product-usage-actions.ts` (1606 → ~880 lines, then split into two domain modules + three shared helpers).

This playbook applies whenever a file in this repo passes the "should I split this?" rubric below. Follow the 9 steps in order.

---

## When to split

A file qualifies for the playbook when **size > 400 lines AND at least one of:**

- Three or more **unrelated domains** live in the file (e.g. store CRUD + analytics + P&L).
- Consumers don't share a logical grouping (different routes import disjoint subsets of the exports).
- Private helpers cluster around 2+ distinct responsibilities while the file as a whole doesn't.

**Pure size is not a trigger.** A 600-line cohesive form component or a single complex screen is fine. Splitting purely to lower line count produces a flock of 80-line files that all import each other — strictly worse to navigate.

---

## The 9-step pipeline

### 1. Inventory

List every export with its line range. Group exports into observed domains (don't invent ones — let them emerge). Flag private helpers shared across domains.

```
rg -n "^export " <file>
```

### 2. Map consumers

Two complementary tools, used in this order:

**a. Graphify first — for architecture-level orientation.** Ask the graph what *cluster* the file belongs to and which neighbors it bridges. This is what graphify is built for.

```
graphify query "what does <filename> bridge across communities"
graphify path "<filename>" "<suspected-mobile-consumer>"
```

Graphify is fuzzy on exhaustive enumeration — it surfaces semantically related nodes, not necessarily a complete importer list. Don't assume "graphify returned nothing" means "no consumer exists."

**b. Then grep — for the load-bearing importer list.** This is the source of truth for who needs the shim to keep working:

```
rg "from .*<filename>" src/
```

Tag each consumer as **desktop / mobile / both**. Mobile is the union of:

- `src/app/(mobile)/m/**` (Next.js route group — the parens are part of the path)
- `src/lib/mobile/**`
- anything those transitively import

If a single export is consumed by both desktop and mobile, that export is the highest-stakes one in the file — the contract test should cover it first.

**Naming hygiene:** before creating a new file at `src/app/actions/<file-prefix>/<domain>-actions.ts`, grep for `<domain>-actions.ts` elsewhere — a plain filename collision (same basename, different directory) won't break the build but will confuse readers scanning the tree. Batch A landed `product-usage/recipe-actions.ts` while a separate `actions/recipe-actions.ts` already existed — not blocking, but worth flagging in the PR.

### 3. Dead-code pass

Exports with **zero consumers** get listed. The user decides keep/delete *before* splitting. Deleted code is recoverable from git; leaving it in costs ongoing typecheck/build time and clutter.

In Batch A this saved ~700 lines (5 dead exports + their imports + the `getOpenAIClient` helper).

### 4. Helper TDD (red → green)

For each pure helper to extract:

1. Write a failing test at `tests/<mirror-of-new-path>.test.ts` that imports from a module that doesn't exist yet.
2. Run `pnpm test` — expect the import to fail (red).
3. Create the helper module under `src/app/actions/_shared/<topic>.ts` (or wherever the new home is).
4. Re-run `pnpm test` — expect green.

Helpers extracted in Batch A: `parseDateRange`, `resolveStoreScope`, `computeVariance`. The tests fingerprint the *exact* boundary semantics (e.g. variance uses strict `> 10` not `>= 10`) so a behavior drift in the split would be caught.

**⚠ Don't blindly reuse helpers across files with different timezone semantics.** The `parseDateRange` extracted in Batch A is a plain-`new Date(...)` parser — it preserves the inline behavior of `product-usage-actions.ts` exactly. But files like `store-actions.ts` use LA-timezone-aware helpers (`todayInLA`, `startOfDayLA`, `endOfDayLA` from `@/lib/dashboard-utils`). Using the Batch A `parseDateRange` there would silently swap LA-local for machine-local. Either keep a separate LA-aware variant, leave the inline parsing in place, or migrate callers to the LA helpers explicitly. The playbook's job is to call out drift like this, not paper over it.

### 5. Contract tests for actions being moved

For each action that's about to relocate, add a vitest test that:

- mocks Prisma (`vi.mock("@/lib/prisma")`)
- mocks `next-auth`'s `getServerSession`
- calls the action with a known input
- asserts the **shape** of the response against a Zod schema

**Test ordering is not "green before AND after."** A test cannot import from a module that doesn't exist yet. The right sequence:

1. Write the contract test pointed at the **current** path (e.g. `@/app/actions/product-usage-actions`). It runs green against the pre-split file.
2. Move the implementation into the new domain modules. The shim re-exports them, so the test's import path still resolves — still green.
3. *(Optional, after the codemod step)* Retarget the test import to the leaf module (`@/app/actions/product-usage/data-actions`) and remove the shim. Still green.

The Zod schema is the load-bearing artifact; the import path is just a vehicle.

These are **not** integration tests — they don't hit a real DB. Integration coverage is a separate, larger project.

### 6. Domain split

Create the domain modules:

```
src/app/actions/<file-prefix>/<domain>-actions.ts
```

Shared private helpers live at `src/app/actions/_shared/<topic>.ts`. The underscore prefix marks them as internal — they should never be imported from outside `src/app/actions/`.

### 7. Re-export shim at the original path

The original file becomes a thin aggregator. **Critical Next.js quirk:** the shim must NOT have `"use server"` at the top — when present, the bundler erases re-exports and you get the cryptic *"The module has no exports at all"* error at build time. The implementation files keep `"use server"`; the shim does not.

```ts
// src/app/actions/<file>-actions.ts (shim, no "use server")

export { foo } from "./<file>/domain-a-actions"
export { bar, baz } from "./<file>/domain-b-actions"
```

Consumers across `src/app/dashboard/*`, `src/app/m/*`, and lib code keep their existing import paths. Zero consumer edits. This is the safety net that lets the move be reviewed and shipped without coordinating dozens of import-path changes.

### 8. Verify

The repo's `package.json` only defines `test` and `build` — there is no `typecheck` or `lint` script, and the lockfile is `package-lock.json` (the project happens to run `pnpm` over an npm-installed tree; both work). Run the actual gates that exist:

```
pnpm test                  # vitest: contract + helper tests + existing tests
pnpm exec tsc --noEmit     # the typecheck gate (no script alias)
pnpm build                 # next build also runs Next.js compile-time checks
graphify update .          # AGENTS.md / CLAUDE.md require this after any code change
```

Then **manually** smoke the routes the consumer map flagged. For mobile, that means actually loading each `(mobile)/m/*` route in a phone-sized viewport — not just confirming the page returns 200.

If the project later gains real `typecheck` / `lint` scripts (preferred), update this step to use them.

### 9. Settle, then optionally codemod imports & drop the shim

The shim is functionally permanent — it costs ~nothing at runtime. After the split has lived in `main` for at least one full Otter sync cycle (so cron-driven paths surface any latent issue), you can do a follow-up PR that:

- Codemods all consumer imports from the old path to the new domain paths.
- Deletes the shim file.

This is **also where any cold-start / bundling win actually materializes**. A barrel shim doesn't change what the bundler pulls in — re-exports through it can still keep the action manifest large, since consumers still import from the original path. If the cold-start case matters for a given file, treat step 9 as required (not optional) and measure before vs. after with `pnpm build` output / Vercel function size. Don't claim a perf win that hasn't been measured.

---

## Mobile-safety checklist

Before merging any split that touches a file imported from `src/app/(mobile)/m/**`:

- [ ] Confirmed the shim has **no** `"use server"` directive at the top.
- [ ] If the new domain modules have `"use server"`, they export **only async functions** — no Zod schemas, no constants, no types as values. (Schemas/types either stay private at module scope or move to a non-`"use server"` sibling.)
- [ ] Ran `pnpm build` — no "module has no exports" errors anywhere in the trace.
- [ ] Manually loaded each `(mobile)/m/*` route from the consumer map in a mobile viewport. The list comes from step 2.
- [ ] Verified `inv-row` / `inv-panel` / `inv-stamp` styles still render on `(mobile)/m/*` (commit b443a09 split CSS specifically for mobile; an accidental import-path change can lose those styles).
- [ ] Ran `graphify update .` so the knowledge graph reflects the new module layout.
- [ ] One full Otter sync cycle has elapsed in `main` before starting the next batch.

---

## Worked example — Batch A: `product-usage-actions.ts`

**Before:** 1 file, 1606 lines, 10 exports including 5 dead ones, zero tests.

**Steps applied:**

| Step | Action |
|---|---|
| 1 | Inventoried 10 exports across 6 observed domains. |
| 2 | `rg "from .*product-usage-actions"` → all 6 desktop pages, **zero** mobile imports. Lowest blast radius in the codebase. |
| 3 | Identified 5 dead exports: `generateAiInsights`, `generateDemandForecast`, `generateWeeklyComparison`, `upsertIngredientAlias`, `getVendorPriceTrends`. Deleted with user sign-off. File dropped to ~880 lines. |
| 4 | Wrote 16 unit tests across 3 helper modules (`parseDateRange`, `resolveStoreScope`, `computeVariance`). Tests pinned the strict-inequality variance threshold and the `&&`-not-`||` semantics of the date-range explicit-pair check. |
| 5 | Wrote 14 contract tests covering both new domain modules' response shapes via Zod. |
| 6 | Created `src/app/actions/product-usage/data-actions.ts` and `recipe-actions.ts`. Shared helpers landed under `src/app/actions/_shared/`. |
| 7 | Original `product-usage-actions.ts` → 16-line re-export shim. **First attempt failed** because I left `"use server"` at the top — caught by `pnpm build`. Removing it fixed the build immediately. |
| 8 | All gates passed: 32 tests, typecheck, build. |
| 9 | Shim left in place; codemod deferred. |

**After:** Original file path still works for every existing consumer. Two focused domain files + three pure-helper modules with real tests. The helpers are reusable, with the LA-timezone caveat in step 4 — `parseDateRange` is **not** a drop-in for files using `todayInLA` / `startOfDayLA` / `endOfDayLA`.

---

## Out-of-PR follow-ups

Some artifacts produced by following this playbook are local-only and do not belong in the PR:

- **Local Claude memory** at `~/.claude/projects/-home-vardan-restaurant-dashboard/memory/` — useful for future sessions but not reviewable repo state. Update memory after the PR merges, not as part of it.
- **Graphify graph** at `graphify-out/` — committed in this repo, so the `graphify update .` run *does* belong in the PR's verify step. (Distinct from local memory.)

---

## Non-goals (what this playbook does NOT cover)

- Behavior changes, signature changes, or any user-visible drift.
- Wholesale dedup of patterns beyond the helpers explicitly listed in step 4.
- Setting up a real test database / integration test suite.
- Refactoring sheet-style UI components — most of those are single cohesive screens that should not be split (rubric says size alone isn't a trigger).
