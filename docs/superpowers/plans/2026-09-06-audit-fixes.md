# Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the cross-tenant leaks, unify the diverging business figures, delete ~43k lines of dead pre-Counter code, and patch the linter holes found by the 2026-09-06 audit.

**Architecture:** Fixes land in the audited order — security first, correctness second, deletion third, enforcement fourth — because deletion tranches remove some divergent code the figure fixes would otherwise touch, and the linter patches must land after the code they would newly flag is gone. Every task is a self-contained commit that keeps the whole-project gate green.

**Tech Stack:** Next.js 16 / Prisma 7 / vitest (`vi.mock("@/lib/prisma")` contract tests — model: `tests/lib/counter/adapters/prices.test.ts`).

**Spec:** `docs/superpowers/plans/2026-09-06-audit-findings-spec.md` (finding IDs L1-L8, F1-F5, D1-D9 refer to it).

## Global Constraints

- Whole-project gate: `npm test && npm run tokens && npx tsc --noEmit && npm run build`. Run test+tokens+tsc every commit; `npm run build` at least once per phase.
- `npm run fidelity` (needs dev server on :3000 + working DB) after any task that changes what a Counter page renders — Tasks 8, 11, 21.
- Tenancy boundary is `accountId`, never `ownerId`/`storeId` alone; store-owned models via `store: { accountId }`; raw SQL joins/filters `"Store"`.
- `tests/styles/token-parity.test.ts` matches file TEXT — do not name pre-Counter class names even in comments/commit-adjacent files it scans.
- No `"use server"` on re-export shims (breaks Next re-exports).
- Never run `prisma migrate dev`. No schema changes are in this plan.
- Commit messages follow repo style (`fix(counter): …`, `chore: …`) and end with the Claude co-author trailer.

---

## Phase 1 — Cross-tenant leaks

### Task 1: Settings adapter leaks every account's LoginEvents (L1)

**Files:**
- Modify: `src/lib/counter/adapters/settings.ts:115-155` (`loadSettings`)
- Test: create `tests/lib/counter/adapters/settings.test.ts`

**Interfaces:**
- Consumes: existing `SettingsInput { accountId: string }`, `getSettingsSectionPromises`.
- Produces: no signature changes; `loadSettings` internally queries users first, then everything else.

`LoginEvent` (schema.prisma:1206) has NO relation field to `User` — only a nullable `userId` scalar — so the filter must be `userId: { in: <account user ids> }`. Failed sign-ins with `userId: null` drop out; that is correct for a per-account settings page.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/counter/adapters/settings.test.ts
//
// Settings' loginEvent reads shipped with no tenant filter at all — every
// account's sign-in IPs and user agents in one list. LoginEvent has no
// relation to User, so the boundary is userId ∈ (this account's users).
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    store: { findMany: vi.fn() },
    alertPreference: { count: vi.fn() },
    loginEvent: { findMany: vi.fn(), count: vi.fn() },
    invite: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from "@/lib/prisma"
import { getSettingsSectionPromises } from "@/lib/counter/adapters/settings"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  asMock(prisma.user.findMany).mockResolvedValue([
    { id: "u1", email: "a@x", name: "A", role: "OWNER", timezone: "UTC",
      notifyInvoices: false, notifyWeeklyReport: false, notifyAnomaly: false,
      ownedStores: [] },
  ])
  asMock(prisma.store.findMany).mockResolvedValue([])
  asMock(prisma.alertPreference.count).mockResolvedValue(0)
  asMock(prisma.loginEvent.findMany).mockResolvedValue([])
  asMock(prisma.loginEvent.count).mockResolvedValue(0)
  asMock(prisma.invite.findMany).mockResolvedValue([])
  asMock(prisma.$queryRaw).mockResolvedValue([{ role: "OWNER" }])
})

describe("loadSettings tenancy", () => {
  it("filters loginEvent reads to this account's users", async () => {
    const sections = getSettingsSectionPromises({ accountId: "acct_ours" })
    await Promise.all(Object.values(sections))

    const findWhere = asMock(prisma.loginEvent.findMany).mock.calls[0][0].where
    expect(findWhere.userId).toEqual({ in: ["u1"] })

    const countWhere = asMock(prisma.loginEvent.count).mock.calls[0][0].where
    expect(countWhere.userId).toEqual({ in: ["u1"] })
  })
})
```

Adjust the section-await line to the adapter's real exported shape if `getSettingsSectionPromises` takes extra fields — copy whatever `src/app` passes it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/counter/adapters/settings.test.ts`
Expected: FAIL — `findWhere.userId` is `undefined`.

- [ ] **Step 3: Fix `loadSettings`**

Pull the `user.findMany` out of the `Promise.all` so its ids can scope the login queries:

```ts
async function loadSettings(input: SettingsInput): Promise<SettingsData> {
  const since = new Date(Date.now() - SIGNIN_DAYS * 86_400_000)

  const users = await prisma.user.findMany({
    where: { accountId: input.accountId },
    orderBy: { role: "asc" },
    select: { /* unchanged select block */ },
  })
  // LoginEvent has no relation to User — the boundary is the id list.
  // Failed attempts (userId null) are other people's business, not this page's.
  const userIds = users.map((u) => u.id)

  const [stores, alertPreferences, logins, signouts, invites, roles] =
    await Promise.all([
      /* store.findMany, alertPreference.count — unchanged */
      prisma.loginEvent.findMany({
        where: { kind: "SIGN_IN", createdAt: { gt: since }, userId: { in: userIds } },
        select: { userAgent: true, ipAddress: true, createdAt: true },
      }),
      prisma.loginEvent.count({
        where: { kind: "SIGN_OUT", createdAt: { gt: since }, userId: { in: userIds } },
      }),
      /* invite.findMany, $queryRaw — unchanged */
    ])
  /* rest unchanged; destructuring no longer includes `users` */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/counter/adapters/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate + commit**

Run: `npm test && npm run tokens && npx tsc --noEmit`

```bash
git add src/lib/counter/adapters/settings.ts tests/lib/counter/adapters/settings.test.ts
git commit -m "fix(counter): settings read every account's sign-in events"
```

### Task 2: Stock-counts — entry section trusts its countId; model-state count is global (L2, L4)

**Files:**
- Modify: `src/lib/counter/adapters/stock-counts.ts:252` and `:824-830, :875-895`
- Test: extend `tests/lib/counter/adapters/inventory-count-entry.test.ts` if it covers `loadCountEntry`, else create `tests/lib/counter/adapters/stock-counts-tenancy.test.ts`

**Interfaces:**
- Consumes: `CountSessionInput { countId, accountId }` (`stock-counts.ts:681`), `StockCountsInput` (`:162`).
- Produces: `loadCountEntry(countId: string, accountId: string)` — new second parameter.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/counter/adapters/stock-counts-tenancy.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stockCount: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
    stockCountLine: { findMany: vi.fn() },
    ingredientModelState: { count: vi.fn() },
    store: { findMany: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { getCountSessionSectionPromises } from "@/lib/counter/adapters/stock-counts"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe("count session tenancy", () => {
  beforeEach(() => vi.clearAllMocks())

  it("a foreign countId yields no entry section", async () => {
    // findFirst (the fixed query) returns null when the account doesn't match
    asMock(prisma.stockCount.findFirst).mockResolvedValue(null)
    const sections = getCountSessionSectionPromises({
      countId: "count_theirs",
      accountId: "acct_ours",
    })
    const entry = await sections.entry
    expect(entry.status).toBe("empty")
    // The old findUnique-by-id-alone path must be gone entirely:
    expect(asMock(prisma.stockCount.findUnique)).not.toHaveBeenCalled()
    const where = asMock(prisma.stockCount.findFirst).mock.calls[0][0].where
    expect(where).toMatchObject({ id: "count_theirs", store: { accountId: "acct_ours" } })
  })
})
```

(If `getCountSessionSectionPromises` is named differently, copy the export the count-session page imports.) Add to the same file a check on the list loader:

```ts
  it("scopes the model-state count to the account's stores", async () => {
    // arrange the list loader's mocks with two stores for acct_ours, then:
    const where = asMock(prisma.ingredientModelState.count).mock.calls[0][0].where
    expect(where.storeId).toEqual({ in: ["store_a", "store_b"] })
  })
```

Fill the arrange block from how `tests/lib/counter/adapters/new-count.test.ts` fakes the stock-counts list load (same models).

- [ ] **Step 2: Run to verify both fail**

Run: `npx vitest run tests/lib/counter/adapters/stock-counts-tenancy.test.ts`
Expected: FAIL — `findUnique` called / `count` called with no args.

- [ ] **Step 3: Fix both sites**

At `:875`, thread the account through and make the row lookup carry the boundary:

```ts
async function loadCountEntry(
  countId: string,
  accountId: string,
): Promise<CountSessionEntry | null> {
  // The boundary is the caller's account, never the fetched row's: deriving
  // accountId from the record makes any countId "valid".
  const countRow = await prisma.stockCount.findFirst({
    where: { id: countId, store: { accountId } },
    select: { id: true, status: true },
  })
  if (!countRow) return null

  const [ingredients, lines] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      where: { accountId },
      /* unchanged */
    }),
    /* stockCountLine.findMany unchanged — countId is now proven ours */
  ])
```

At `:825` change the call to `loadCountEntry(input.countId, input.accountId)`.

At `:252` change `prisma.ingredientModelState.count()` to
`prisma.ingredientModelState.count({ where: { storeId: { in: storeIds } } })`
(`storeIds` is in scope a few lines above).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/counter/adapters/stock-counts-tenancy.test.ts tests/lib/counter/adapters/inventory-count-entry.test.ts tests/lib/counter/adapters/new-count.test.ts`
Expected: PASS (fix any existing fixture that mocked `findUnique`).

- [ ] **Step 5: Gate + commit**

```bash
npm test && npm run tokens && npx tsc --noEmit
git add src/lib/counter/adapters/stock-counts.ts tests/lib/counter/adapters/
git commit -m "fix(counter): count entry trusted its countId across the account boundary"
```

### Task 3: Ingredient page counts every account's stock-count lines (L3)

**Files:**
- Modify: `src/lib/counter/adapters/ingredient.ts:221`
- Test: create `tests/lib/counter/adapters/ingredient-tenancy.test.ts` (call-args style, same skeleton as Task 1: mock every model `loadIngredient` touches, resolve minimal fixtures, assert on `stockCountLine.count` call args)

**Interfaces:**
- Consumes: `IngredientInput { ingredientId, storeId, accountId, range, today }` (`ingredient.ts:95`).
- Produces: no signature change.

- [ ] **Step 1: Failing test** — assert the second `stockCountLine.count` call carries the boundary:

```ts
const calls = asMock(prisma.stockCountLine.count).mock.calls
// one call is scoped by ingredientId; the account-wide one must be scoped too
expect(calls.some((c) => c[0]?.where?.stockCount?.store?.accountId === "acct_ours")).toBe(true)
expect(calls.every((c) => c[0] !== undefined)).toBe(true)
```

- [ ] **Step 2: Run — expect FAIL** (`prisma.stockCountLine.count()` called bare).
- [ ] **Step 3: Fix** `:221`:

```ts
prisma.stockCountLine.count({ where: { stockCount: { store: { accountId } } } }),
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Gate + commit** — `fix(counter): 'lines in the account' counted lines in every account`.

### Task 4: New-store page reads every tenant's integration links (L5)

**Files:**
- Modify: `src/lib/counter/adapters/new-store.ts:91-93`
- Test: create `tests/lib/counter/adapters/new-store.test.ts` (skeleton as Task 1; mock `store.findMany`, `otterStore.findMany`, `harriBrand.findMany`, `storeWeatherSignal.count`)

**Interfaces:** `NewStoreInput { accountId }` (`new-store.ts:70`); no signature change.

- [ ] **Step 1: Failing test** — assert all three queries are scoped:

```ts
expect(asMock(prisma.otterStore.findMany).mock.calls[0][0].where)
  .toEqual({ store: { accountId: "acct_ours" } })
expect(asMock(prisma.harriBrand.findMany).mock.calls[0][0].where)
  .toEqual({ store: { accountId: "acct_ours" } })
expect(asMock(prisma.storeWeatherSignal.count).mock.calls[0][0].where)
  .toEqual({ store: { accountId: "acct_ours" } })
```

(If `OtterStore`/`HarriBrand`/`StoreWeatherSignal` lack a `store` relation in schema.prisma — check first — use `storeId: { in: <ids of the account's stores> }` computed after the `store.findMany`, restructuring exactly as Task 1 did.)

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Fix** the three queries per the shape the schema supports; the rendered `weatherRows` becomes this account's count, which also makes the sentence at `:161` true.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Gate + commit** — `fix(counter): new-store read every tenant's integration links and weather rows`.

### Task 5: Recipes raw scan + product-usage lookup unscoped (L6, L7)

**Files:**
- Modify: `src/lib/counter/adapters/recipes.ts:169-173`, `src/lib/counter/adapters/product-usage.ts:237`
- Test: extend the nearest existing adapter test or add `tests/lib/counter/adapters/recipes-tenancy.test.ts` asserting the raw query text (mock `$queryRaw` and inspect the template's interpolations include `storeIds`)

- [ ] **Step 1: Fix `recipes.ts`** — add the store filter to the partial-days scan (`storeIds` already in scope):

```sql
SELECT "recipeId" AS recipe_id, COUNT(*)::int AS days
FROM "DailyCogsItem"
WHERE "recipeId" IS NOT NULL AND "partialCost"
  AND "storeId" = ANY(${storeIds})
GROUP BY 1
```

- [ ] **Step 2: Fix `product-usage.ts:237`** — add the account to the name lookup:

```ts
prisma.canonicalIngredient.findMany({
  where: { id: { in: missing }, accountId },
  /* select unchanged */
})
```

- [ ] **Step 3: Test both** (raw-SQL arg inspection for recipes; call-args for product-usage), run, expect PASS.
- [ ] **Step 4: Gate + commit** — `fix(counter): scope the partial-cost scan and canonical name lookup`.

### Task 6: Decisions adapter resolves its own session (L8)

**Files:**
- Modify: `src/lib/counter/adapters/decisions.ts:9, :715` and its callers (the decisions `page.tsx` under both `(counter)` groups)

**Interfaces:**
- Consumes: `DecisionsSectionsInput` (`decisions.ts:312`).
- Produces: `DecisionsSectionsInput` gains whatever session-derived fields `:715` currently reads (at minimum `accountId: string`; check what `resolveStoreContext` supplies — likely `storeIds: string[]` too). Pages read the session (they already do for every sibling route) and pass the values in.

- [ ] **Step 1: Read `decisions.ts:700-740`** and list exactly which session fields are consumed.
- [ ] **Step 2: Move those fields onto `DecisionsSectionsInput`**, delete the `getCachedSession` import and call, keep the query shapes byte-identical.
- [ ] **Step 3: Update both decisions `page.tsx`** to pass the new fields from their session (copy the pattern from the overview pages, which already do this).
- [ ] **Step 4: Run** `npx vitest run tests/lib/counter` + gate.
- [ ] **Step 5: Commit** — `fix(counter): decisions adapter took its own session instead of an accountId`.

**Phase 1 close-out:** run `npm run build`. Then run the full gate once more.

---

## Phase 2 — Figure divergences

### Task 7: One `median` (F1 — prices.ts returns the wrong element on even n)

**Files:**
- Create: `src/lib/counter/median.ts`
- Modify: `src/lib/counter/adapters/alerts.ts:265-280` (delegate), `src/lib/counter/adapters/prices.ts:104-108` (delete local, import)
- Test: create `tests/lib/counter/median.test.ts`; keep alerts' existing median test green

**Interfaces:**
- Produces: `export function median(values: number[]): number | null` in `@/lib/counter/median` — averages the two middle values on even n, `null` on empty.

- [ ] **Step 1: Failing test**

```ts
// tests/lib/counter/median.test.ts
import { describe, it, expect } from "vitest"
import { median } from "@/lib/counter/median"

describe("median", () => {
  it("averages the middle pair on even populations", () => {
    expect(median([1, 2, 3, 10])).toBe(2.5) // prices.ts's old impl said 3
  })
  it("is the middle value on odd populations", () => e => expect(median([5, 1, 9])).toBe(5))
  it("is null, not 0, on empty", () => expect(median([])).toBeNull())
})
```

(Fix the arrow-function typo in the second case when transcribing.)

- [ ] **Step 2: Run — FAIL (module not found).**
- [ ] **Step 3: Create `src/lib/counter/median.ts`** with the body currently at `alerts.ts:274-279` (docblock explaining it owns the figure). Alerts keeps its export contract: `export { median } from "@/lib/counter/median"` replacing the local body. In `prices.ts` delete the local `median` (`:104-108`) and `import { median } from "@/lib/counter/median"`.
- [ ] **Step 4: Run** `npx vitest run tests/lib/counter` — the prices movers fixtures may shift by half a step on even histories; adjust expectations only where the new value is the true median.
- [ ] **Step 5: Gate + commit** — `fix(counter): prices ranked movers on the upper-middle, not the median`.

### Task 8: Commission and ticket flow from the adapter, not a constants table (F2)

**Files:**
- Modify: `src/components/counter/surface/channel-rows.tsx` (interface + render), `src/lib/counter/adapters/overview.ts:1300-1306`, `src/lib/counter/channels.ts:43-57` (delete `commission` field + `commissionFor`)
- Test: `tests/lib/counter/channels.test.ts` (drop commission cases), `tests/lib/counter/adapters/overview.test.ts` (channels mapping carries commission/ticket)

**Interfaces:**
- `ChannelRow` gains `commission: number | null` (dollars the marketplace kept; `0` = genuinely none, `null` = no published rate) and `ticket: number | null` — the exact semantics of `ChannelReading.commission/.ticket` (`channel-mix.ts:26-46`), which is the one owner of the figure.
- `commissionFor` is deleted; `channel-rows.tsx` was its only consumer. `Channel.commission` leaves `CHANNELS`.

- [ ] **Step 1: Failing test** — in `overview.test.ts`, assert the store-card mapping passes the mix's own figures through:

```ts
expect(card.channels[0]).toMatchObject({
  id: "doordash", net: 100, orders: 4,
  commission: 30,      // from the fixture's ChannelReading, store-rate × gross
  ticket: 25,
})
```

- [ ] **Step 2: Run — FAIL** (fields absent).
- [ ] **Step 3: Implement**

`overview.ts:1305`:

```ts
// Passed through from loadChannelMix — the one place commission is derived
// (store contract rate × gross, null when the schema publishes no rate).
channels: mix.map((c) => ({
  id: c.channel, net: c.net, orders: c.orders,
  commission: c.commission, ticket: c.ticket,
})),
```

Delete the now-false comment above it (`:1301-1304`).

`channel-rows.tsx` per-row block replaces `commissionFor`/local ticket math:

```tsx
const channel = channelById(r.id)
const fee = r.commission
const keep = fee === null ? null : r.net - fee
```

Render rules (bar + meta line):
- `fee > 0`: hatch `<u>` sized by `shareOf(fee)`, `<i>` by `shareOf(keep)`; meta `commission −{money(fee)} · keeps <b>{money(keep)}</b>` — the percent leaves the line; with multi-store aggregation there is no single rate to print, and a dollar figure is the honest one.
- `fee === 0`: full-width `<i>`, meta `no commission · keeps <b>{money(r.net)}</b>` (unchanged).
- `fee === null`: full-width `<i>`, no hatch, meta `commission rate not on file · keeps —` — the Grubhub case; a 20% bar was the fabrication this task removes.
- Ticket: `{money(r.ticket, { cents: true })} ticket` — passed through, `money` already prints an em-dash for null.

Update the component docblock (it quotes the prototype's `commission 25%` string — note the divergence and why). In `channels.ts` delete `commission` from the `Channel` interface, the four literals, and `commissionFor` (`:57`).

- [ ] **Step 4: Fix compile fallout** — `npx tsc --noEmit` will name every `ChannelRow` construction site; both overview clients pass `c.channels` straight through, so only the adapter mapping should need edits.
- [ ] **Step 5: Check the fidelity manifest** — `grep -rn "commission" e2e/fidelity/` and update any asserted meta-string.
- [ ] **Step 6: Gate + fidelity + commit**

```bash
npm test && npm run tokens && npx tsc --noEmit && npm run build
npm run fidelity   # dev server on :3000 + DB required
git add -A && git commit -m "fix(counter): channel rows drew a trade-average commission over the store's real one"
```

### Task 9: One `blendedMargin` (F3)

**Files:**
- Create: `src/lib/counter/blended-margin.ts`
- Modify: `src/lib/counter/adapters/menu-hub.ts:230-234` (delegate + re-export), `src/lib/counter/adapters/menu-profit.ts:197-200` (use it), `src/lib/counter/adapters/product-mix.ts:238-251` (rename local to `bridgeMargin`, call the shared function for the ratio)
- Test: create `tests/lib/counter/blended-margin.test.ts`

**Interfaces:**
- Produces: `export function blendedMargin(cost: number, revenue: number): number | null` — `100 − (cost/revenue)×100`, `null` unless `revenue > 0`. Exactly menu-hub's current exported body.

- [ ] **Step 1: Failing test** (`blendedMargin(30, 100) === 70`, `blendedMargin(30, 0) === null`, `blendedMargin(30, -5) === null`).
- [ ] **Step 2: Run — FAIL. Step 3: Implement:** move menu-hub's body into the new module with its docblock; menu-hub re-exports (`export { blendedMargin } from "@/lib/counter/blended-margin"`) so its import sites and tests hold. menu-profit `:199` becomes `const margin = blendedMargin(cogs, revenue)`. product-mix: rename the private window-walker to `bridgeMargin`, have its last line `return blendedMargin(cost, revenue)`, and note in its docblock that `Unit.price × qty` reconstitutes recorded revenue (`price = salesRevenue/qty` at `:190`) — same figure, decomposed by window.
- [ ] **Step 4: Run** `npx vitest run tests/lib/counter` — expect PASS, no numeric shifts (formulas were already identical).
- [ ] **Step 5: Gate + commit** — `refactor(counter): one blendedMargin, three pages`.

### Task 10: Batch recipe costs omit cyclic recipes like the canonical walker (F4)

**Files:**
- Modify: `src/lib/recipe-cost-batch.ts:48-66` (cycle branch) and the map consumer in `src/lib/counter/adapters/orders.ts` around `:1528`
- Test: `tests/lib/` — find the existing recipe-cost-batch test (`grep -rl recipe-cost-batch tests/`); add a cycle case

**Interfaces:**
- `batchRecipeCosts` (batch variant) keeps its signature; a recipe on a cycle is **absent from the returned map** (parity with `src/lib/recipe-cost.ts:496-505`, which catches `RecipeCycleError` and omits) instead of `{ totalCost: 0, partial: true }`.

- [ ] **Step 1: Failing test** — fixture two recipes referencing each other as `componentRecipeId`; assert `result.has("r1") === false` and the `console.warn` still fires (spy on it).
- [ ] **Step 2: Run — FAIL** (map has `{ totalCost: 0, partial: true }`).
- [ ] **Step 3: Implement** — in `walk`, on `stack.has(recipeId)` keep the `console.warn`, memoize a sentinel (`null`), and propagate: a recipe whose walk touched a cycle is not written to the output map; a recipe that merely *contains* an uncosted line keeps `partial: true` as today. Check how `orders.ts` reads the map (`.get(...)` — absent already renders as unpriced on sibling pages; mirror that).
- [ ] **Step 4: Run tests + gate.**
- [ ] **Step 5: Commit** — `fix(recipes): a cyclic recipe priced a plate at $0 on the orders page`.

### Task 11: Overview's "pts vs plan" uses the figure it prints (F5)

**Files:**
- Modify: `src/lib/counter/adapters/overview.ts:469-484`
- Test: extend `tests/lib/counter/adapters/overview.test.ts`

- [ ] **Step 1: Failing test** — fixture where unrounded food% is 28.44 and plan is 29.0: delta must be `-0.6 pts vs plan` (28.4 − 29.0), not `-0.5`.
- [ ] **Step 2: Run — FAIL. Step 3: Fix:**

```ts
// Rounded once, at the figure — the delta beside a printed 28.4 must be
// derivable from 28.4, the same rule primeCost() applies to roomPp.
const foodPct = p.grossSales > 0 ? Math.round(p.cogsPct * 1000) / 10 : null
```

(`pct(foodPct, { scaled: true })` prints the identical string; the delta at `:479` now agrees with it. Leave `laborPct` alone — it has no delta.)

- [ ] **Step 4: Run + gate. Step 5:** `npm run fidelity`; commit — `fix(counter): overview's plan delta disagreed with the figure beside it`.

**Phase 2 close-out:** `npm run build`.

---

## Phase 3 — Dead code deletion

Rules for every task in this phase: (1) re-verify each file is unreferenced immediately before deleting — `grep -rn "<basename-or-alias>" src scripts tests e2e --include="*.ts*" | grep -v <the-dead-tree-itself>`; a hit outside the tranche aborts that file, note it and move on. (2) Delete the tests that exist only to exercise deleted code in the same commit. (3) Gate after every tranche: `npm test && npm run tokens && npx tsc --noEmit`. (4) `npm run build` after Tasks 14 and 17. (5) Keep-list (never delete): `src/components/chat/tool-labels`, `src/components/dashboard/welcome-marquee.tsx`, `src/components/telemetry/page-view-tracker.tsx`, `src/components/mobile/{page-head,panel}`, `src/lib/dashboard/{model-call,splh-fold}.ts`, `src/lib/harri-token-store.ts` (lazy-imported at `harri.ts:113`), `src/styles/editorial-{tokens,mobile,auth}.css`, `welcome-marquee.css`.

### Task 12: Delete `editorial-dashboard.css` (D1)

- [ ] Verify: `grep -rn "editorial-dashboard" src --include="*.ts*"` → 0 import sites (prose mentions in `editorial-tokens.css:305` / `counter-lint.ts:405` don't count; `:405` is rewritten in Task 21).
- [ ] `git rm src/styles/editorial-dashboard.css`
- [ ] Gate; commit — `chore: delete the editorial dashboard sheet (8.5k lines, zero imports)`.

### Task 13: Delete the shadcn layer (D2)

- [ ] Verify `grep -rn '@/components/ui' src --include="*.ts*"` hits only files inside this tranche and the Task 14/15 trees.
- [ ] `git rm -r src/components/ui src/lib/utils.ts src/hooks/use-mobile.ts components.json`
- [ ] If `tsc` names survivors importing `cn`/ui pieces that Tasks 14-15 will delete, reorder: do Tasks 14-15 first, then this one. (The audit found all 48 `cn` importers dead, all in these trees.)
- [ ] Gate; commit — `chore: delete the unused shadcn layer`.

### Task 14: Delete dead chat + monitoring + analytics/charts component trees (D3, D4, D5-part)

- [ ] `git rm -r src/components/chat` **except** `tool-labels*` (move `tool-labels` up: `git mv src/components/chat/tool-labels.tsx src/components/counter/ask/tool-labels.tsx` is NOT allowed blind — first check its real filename and its importers (`grep -rn "chat/tool-labels" src`), then either leave `src/components/chat/` holding only it, or move it and fix imports; prefer the smaller diff: leave it in place).
- [ ] `git rm -r src/components/monitoring src/components/analytics src/components/charts`
- [ ] `git rm src/lib/chat/composer.ts src/lib/chat/describe-error.ts src/lib/chat/hydrate-messages.ts src/lib/chat/thread-scroll.ts src/lib/chat/trend-rows.ts src/lib/chat/group-conversations.ts src/lib/monitoring/engagement.ts src/lib/monitoring/system-status.ts src/lib/monitoring/jwt-health.ts src/lib/monitoring/ingredient-audit.ts src/lib/monitoring/node-handlers.ts src/lib/monitoring/github-incidents.ts src/lib/format.ts src/lib/date-presets.ts src/components/pnl/pnl-date-presets.ts`
- [ ] Delete their tests: `tests/lib/chat/group-conversations.test.ts`, `tests/lib/format.test.ts`, dead `tests/lib/monitoring/*` (verify each test's import target is in this tranche).
- [ ] Gate + `npm run build`; commit — `chore: delete the pre-Counter chat, monitoring and analytics component trees`.

### Task 15: Delete loose editorial components + dead hooks (D5-rest)

- [ ] `git rm src/components/app-sidebar.tsx src/components/app-sidebar-client.tsx src/components/store-selector.tsx src/components/logout-dialog.tsx src/components/invoice-sync-button.tsx src/components/otter-sync-button.tsx src/components/skeletons.tsx src/components/dashboard/route-error.tsx src/components/dashboard/sort-affordance.tsx src/components/recipe/provenance-chip.tsx src/components/forecast/transfer-source-caption.tsx src/hooks/use-is-phone.ts src/hooks/use-invoice-sync.ts src/hooks/use-sync-progress.ts src/lib/logout.ts "src/app/(mobile)/m/more/switch-to-desktop.tsx"`
- [ ] Gate; commit — `chore: delete retired editorial shell components`.

### Task 16: Delete dead server actions + auth forms (D6)

- [ ] `git rm` the 10 zero-importer actions, the 7 test-only actions **plus their tests**, `src/app/actions/_shared/{auth-scope,date-range,variance}.ts`, `src/app/login/components/login-form.tsx`, `src/app/signup/[token]/components/signup-form.tsx` (exact list in spec §3 D6; verify each with the tranche grep first — an action imported by a *live* page aborts that file).
- [ ] Gate; commit — `chore: delete pre-Counter server actions`.

### Task 17: Delete lib orphans + dead API routes (D7, D8)

- [ ] `git rm` spec §3 D7's list (including `src/lib/cogs.ts` — verify with the exact-specifier grep `grep -rn '"@/lib/cogs"' src scripts tests e2e`, which returned 0 at audit time). For `labor-week.ts`, delete only the dead exports (`LABOR_OVERBUDGET_THRESHOLD`, `buildLaborWeekWindow`, `aggregateLaborWeek`, `groupAlertsByDate`) and keep the four date helpers; run its test file after.
- [ ] `git rm -r` the six D8 route directories. For `api/cron/harri-employees`: `grep -rn "harri-employees" .github scripts vercel.json src` — if the only runner is the workflow's `npx tsx scripts/backfill-harri-employees.ts`, delete the route too; otherwise keep and note.
- [ ] Delete `tests/lib/dashboard/*` (the 7 files) minus any covering `model-call`/`splh-fold`, `tests/app/actions/product-usage/*`, and any other test whose import target died here.
- [ ] Gate + `npm run build`; commit — `chore: delete orphaned lib modules and unreachable API routes`.

### Task 18: Dependency + config hygiene (D9)

- [ ] `npm uninstall @dnd-kit/core @dnd-kit/modifiers @dnd-kit/sortable @dnd-kit/utilities react-pdf @tanstack/react-table @tanstack/react-virtual @hookform/resolvers vaul embla-carousel-react input-otp next-themes`
- [ ] For each of `@tanstack/react-query @tanstack/react-query-devtools react-hook-form react-day-picker class-variance-authority clsx tailwind-merge cmdk` and every `@radix-ui/*`: `grep -rln "from [\"']<dep>" src scripts --include="*.ts*" | grep -v generated` — uninstall the ones with 0 hits post-deletion.
- [ ] Remove `"./src/pages/**"`-style glob from `tailwind.config.ts` `content` (no `src/pages` exists).
- [ ] Gate + `npm run build`; commit — `chore: drop dependencies nothing imports`.

### Task 19: Untrack committed scratch (tmp/, debug png)

- [ ] `git rm -r --cached tmp && git rm --cached debug-harri-login.png` then delete the png from disk too (`rm debug-harri-login.png`) — the `tmp/` *working copies* stay on disk for the user to triage; only tracking ends.
- [ ] Append to `.gitignore`: `/tmp/` and `/debug-*.png`.
- [ ] Gate; commit — `chore: untrack one-off scratch scripts and data dumps`. Note in the PR/summary: `tmp/` contained invoice/vendor CSV data; history still holds it — a history rewrite is a separate decision for the user.

---

## Phase 4 — Enforcement + prose

### Task 20: Patch the linter's three holes

**Files:** Modify `scripts/counter-lint.ts` (`DIRECT_DATA_IMPORT` ~`:266`, rule registration ~`:336`, `COLOUR_LITERAL`), plus whatever it newly flags.

- [ ] **Step 1:** Extend `DIRECT_DATA_IMPORT` to match `@/generated/prisma` (any subpath) alongside `@/lib/prisma` and `@/app/actions/`; delete the dead `@prisma/client` alternative or keep it harmless.
- [ ] **Step 2:** Register `no-direct-data-import` for `extensions: [".ts", ".tsx"]`, and let a line beginning `import type ` pass — type imports erase at build; the rule polices data access. (This keeps `url-state.ts`/`alert-filters.ts`/`channel-mix.ts`/`counter-alerts-client.tsx` legal as type-importers; any *value* import outside `DATA_ALLOWED` now fails.)
- [ ] **Step 3:** Add `\bcolor-mix\(` to `COLOUR_LITERAL` (match the twin in `tests/styles/counter-components.test.ts:156`). For `counter-repairs.css`'s token-only uses (lines ~1181-1182, 1199-1203, 1396, 1445-1446): find the linter's sanctioned suppression mechanism (`grep -n "suppress\|allow\|LEGACY" scripts/counter-lint.ts` and its docblock names "narrow allowlist / inline suppression") and apply the inline form with a dated reason on each line; if only file-level allowlisting exists, allowlist `counter-repairs.css` for the colour rule with a comment stating every input is a token and the risk taken.
- [ ] **Step 4:** `npm run tokens` — drive to "Counter rules: clean" by fixing what it flags, not by widening allowlists (except as Step 3 sanctions). Then full gate.
- [ ] **Step 5:** Commit — `fix(lint): see .ts files, the generated prisma specifier, and color-mix`.

### Task 21: Migrate `counter-components.css`'s hidden non-shadow literals

**Files:** Modify `src/styles/counter-repairs.css` (additions), following the exact precedent at `counter-repairs.css:127,146` (`.mdot.PUZZLE`, `.qbtn .n`).

- [ ] For each of `counter-components.css` `:119` (`.navbtn .badge` colour), `:247` (`.classtag.PUZZLE` bg+colour), `:765` (`.statebar button[aria-pressed="true"]` colour), `:782` (`.loginmsg.is-warn .fi`), `:901-904` (`.toast`, `.toast i`): add an override rule in `counter-repairs.css` mapping the literal to the nearest `ct-` token in `counter.css` (pick by computed value in both themes — check the token table in `DESIGN.md`), with the same comment style as the two existing repairs. Do not edit `counter-components.css` itself (it is the ported prototype sheet; that's why the repairs file exists).
- [ ] Verify no visual drift: `npm run fidelity` (both themes are asserted by test per CLAUDE.md).
- [ ] Gate; commit — `fix(counter): repair the literal colours the components-sheet allowlist hid`.

### Task 22: Stale prose sweep

- [ ] `scripts/counter-lint.ts:405` — rewrite the LEGACY reason: `editorial-dashboard.css` is deleted; `:139` — "five redirect shims outside the groups", not "~19 editorial pages".
- [ ] `scripts/counter-lint.ts:797-802` + `DESIGN.md:246-254` — update the exemption notes: four of the six routes now use the `Promise.all` shape the pattern cannot see; the exemptions stand on the single-load argument, restate it accurately.
- [ ] `docs/refactor-playbook.md:123` — the repo has 33 npm scripts including `typecheck`; fix the sentence.
- [ ] `DESIGN.md` — one paragraph noting `(mobile)/m/login` is a Counter page outside `(counter)` and therefore outside rules 7/8's scope (deliberate, revisit if it ever loads data).
- [ ] Gate (token-parity test reads text — avoid naming pre-Counter classes verbatim; describe, don't quote).
- [ ] Commit — `docs: catch the lint and design prose up to the tree it describes`.

---

## Phase 5 — Monitoring all-tenant reads (BLOCKED on owner decision)

### Task 23: Gate or scope the monitoring surfaces

Waits on the user choosing spec §5 option (a) role-gate, (b) account-scope, or (c) both. Once chosen:

- Option (a): add a `role === "DEVELOPER"` check where the monitoring routes resolve their session (both `(counter)` groups' monitoring pages / their shared adapter entry), returning the counter 403/forbidden surface that already exists (`(counter)/forbidden`); update `monitoring.ts`'s docblock, which currently concedes the gate is vacuous.
- Option (b): thread `accountId` through `monitoring-people.ts` / `monitoring-ingredients.ts` / `monitoring-ml.ts` / `monitoring-tabs.ts:479` queries the way Phase 1 did, leaving the infra tables (`JobRun`, `ErrorEvent`, `CacheStat`, `DbSnapshot`, `R2BucketSnapshot`, `AiUsageEvent`, `ExternalSignalSyncRun`) global.
- Either way: test in the Phase-1 style, gate, commit.

---

## Self-review notes

- Spec §1 L1-L8 → Tasks 1-6. §2 F1-F5 → Tasks 7-11. §3 D1-D9 → Tasks 12-19. §4 → Tasks 20-22. §5 → Task 23. No spec item unowned; `scripts/` orphans deliberately out of scope (spec §3 hazards).
- Deletion lists intentionally live once (spec §3) with task-level exact `git rm` lines where short; executors of Tasks 16-17 must open the spec — it ships beside the plan.
- Known judgment points flagged inline: Task 4 (relation shape check), Task 10 (map-consumer check), Task 14 (`tool-labels` location), Task 17 (`harri-employees` verify), Task 20 Step 3 (suppression mechanism).
