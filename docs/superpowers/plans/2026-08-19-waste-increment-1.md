# Waste Without Counts — Increment 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make delivered quantities and theoretical usage correct, so that λ (delivered ÷ theoretical) means what it says — without building any waste number yet.

**Architecture:** Three new pure modules plus one I/O wrapper. `delivered-qty.ts` replaces a lossy single-step unit conversion with an explicit four-step ladder that reports its path instead of silently returning zero. `theoretical-usage.ts` adds the modifier (sub-item) branch that the inventory path has always been missing, mirroring the traversal `buildModifierUsage` already proved correct. `conversion-guards.ts` provides two *ordered* guards: a recipe-free cost-consistency check that detects broken conversions, and a λ plausibility check that is only interpreted once the first passes. A coverage panel then reports which bucket every ingredient landed in.

**Tech Stack:** TypeScript, Next.js 16 App Router, Prisma 7/Postgres, vitest, Tailwind v4 with the project's editorial design tokens.

**Spec:** [`docs/superpowers/specs/2026-08-19-waste-without-counts-design.md`](../specs/2026-08-19-waste-without-counts-design.md)

## Global Constraints

- **No waste dollar figure is published in this increment.** No new page, no nav entry.
- **λ is a ratio of sums** (`Σdelivered ÷ Σtheoretical`), never a mean of per-window ratios.
- **Identity SKU matches (`fromUnit == toUnit`) are treated as absent.** 113 of 118 production rows are `CS → CS ×1` placeholders meaning "unknown", not "1:1". They must never short-circuit the case factor.
- **Cost-consistency is guard 1; λ plausibility is guard 2.** λ is not interpreted for an ingredient whose cost check fails.
- **An unconvertible line is a reported outcome, never a 0.**
- Dashboard UI: editorial tokens only (`--ink`, `--ink-muted`, `--ink-faint`, `--paper`, `--hairline`, `--hairline-bold`, `--accent`). No `bg-sky-*` / `text-emerald-*` etc. Sections are `.inv-panel`, not shadcn `<Card>`. Numbers render with `font-variant-numeric: tabular-nums lining-nums`; captions/labels use JetBrains Mono at `text-[10px] uppercase tracking-[0.18em]`. See [`DESIGN.md`](../../../DESIGN.md).
- Migrations: `prisma db push` + a hand-written `prisma/manual-migrations/YYYY-MM-DD_*.sql`. **Never `prisma migrate dev`** — it would reset the Neon production DB.
- Do not split or restructure any file >400 lines without reading [`docs/refactor-playbook.md`](../../refactor-playbook.md).
- Commit messages: no `Co-Authored-By: Claude` line.
- Whole-project gate before declaring done: `npm test && npx tsc --noEmit && npm run build`.
- Tests live in `tests/lib/**/*.test.ts` (vitest, node environment, `@` aliased to `src`).

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/inventory/delivered-qty.ts` (new) | The conversion ladder. Pure. One invoice line → quantity in recipe units + which path produced it. |
| `src/lib/inventory/theoretical-usage.ts` (new) | Sales → recipe usage per ingredient, including modifiers. Pure accumulator + thin Prisma wrapper. |
| `src/lib/inventory/conversion-guards.ts` (new) | The two ordered guards and the coverage bucket classifier. Pure. |
| `src/lib/inventory/usage-math.ts` (modify) | Loses `sumDeliveries` — superseded by the ladder. Keeps `convertQty`, `depletionWindow`, `sumDepletion`. |
| `src/lib/inventory/running-on-hand.ts` (modify) | Consumes the ladder. |
| `src/lib/inventory/store-inventory-context.ts` (modify) | Prefetches SKU factors and pack fields; consumes the ladder. |
| `src/app/actions/inventory/dashboard-actions.ts` (modify) | Selects the pack fields the ladder needs. |
| `src/app/actions/inventory/coverage-health-actions.ts` (modify) | Adds per-ingredient bucket classification. |
| `src/app/dashboard/operations/inventory/components/coverage-health-card.tsx` (modify) | Renders the buckets. |
| `scripts/propose-pack-metadata.ts` (new) | Proposes case factors from invoice pack data for owner review. Writes a review file; writes nothing to the DB. |
| `prisma/manual-migrations/2026-08-19_pack_metadata.sql` (new) | Applies owner-confirmed factors. |

---

### Task 1: The conversion ladder

**Files:**
- Create: `src/lib/inventory/delivered-qty.ts`
- Test: `tests/lib/inventory/delivered-qty.test.ts`

**Interfaces:**
- Consumes: `convertQty` from `src/lib/inventory/usage-math.ts`
- Produces: `deliveredQtyInRecipeUnit(line, ingredient, skuFactor) → DeliveredQtyResult`, `sumDeliveredQty(lines, ingredient, skuFactorFor) → SumDeliveredResult`, `isIdentitySkuFactor(f) → boolean`, and types `DeliveryConversionPath`, `DeliveryLineInput`, `IngredientPackInfo`, `SkuFactor`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/inventory/delivered-qty.test.ts`:

```ts
// The delivery half of the inventory maths used to run through convertQty
// alone, which knows nothing about cases. Invoices bill in CS; recipes consume
// each/lb/oz/leaf, so 63% of delivered dollars silently contributed zero.
// These tests pin the ladder that replaces it — above all that an identity
// SKU match ("CS -> CS x1", 113 of 118 production rows) is treated as absent
// rather than as a 1:1 conversion.

import { describe, it, expect } from "vitest"
import {
  deliveredQtyInRecipeUnit,
  sumDeliveredQty,
  isIdentitySkuFactor,
  type IngredientPackInfo,
  type SkuFactor,
} from "@/lib/inventory/delivered-qty"

const buns: IngredientPackInfo = {
  recipeUnit: "each",
  caseUnit: "CS",
  recipeUnitsPerCase: 72,
}

const beef: IngredientPackInfo = {
  recipeUnit: "lb",
  caseUnit: null,
  recipeUnitsPerCase: null,
}

const identity: SkuFactor = { fromUnit: "CS", toUnit: "CS", conversionFactor: 1 }
const realFactor: SkuFactor = { fromUnit: "GAL", toUnit: "each", conversionFactor: 160 }

describe("isIdentitySkuFactor", () => {
  it("treats fromUnit == toUnit as carrying no knowledge", () => {
    expect(isIdentitySkuFactor(identity)).toBe(true)
    expect(isIdentitySkuFactor({ fromUnit: "cs", toUnit: " CS ", conversionFactor: 1 })).toBe(true)
    expect(isIdentitySkuFactor(realFactor)).toBe(false)
  })
})

describe("deliveredQtyInRecipeUnit", () => {
  it("converts a case line via recipeUnitsPerCase", () => {
    const r = deliveredQtyInRecipeUnit({ quantity: 20, unit: "CS", sku: "00500520" }, buns, undefined)
    expect(r).toEqual({ qty: 1440, path: "case_factor" })
  })

  it("matches caseUnit case-insensitively", () => {
    const r = deliveredQtyInRecipeUnit({ quantity: 2, unit: "cs", sku: null }, buns, undefined)
    expect(r).toEqual({ qty: 144, path: "case_factor" })
  })

  it("does NOT let an identity sku match short-circuit the case factor", () => {
    const r = deliveredQtyInRecipeUnit({ quantity: 20, unit: "CS", sku: "00500520" }, buns, identity)
    expect(r).toEqual({ qty: 1440, path: "case_factor" })
  })

  it("uses a real sku factor when there is no case factor", () => {
    const syrup: IngredientPackInfo = { recipeUnit: "each", caseUnit: null, recipeUnitsPerCase: null }
    const r = deliveredQtyInRecipeUnit({ quantity: 2, unit: "GAL", sku: "G299" }, syrup, realFactor)
    expect(r).toEqual({ qty: 320, path: "sku_factor" })
  })

  it("falls through an identity sku match to plain unit conversion", () => {
    const r = deliveredQtyInRecipeUnit({ quantity: 5, unit: "LB", sku: "15726" }, beef, {
      fromUnit: "lb",
      toUnit: "lb",
      conversionFactor: 1,
    })
    expect(r).toEqual({ qty: 5, path: "unit_convert" })
  })

  it("reports unconvertible instead of returning zero", () => {
    const lettuce: IngredientPackInfo = { recipeUnit: "leaf", caseUnit: null, recipeUnitsPerCase: null }
    const r = deliveredQtyInRecipeUnit({ quantity: 3, unit: "CS", sku: null }, lettuce, undefined)
    expect(r).toEqual({ qty: null, path: "unconvertible" })
  })

  it("reports unconvertible when the ingredient has no recipeUnit", () => {
    const mayo: IngredientPackInfo = { recipeUnit: null, caseUnit: null, recipeUnitsPerCase: null }
    const r = deliveredQtyInRecipeUnit({ quantity: 4, unit: "CS", sku: null }, mayo, undefined)
    expect(r).toEqual({ qty: null, path: "unconvertible" })
  })
})

describe("sumDeliveredQty", () => {
  it("totals per path and never folds an unconvertible line into 0", () => {
    const r = sumDeliveredQty(
      [
        { quantity: 20, unit: "CS", sku: "a" },
        { quantity: 1, unit: "CS", sku: "b" },
        { quantity: 9, unit: "banana", sku: "c" },
      ],
      buns,
      () => undefined,
    )
    expect(r.deliveriesQty).toBe(1512)
    expect(r.byPath.case_factor).toEqual({ lines: 2, qty: 1512 })
    expect(r.unconvertibleLines).toBe(1)
    expect(r.partial).toBe(true)
  })

  it("is not partial when every line converts", () => {
    const r = sumDeliveredQty([{ quantity: 1, unit: "CS", sku: null }], buns, () => undefined)
    expect(r.partial).toBe(false)
    expect(r.unconvertibleLines).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/inventory/delivered-qty.test.ts`
Expected: FAIL — cannot resolve `@/lib/inventory/delivered-qty`

- [ ] **Step 3: Write the implementation**

Create `src/lib/inventory/delivered-qty.ts`:

```ts
import { convertQty } from "@/lib/inventory/usage-math"

/**
 * How an invoice line's quantity was converted into the ingredient's
 * recipeUnit. Reported rather than inferred, so a surface can say how much of
 * a total it actually knows.
 */
export type DeliveryConversionPath =
  | "case_factor"
  | "sku_factor"
  | "unit_convert"
  | "unconvertible"

export interface DeliveryLineInput {
  quantity: number
  unit: string | null
  /** Vendor SKU as printed on the invoice line. */
  sku: string | null
}

export interface IngredientPackInfo {
  recipeUnit: string | null
  caseUnit: string | null
  recipeUnitsPerCase: number | null
}

export interface SkuFactor {
  fromUnit: string
  toUnit: string
  conversionFactor: number
}

export interface DeliveredQtyResult {
  /** Quantity in the ingredient's recipeUnit; null when no path applied. */
  qty: number | null
  path: DeliveryConversionPath
}

function normUnit(u: string | null | undefined): string {
  return (u ?? "").trim().toLowerCase()
}

/**
 * True when a SKU match carries no conversion knowledge. 113 of the 118 rows
 * in production are `CS -> CS x1`: that encodes "unknown", not "1:1", and must
 * never pre-empt a real case factor.
 */
export function isIdentitySkuFactor(f: SkuFactor): boolean {
  return normUnit(f.fromUnit) === normUnit(f.toUnit)
}

export function deliveredQtyInRecipeUnit(
  line: DeliveryLineInput,
  ingredient: IngredientPackInfo,
  skuFactor: SkuFactor | undefined,
): DeliveredQtyResult {
  const perCase = ingredient.recipeUnitsPerCase

  // 1. A case-level line where we know how many recipe units are in a case.
  if (
    perCase != null &&
    perCase > 0 &&
    ingredient.caseUnit != null &&
    normUnit(line.unit) === normUnit(ingredient.caseUnit)
  ) {
    return { qty: line.quantity * perCase, path: "case_factor" }
  }

  // 2. A SKU match that actually changes units.
  if (skuFactor && !isIdentitySkuFactor(skuFactor)) {
    return { qty: line.quantity * skuFactor.conversionFactor, path: "sku_factor" }
  }

  // 3. Plain within-family unit conversion.
  const recipeUnit = ingredient.recipeUnit ?? ""
  if (recipeUnit) {
    const q = convertQty(line.quantity, line.unit ?? recipeUnit, recipeUnit)
    if (q != null) return { qty: q, path: "unit_convert" }
  }

  return { qty: null, path: "unconvertible" }
}

export interface SumDeliveredResult {
  deliveriesQty: number
  byPath: Record<DeliveryConversionPath, { lines: number; qty: number }>
  /** Lines that produced no quantity. Never silently folded into 0. */
  unconvertibleLines: number
  /** True when the total understates reality. Replaces the old `partial`. */
  partial: boolean
}

/**
 * Generic over the line type so callers can carry extra fields (a vendor key,
 * an invoice date) through to `skuFactorFor` without a cast.
 */
export function sumDeliveredQty<T extends DeliveryLineInput>(
  lines: T[],
  ingredient: IngredientPackInfo,
  skuFactorFor: (line: T) => SkuFactor | undefined,
): SumDeliveredResult {
  const byPath: Record<DeliveryConversionPath, { lines: number; qty: number }> = {
    case_factor: { lines: 0, qty: 0 },
    sku_factor: { lines: 0, qty: 0 },
    unit_convert: { lines: 0, qty: 0 },
    unconvertible: { lines: 0, qty: 0 },
  }
  let deliveriesQty = 0

  for (const line of lines) {
    const { qty, path } = deliveredQtyInRecipeUnit(line, ingredient, skuFactorFor(line))
    byPath[path].lines += 1
    if (qty == null) continue
    byPath[path].qty += qty
    deliveriesQty += qty
  }

  return {
    deliveriesQty,
    byPath,
    unconvertibleLines: byPath.unconvertible.lines,
    partial: byPath.unconvertible.lines > 0,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/inventory/delivered-qty.test.ts`
Expected: PASS, 11 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory/delivered-qty.ts tests/lib/inventory/delivered-qty.test.ts
git commit -m "feat(inventory): conversion ladder that reports its path

convertQty alone drops 63% of delivered dollars because invoices bill in
cases. The ladder tries case factor, then a non-identity SKU factor, then
plain conversion, and reports unconvertible rather than contributing 0."
```

---

### Task 2: Rewire the delivery readers onto the ladder

**Files:**
- Modify: `src/lib/inventory/usage-math.ts` (remove `sumDeliveries` and `DeliveryLine`)
- Modify: `src/lib/inventory/store-inventory-context.ts`
- Modify: `src/lib/inventory/running-on-hand.ts`
- Modify: `src/app/actions/inventory/dashboard-actions.ts:88` (ingredient select)
- Modify: `tests/lib/inventory/store-inventory-context.test.ts`

**Interfaces:**
- Consumes: `sumDeliveredQty`, `SkuFactor`, `IngredientPackInfo` from Task 1
- Produces: `ContextIngredient` gains `caseUnit: string | null` and `recipeUnitsPerCase: number | null`; `StoreInventoryContext` gains `skuFactorByKey: Map<string, SkuFactor>`; `RunningOnHandResult` gains `deliveryPaths: SumDeliveredResult["byPath"]`

- [ ] **Step 1: Find every caller before changing anything**

Run: `grep -rn "sumDeliveries\|DeliveryLine" src tests`
Expected: hits in `usage-math.ts`, `running-on-hand.ts`, `store-inventory-context.ts`, `tests/lib/inventory/store-inventory-context.test.ts`. Note each one — all four are updated in this task.

- [ ] **Step 2: Write the failing test**

Add to `tests/lib/inventory/store-inventory-context.test.ts`, inside the existing top-level `describe` block for the batched readers (append at end of file):

```ts
describe("runningOnHandFromContext — delivery conversion", () => {
  it("converts case-billed deliveries via the ingredient pack factor", () => {
    const ctx: StoreInventoryContext = {
      storeId: "s1",
      asOf: new Date("2026-08-18"),
      lookbackDays: 14,
      recipeGraph: new Map(),
      recipeByItemName: new Map(),
      sales: [],
      lastCountByIngredient: new Map(),
      deliveriesByIngredient: new Map([
        ["bun", [{ quantity: 20, unit: "CS", sku: "00500520", invoiceDate: new Date("2026-08-01") }]],
      ]),
      adjustmentsByIngredient: new Map(),
      skuFactorByKey: new Map([
        // The production placeholder: identity, must not win over the case factor.
        ["sysco|00500520", { fromUnit: "CS", toUnit: "CS", conversionFactor: 1 }],
      ]),
    }

    const result = runningOnHandFromContext(ctx, {
      id: "bun",
      name: "martins bread potato roll sandwich 3.5 inch",
      recipeUnit: "each",
      caseUnit: "CS",
      recipeUnitsPerCase: 72,
    })

    expect(result.deliveriesQty).toBe(1440)
    expect(result.partial).toBe(false)
    expect(result.deliveryPaths.case_factor.lines).toBe(1)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/inventory/store-inventory-context.test.ts`
Expected: FAIL — `skuFactorByKey` is not a property of `StoreInventoryContext`, and `deliveryPaths` does not exist

- [ ] **Step 4: Delete `sumDeliveries` from usage-math.ts**

In `src/lib/inventory/usage-math.ts`, delete the `DeliveryLine` interface and the whole `sumDeliveries` function (they are superseded by `sumDeliveredQty`). Leave `convertQty`, `SoldItem`, `sumDepletion` and `depletionWindow` untouched.

Remove `sumDeliveries` from the import list at the top of `tests/lib/inventory/store-inventory-context.test.ts` and delete any existing test block that exercised it directly — its behaviour is now covered by `tests/lib/inventory/delivered-qty.test.ts`.

- [ ] **Step 5: Extend the context to carry SKU factors and pack fields**

In `src/lib/inventory/store-inventory-context.ts`:

Add imports:

```ts
import { sumDeliveredQty, type SkuFactor, type DeliveryLineInput } from "@/lib/inventory/delivered-qty"
import { vendorMatchKey } from "@/lib/vendor-normalize"
```

Add to the `StoreInventoryContext` interface:

```ts
  /** `${vendorMatchKey(vendorName)}|${sku}` → factor. Identity rows included; the ladder ignores them. */
  skuFactorByKey: Map<string, SkuFactor>
```

Extend `ContextIngredient`:

```ts
export interface ContextIngredient {
  id: string
  name: string
  recipeUnit: string | null
  caseUnit: string | null
  recipeUnitsPerCase: number | null
}
```

In `loadStoreInventoryContext`, extend the `deliveryLines` select and add a SKU-match query to the same `Promise.all`:

```ts
      prisma.invoiceLineItem.findMany({
        where: {
          canonicalIngredientId: { not: null },
          invoice: { storeId: input.storeId, invoiceDate: { lte: asOf } },
        },
        select: {
          canonicalIngredientId: true,
          quantity: true,
          unit: true,
          sku: true,
          invoice: { select: { invoiceDate: true, vendorName: true } },
        },
      }),
      prisma.ingredientSkuMatch.findMany({
        where: { accountId: input.accountId },
        select: { vendorKey: true, sku: true, fromUnit: true, toUnit: true, conversionFactor: true },
      }),
```

Destructure the extra result (`skuMatches`) alongside the others, then build the map and stamp the vendor key onto each delivery line:

```ts
  const skuFactorByKey = new Map<string, SkuFactor>(
    skuMatches.map((m) => [
      `${m.vendorKey}|${m.sku}`,
      { fromUnit: m.fromUnit, toUnit: m.toUnit, conversionFactor: m.conversionFactor },
    ]),
  )
```

Change the `deliveriesByIngredient` bucket type to carry `sku` and the vendor key. Replace the existing push with:

```ts
    bucket.push({
      quantity: line.quantity,
      unit: line.unit,
      sku: line.sku,
      vendorKey: vendorMatchKey(line.invoice.vendorName ?? ""),
      invoiceDate: line.invoice.invoiceDate,
    })
```

and widen the map's declared type accordingly:

```ts
  const deliveriesByIngredient = new Map<
    string,
    Array<DeliveryLineInput & { vendorKey: string; invoiceDate: Date }>
  >()
```

Return `skuFactorByKey` in the context object.

- [ ] **Step 6: Consume the ladder in `runningOnHandFromContext`**

Replace the `sumDeliveries` call in `runningOnHandFromContext` with:

```ts
  const deliveryLines = (ctx.deliveriesByIngredient.get(ingredient.id) ?? []).filter(
    (l) => l.invoiceDate >= sinceFilter,
  )
  const delivered = sumDeliveredQty(
    deliveryLines,
    {
      recipeUnit: ingredient.recipeUnit,
      caseUnit: ingredient.caseUnit,
      recipeUnitsPerCase: ingredient.recipeUnitsPerCase,
    },
    (line) => ctx.skuFactorByKey.get(`${line.vendorKey}|${line.sku ?? ""}`),
  )
```

`line.vendorKey` resolves without a cast because `sumDeliveredQty` is generic over the line type and the context's buckets carry `vendorKey`.

Use `delivered.deliveriesQty` where `deliveriesQty` was used, `delivered.partial` where `partial` was used, and add `deliveryPaths: delivered.byPath` to the returned object. Add the matching field to `RunningOnHandResult` in `src/lib/inventory/running-on-hand.ts`:

```ts
  /** Per-path delivery conversion tallies. Says how much of `deliveriesQty` is known. */
  deliveryPaths: SumDeliveredResult["byPath"]
```

- [ ] **Step 7: Apply the same change to the per-ingredient reader**

In `src/lib/inventory/running-on-hand.ts`, extend the delivery query select to `{ quantity: true, unit: true, sku: true, invoice: { select: { vendorName: true } } }`, load the account's SKU matches, and call `sumDeliveredQty` with the same pack fields. `computeRunningOnHand` must return the identical numbers as `runningOnHandFromContext` for the same inputs — that equivalence is the reason both exist.

The function needs the ingredient's pack fields, so widen its `canonicalIngredient.findUnique` select:

```ts
    select: { id: true, name: true, recipeUnit: true, caseUnit: true, recipeUnitsPerCase: true, accountId: true },
```

- [ ] **Step 8: Feed the pack fields from the dashboard action**

In `src/app/actions/inventory/dashboard-actions.ts`, widen the ingredient select (currently line ~88):

```ts
      select: {
        id: true,
        name: true,
        category: true,
        recipeUnit: true,
        caseUnit: true,
        recipeUnitsPerCase: true,
      },
```

- [ ] **Step 9: Run the full inventory suite**

Run: `npx vitest run tests/lib/inventory/`
Expected: PASS, including the new case-factor test and every pre-existing test

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `ContextIngredient` widening breaks another caller, fix that caller — do not loosen the type.

- [ ] **Step 11: Commit**

```bash
git add src/lib/inventory src/app/actions/inventory/dashboard-actions.ts tests/lib/inventory
git commit -m "fix(inventory): convert case-billed deliveries instead of dropping them

Both delivery readers now go through the ladder and carry per-path tallies,
so a total that understates reality says so instead of flagging a boolean
nothing acted on."
```

---

### Task 3: Theoretical usage including modifiers

**Files:**
- Create: `src/lib/inventory/theoretical-usage.ts`
- Test: `tests/lib/inventory/theoretical-usage.test.ts`

**Interfaces:**
- Consumes: `walkRecipeForIngredientSync`, `loadRecipeGraph`, `type RecipeGraph` from `src/lib/inventory/recipe-walk.ts`
- Produces: `accumulateUsage(input) → TheoreticalUsageResult` (pure), `computeTheoreticalUsage(input) → Promise<TheoreticalUsageResult>` (I/O), types `UsageIngredient`, `UsageOrderItem`, `TheoreticalUsageResult`

**Why order-level:** modifiers exist only as `OtterOrderSubItem` rows (264,466 of them). `OtterMenuItem` daily aggregates cannot express them, so both branches read from orders to avoid mixing two sources with different grain.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/inventory/theoretical-usage.test.ts`:

```ts
// The inventory path only ever walked OtterItemMapping, so every "Add Tomato"
// was invisible: tomato and onion read a theoretical usage of ~0 against
// thousands of dollars purchased. These tests pin the sub-item branch, whose
// `uses = subItem.quantity * orderItem.quantity` mirrors buildModifierUsage.

import { describe, it, expect } from "vitest"
import { accumulateUsage, type UsageOrderItem } from "@/lib/inventory/theoretical-usage"
import type { RecipeGraph } from "@/lib/inventory/recipe-walk"

const graph: RecipeGraph = new Map([
  // A slider: one bun.
  ["r-slider", [{ quantity: 1, unit: "each", canonicalIngredientId: "bun", componentRecipeId: null }]],
  // The "Add Tomato" modifier: 0.05 lb of tomato.
  ["r-add-tomato", [{ quantity: 0.05, unit: "lb", canonicalIngredientId: "tomato", componentRecipeId: null }]],
])

const ingredients = [
  { id: "bun", recipeUnit: "each" },
  { id: "tomato", recipeUnit: "lb" },
]

describe("accumulateUsage", () => {
  it("counts base item usage from the item mapping", () => {
    const orderItems: UsageOrderItem[] = [
      { skuId: "sku-slider", name: "Single Patty Slider", quantity: 3, subItems: [] },
    ]
    const r = accumulateUsage({
      orderItems,
      graph,
      ingredients,
      recipeByItemSku: new Map([["sku-slider", "r-slider"]]),
      recipeByItemName: new Map(),
      recipeBySubItemSku: new Map(),
    })
    expect(r.byIngredient.get("bun")).toBe(3)
  })

  it("multiplies modifier uses by the parent item quantity", () => {
    const orderItems: UsageOrderItem[] = [
      {
        skuId: "sku-slider",
        name: "Single Patty Slider",
        quantity: 2,
        subItems: [{ skuId: "sku-add-tomato", quantity: 1 }],
      },
    ]
    const r = accumulateUsage({
      orderItems,
      graph,
      ingredients,
      recipeByItemSku: new Map([["sku-slider", "r-slider"]]),
      recipeByItemName: new Map(),
      recipeBySubItemSku: new Map([["sku-add-tomato", "r-add-tomato"]]),
    })
    // 2 sliders x 1 tomato modifier = 2 uses x 0.05 lb
    expect(r.byIngredient.get("tomato")).toBeCloseTo(0.1, 10)
    expect(r.byIngredient.get("bun")).toBe(2)
  })

  it("falls back to the item name when the sku is unmapped", () => {
    const orderItems: UsageOrderItem[] = [
      { skuId: "unknown-sku", name: "Single Patty Slider", quantity: 1, subItems: [] },
    ]
    const r = accumulateUsage({
      orderItems,
      graph,
      ingredients,
      recipeByItemSku: new Map(),
      recipeByItemName: new Map([["Single Patty Slider", "r-slider"]]),
      recipeBySubItemSku: new Map(),
    })
    expect(r.byIngredient.get("bun")).toBe(1)
  })

  it("records unmapped skus rather than dropping them silently", () => {
    const orderItems: UsageOrderItem[] = [
      {
        skuId: "mystery-item",
        name: "Mystery",
        quantity: 1,
        subItems: [{ skuId: "mystery-mod", quantity: 1 }],
      },
    ]
    const r = accumulateUsage({
      orderItems,
      graph,
      ingredients,
      recipeByItemSku: new Map(),
      recipeByItemName: new Map(),
      recipeBySubItemSku: new Map(),
    })
    expect(r.unmappedItemSkus.has("mystery-item")).toBe(true)
    expect(r.unmappedSubItemSkus.has("mystery-mod")).toBe(true)
    expect(r.byIngredient.size).toBe(0)
  })

  it("counts a modifier on an unmapped parent item", () => {
    // The parent has no recipe, but the modifier still consumes tomato.
    const orderItems: UsageOrderItem[] = [
      {
        skuId: "mystery-item",
        name: "Mystery",
        quantity: 2,
        subItems: [{ skuId: "sku-add-tomato", quantity: 1 }],
      },
    ]
    const r = accumulateUsage({
      orderItems,
      graph,
      ingredients,
      recipeByItemSku: new Map(),
      recipeByItemName: new Map(),
      recipeBySubItemSku: new Map([["sku-add-tomato", "r-add-tomato"]]),
    })
    expect(r.byIngredient.get("tomato")).toBeCloseTo(0.1, 10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/inventory/theoretical-usage.test.ts`
Expected: FAIL — cannot resolve `@/lib/inventory/theoretical-usage`

- [ ] **Step 3: Write the implementation**

Create `src/lib/inventory/theoretical-usage.ts`:

```ts
import { prisma } from "@/lib/prisma"
import {
  loadRecipeGraph,
  walkRecipeForIngredientSync,
  type RecipeGraph,
} from "@/lib/inventory/recipe-walk"

export interface UsageIngredient {
  id: string
  recipeUnit: string
}

export interface UsageSubItem {
  skuId: string
  quantity: number
}

export interface UsageOrderItem {
  skuId: string
  name: string
  quantity: number
  subItems: UsageSubItem[]
}

export interface TheoreticalUsageResult {
  /** ingredientId → quantity consumed, in that ingredient's recipeUnit. */
  byIngredient: Map<string, number>
  unmappedItemSkus: Set<string>
  unmappedSubItemSkus: Set<string>
}

export interface AccumulateUsageInput {
  orderItems: UsageOrderItem[]
  graph: RecipeGraph
  ingredients: UsageIngredient[]
  /** Preferred item identity. */
  recipeByItemSku: Map<string, string>
  /** Legacy fallback for mappings that predate stable SKUs. */
  recipeByItemName: Map<string, string>
  recipeBySubItemSku: Map<string, string>
}

/**
 * Pure accumulator. Walks each mapped recipe once per ingredient and memoises
 * the per-serving quantity, so a 60-recipe / 76-ingredient pantry costs a few
 * thousand in-memory walks rather than a query each.
 *
 * The sub-item branch mirrors `buildModifierUsage` in cogs-materializer.ts:
 * `uses = subItem.quantity * orderItem.quantity`. Any divergence between the
 * two is a bug in one of them.
 */
export function accumulateUsage(input: AccumulateUsageInput): TheoreticalUsageResult {
  const { orderItems, graph, ingredients, recipeByItemSku, recipeByItemName, recipeBySubItemSku } = input

  const byIngredient = new Map<string, number>()
  const unmappedItemSkus = new Set<string>()
  const unmappedSubItemSkus = new Set<string>()
  const perServing = new Map<string, number>()

  const perServingFor = (recipeId: string, ing: UsageIngredient): number => {
    const key = `${recipeId}|${ing.id}`
    const cached = perServing.get(key)
    if (cached !== undefined) return cached
    const qty = walkRecipeForIngredientSync(graph, recipeId, ing.id, ing.recipeUnit)
    perServing.set(key, qty)
    return qty
  }

  const addUsage = (recipeId: string, uses: number) => {
    if (!isFinite(uses) || uses <= 0) return
    for (const ing of ingredients) {
      const per = perServingFor(recipeId, ing)
      if (per === 0) continue
      byIngredient.set(ing.id, (byIngredient.get(ing.id) ?? 0) + per * uses)
    }
  }

  for (const item of orderItems) {
    const itemQty = item.quantity
    const recipeId = recipeByItemSku.get(item.skuId) ?? recipeByItemName.get(item.name)
    if (recipeId) addUsage(recipeId, itemQty)
    else unmappedItemSkus.add(item.skuId)

    for (const sub of item.subItems) {
      const modRecipeId = recipeBySubItemSku.get(sub.skuId)
      if (!modRecipeId) {
        unmappedSubItemSkus.add(sub.skuId)
        continue
      }
      addUsage(modRecipeId, sub.quantity * itemQty)
    }
  }

  return { byIngredient, unmappedItemSkus, unmappedSubItemSkus }
}

/** Thin Prisma wrapper around `accumulateUsage`. All maths lives in the pure function. */
export async function computeTheoreticalUsage(input: {
  storeId: string
  accountId: string
  from: Date
  to: Date
  ingredients: UsageIngredient[]
}): Promise<TheoreticalUsageResult> {
  const [graph, itemMappings, subMappings, orderItems] = await Promise.all([
    loadRecipeGraph(input.accountId),
    prisma.otterItemMapping.findMany({
      where: { storeId: input.storeId },
      select: { otterItemName: true, skuId: true, recipeId: true },
    }),
    prisma.otterSubItemMapping.findMany({
      where: { storeId: input.storeId },
      select: { skuId: true, recipeId: true },
    }),
    prisma.otterOrderItem.findMany({
      where: {
        order: {
          storeId: input.storeId,
          referenceTimeLocal: { gte: input.from, lte: input.to },
        },
      },
      select: {
        skuId: true,
        name: true,
        quantity: true,
        subItems: { select: { skuId: true, quantity: true } },
      },
    }),
  ])

  const recipeByItemSku = new Map<string, string>()
  const recipeByItemName = new Map<string, string>()
  for (const m of itemMappings) {
    if (m.skuId) recipeByItemSku.set(m.skuId, m.recipeId)
    recipeByItemName.set(m.otterItemName, m.recipeId)
  }

  return accumulateUsage({
    orderItems,
    graph,
    ingredients: input.ingredients,
    recipeByItemSku,
    recipeByItemName,
    recipeBySubItemSku: new Map(subMappings.map((m) => [m.skuId, m.recipeId])),
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/inventory/theoretical-usage.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory/theoretical-usage.ts tests/lib/inventory/theoretical-usage.test.ts
git commit -m "feat(inventory): theoretical usage that counts modifiers

Tomato and onion are bought by the case and consumed almost entirely through
Add-Tomato / Add-Onion modifiers, which the inventory path never walked. The
sub-item branch mirrors buildModifierUsage so the two cannot drift."
```

---

### Task 4: The two ordered guards

**Files:**
- Create: `src/lib/inventory/conversion-guards.ts`
- Test: `tests/lib/inventory/conversion-guards.test.ts`

**Interfaces:**
- Consumes: nothing (pure)
- Produces: `checkCostConsistency(input) → CostConsistencyResult`, `classifyLambdaPlausibility(input) → LambdaVerdict`, `classifyIngredientCoverage(input) → IngredientCoverageBucket`, `NON_RECIPE_CONSUMABLE_NAMES`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/inventory/conversion-guards.test.ts`:

```ts
// Two guards, deliberately ordered. The cost check needs no recipe coverage,
// so it catches a broken pack factor on patty paper and t-shirt bags, which
// lambda can never evaluate. Lambda is only interpretable once cost passes:
// onion and butter convert correctly and still read 10.8 and 21.8, which is a
// recipe problem, not a pack problem. An earlier draft of the design conflated
// the two; these tests exist so they cannot collapse again.

import { describe, it, expect } from "vitest"
import {
  checkCostConsistency,
  classifyLambdaPlausibility,
  classifyIngredientCoverage,
} from "@/lib/inventory/conversion-guards"

describe("checkCostConsistency", () => {
  it("passes when implied cost matches the stored cost", () => {
    // Ground beef: $120,500 over 27,111 lb = $4.445 vs stored $4.39
    const r = checkCostConsistency({ spend: 120500, deliveredQty: 27111, costPerRecipeUnit: 4.39 })
    expect(r.verdict).toBe("ok")
    expect(r.ratio).toBeCloseTo(1.012, 2)
  })

  it("flags the house sauce cup, whose case factor is missing", () => {
    // $30,002 over 402 "each" implies $74.63 against a stored $0.66
    const r = checkCostConsistency({ spend: 30002, deliveredQty: 402, costPerRecipeUnit: 0.66 })
    expect(r.verdict).toBe("conversion_suspect")
  })

  it("flags lettuce, billed by the case with no case factor", () => {
    // $5,744 over 3,045 "leaf" implies $1.886 against a stored $0.149
    const r = checkCostConsistency({ spend: 5744, deliveredQty: 3045, costPerRecipeUnit: 0.149 })
    expect(r.verdict).toBe("conversion_suspect")
  })

  it("flags a factor that is too large as well as too small", () => {
    // Patty paper: implied $0.089 against a stored $10.56
    const r = checkCostConsistency({ spend: 2154, deliveredQty: 24202, costPerRecipeUnit: 10.56 })
    expect(r.verdict).toBe("conversion_suspect")
  })

  it("cannot judge without a stored cost or a delivered quantity", () => {
    expect(checkCostConsistency({ spend: 100, deliveredQty: 0, costPerRecipeUnit: 1 }).verdict).toBe("unknown")
    expect(checkCostConsistency({ spend: 100, deliveredQty: 10, costPerRecipeUnit: null }).verdict).toBe("unknown")
  })
})

describe("classifyLambdaPlausibility", () => {
  it("accepts ground beef and fries", () => {
    expect(classifyLambdaPlausibility({ lambda: 1.25, windows: 6 })).toBe("ok")
    expect(classifyLambdaPlausibility({ lambda: 0.78, windows: 6 })).toBe("ok")
  })

  it("flags butter, whose recipes do not describe how it is used", () => {
    expect(classifyLambdaPlausibility({ lambda: 21.8, windows: 6 })).toBe("recipe_suspect")
  })

  it("refuses to judge on too few windows", () => {
    expect(classifyLambdaPlausibility({ lambda: 21.8, windows: 2 })).toBe("insufficient_data")
    expect(classifyLambdaPlausibility({ lambda: null, windows: 6 })).toBe("insufficient_data")
  })
})

describe("classifyIngredientCoverage", () => {
  const base = {
    name: "ground beef fine grnd 73/27 creekstone",
    costVerdict: "ok" as const,
    lambdaVerdict: "ok" as const,
    hasRecipePath: true,
  }

  it("calls a clean ingredient measurable", () => {
    expect(classifyIngredientCoverage(base)).toBe("measurable")
  })

  it("puts a failed cost check ahead of lambda", () => {
    // Guard order matters: a broken conversion makes lambda meaningless.
    expect(
      classifyIngredientCoverage({ ...base, costVerdict: "conversion_suspect", lambdaVerdict: "recipe_suspect" }),
    ).toBe("conversion_suspect")
  })

  it("reports a recipe problem only once conversion is sound", () => {
    expect(classifyIngredientCoverage({ ...base, lambdaVerdict: "recipe_suspect" })).toBe("recipe_suspect")
  })

  it("excludes non-recipe consumables by name before anything else", () => {
    expect(
      classifyIngredientCoverage({
        ...base,
        name: "sysco reliable shortening fry liquid clear ztf",
        hasRecipePath: false,
      }),
    ).toBe("non_recipe_consumable")
    expect(
      classifyIngredientCoverage({
        ...base,
        name: "container foam hinged white 9x6.5x2.5",
        hasRecipePath: false,
      }),
    ).toBe("non_recipe_consumable")
  })

  it("calls a purchased ingredient with no recipe path what it is", () => {
    expect(classifyIngredientCoverage({ ...base, name: "mystery powder", hasRecipePath: false })).toBe(
      "no_recipe_path",
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/inventory/conversion-guards.test.ts`
Expected: FAIL — cannot resolve `@/lib/inventory/conversion-guards`

- [ ] **Step 3: Write the implementation**

Create `src/lib/inventory/conversion-guards.ts`:

```ts
import { CONTAINER_CANDIDATE_NAMES } from "@/lib/container-packaging"

/** Ratio band for implied-vs-stored unit cost. Outside this, the pack factor is wrong. */
const COST_RATIO_MIN = 0.33
const COST_RATIO_MAX = 3.0

/** Plausibility band for lambda once conversion is trusted. */
const LAMBDA_MIN = 0.2
const LAMBDA_MAX = 5.0
const LAMBDA_MIN_WINDOWS = 3

export type CostVerdict = "ok" | "conversion_suspect" | "unknown"

export interface CostConsistencyResult {
  verdict: CostVerdict
  /** impliedCost / storedCost, or null when it could not be computed. */
  ratio: number | null
}

/**
 * Guard 1. Needs no recipe coverage at all, which is why it runs first: it is
 * the only check that can see a broken pack factor on an ingredient no recipe
 * consumes (patty paper, logo bags).
 */
export function checkCostConsistency(input: {
  spend: number
  deliveredQty: number
  costPerRecipeUnit: number | null
}): CostConsistencyResult {
  const { spend, deliveredQty, costPerRecipeUnit } = input
  if (deliveredQty <= 0 || costPerRecipeUnit == null || costPerRecipeUnit <= 0) {
    return { verdict: "unknown", ratio: null }
  }
  const ratio = spend / deliveredQty / costPerRecipeUnit
  if (ratio < COST_RATIO_MIN || ratio > COST_RATIO_MAX) {
    return { verdict: "conversion_suspect", ratio }
  }
  return { verdict: "ok", ratio }
}

export type LambdaVerdict = "ok" | "recipe_suspect" | "insufficient_data"

/**
 * Guard 2. Only meaningful once `checkCostConsistency` returns "ok" — a lambda
 * computed on a broken conversion says nothing about the recipes.
 */
export function classifyLambdaPlausibility(input: {
  lambda: number | null
  windows: number
}): LambdaVerdict {
  const { lambda, windows } = input
  if (lambda == null || !isFinite(lambda) || windows < LAMBDA_MIN_WINDOWS) {
    return "insufficient_data"
  }
  if (lambda < LAMBDA_MIN || lambda > LAMBDA_MAX) return "recipe_suspect"
  return "ok"
}

/**
 * Ingredients consumed per order rather than per recipe line. They can never
 * produce a lambda, so they are excluded by name and their spend reported as
 * excluded — not read as zero waste.
 */
export const NON_RECIPE_CONSUMABLE_NAMES: string[] = [
  ...CONTAINER_CANDIDATE_NAMES,
  "sysco reliable shortening fry liquid clear ztf",
  "container bagasse pf 9x9x3 1-comp",
  "can liner 40 x 46 1.5 mil black roll",
  "paper patty 5.5 x 5.5 dry wax",
  "chrsned bag plas tshirt logo ptsbchrisneddy",
  "towel multifold kraft 1-ply",
  "fuel surcharge",
]

const NON_RECIPE_SET = new Set(NON_RECIPE_CONSUMABLE_NAMES.map((n) => n.trim().toLowerCase()))

export type IngredientCoverageBucket =
  | "measurable"
  | "conversion_suspect"
  | "recipe_suspect"
  | "no_recipe_path"
  | "non_recipe_consumable"

export function classifyIngredientCoverage(input: {
  name: string
  costVerdict: CostVerdict
  lambdaVerdict: LambdaVerdict
  hasRecipePath: boolean
}): IngredientCoverageBucket {
  if (NON_RECIPE_SET.has(input.name.trim().toLowerCase())) return "non_recipe_consumable"
  if (input.costVerdict === "conversion_suspect") return "conversion_suspect"
  if (!input.hasRecipePath) return "no_recipe_path"
  if (input.lambdaVerdict === "recipe_suspect") return "recipe_suspect"
  return "measurable"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/inventory/conversion-guards.test.ts`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory/conversion-guards.ts tests/lib/inventory/conversion-guards.test.ts
git commit -m "feat(inventory): ordered conversion and recipe guards

Cost consistency runs first and needs no recipes, so it catches a wrong pack
factor on items no recipe consumes. Lambda runs second and is only read once
conversion is trusted -- onion and butter convert fine and still read 10.8 and
21.8, which is a recipe gap, not a pack gap."
```

---

### Task 5: Pack metadata — propose, confirm, apply

**Files:**
- Create: `scripts/propose-pack-metadata.ts`
- Create: `prisma/manual-migrations/2026-08-19_pack_metadata.sql` (authored in Step 4, from confirmed values only)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: no exported code. Produces DB state that Tasks 2 and 6 read via `caseUnit` / `recipeUnitsPerCase` / `recipeUnit`.

> **This task has a human gate.** The 14 ingredients total $61,271 of purchases. A wrong factor produces a *confident wrong* waste number, which is worse than a missing one. The script proposes; the owner confirms; only then is the migration written. **Do not invent a factor.**

- [ ] **Step 1: Write the proposal script**

Create `scripts/propose-pack-metadata.ts`:

```ts
// scripts/propose-pack-metadata.ts
//
// Read-only. For every canonical ingredient missing `recipeUnitsPerCase` that
// has real purchase history, print the invoice pack evidence so the owner can
// confirm a factor. Writes nothing to the database.
//
// Run: set -a && . ./.env.local && set +a && npx tsx scripts/propose-pack-metadata.ts

import { prisma } from "@/lib/prisma"

const LOOKBACK_DAYS = 168
const MIN_SPEND = 500

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const lines = await prisma.invoiceLineItem.findMany({
    where: { invoice: { invoiceDate: { gte: since } }, canonicalIngredientId: { not: null } },
    select: {
      canonicalIngredientId: true,
      productName: true,
      unit: true,
      quantity: true,
      packSize: true,
      unitSize: true,
      unitSizeUom: true,
      extendedPrice: true,
      sku: true,
      invoice: { select: { vendorName: true } },
      canonicalIngredient: {
        select: { name: true, recipeUnit: true, caseUnit: true, recipeUnitsPerCase: true, costPerRecipeUnit: true },
      },
    },
  })

  const byIngredient = new Map<string, typeof lines>()
  for (const l of lines) {
    const id = l.canonicalIngredientId!
    const bucket = byIngredient.get(id) ?? []
    bucket.push(l)
    byIngredient.set(id, bucket)
  }

  const rows = [...byIngredient.entries()]
    .map(([id, ls]) => ({
      id,
      ing: ls[0].canonicalIngredient!,
      spend: ls.reduce((s, l) => s + (l.extendedPrice ?? 0), 0),
      lines: ls,
    }))
    .filter((r) => r.spend >= MIN_SPEND && !(r.ing.recipeUnitsPerCase && r.ing.recipeUnitsPerCase > 0))
    .sort((a, b) => b.spend - a.spend)

  for (const r of rows) {
    console.log(`\n=== ${r.ing.name}`)
    console.log(`    id=${r.id}`)
    console.log(
      `    spend=$${r.spend.toFixed(0)}  recipeUnit=${r.ing.recipeUnit}  caseUnit=${r.ing.caseUnit}  storedCost=${r.ing.costPerRecipeUnit}`,
    )
    const seen = new Set<string>()
    for (const l of r.lines) {
      const key = `${l.sku}|${l.packSize}|${l.unitSize}|${l.unitSizeUom}|${l.unit}`
      if (seen.has(key)) continue
      seen.add(key)
      console.log(
        `    vendor=${l.invoice.vendorName} sku=${l.sku} unit=${l.unit} packSize=${l.packSize} unitSize=${l.unitSize} ${l.unitSizeUom ?? ""} | ${l.productName}`,
      )
    }
    console.log(`    PROPOSED recipeUnitsPerCase = ?   (packSize x unitSize, if both describe the case)`)
  }
  console.log(`\n${rows.length} ingredients need a factor.`)
}

main().finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Run the script and capture the evidence**

Run: `set -a && . ./.env.local && set +a && npx tsx scripts/propose-pack-metadata.ts > /tmp/pack-metadata-evidence.txt 2>&1; cat /tmp/pack-metadata-evidence.txt`
Expected: roughly 14 ingredients, led by `chris & eddy's house sauce cup 1.5 oz` ($30,002).

- [ ] **Step 3: Present the evidence to the owner and get each factor confirmed**

**STOP. Do not proceed without answers.** Present each ingredient with its pack evidence and a proposed factor, and ask the owner to confirm or correct. Flag these three explicitly, because they are not plain case factors:

- `american cheese yellow 160` — billed in **LB**, recipeUnit `each`. Needs slices-per-pound, not units-per-case.
- `peppers whole yellow` — billed in **TUB**. Needs a tub factor; `caseUnit` should be set to `TUB`.
- `hellmann mayonnaise extra heavy` — has **no `recipeUnit` at all**. A recipe unit must be chosen before any factor means anything.

Also confirm `fuel surcharge` is to be left alone: it is a delivery fee, excluded by `NON_RECIPE_CONSUMABLE_NAMES` in Task 4, and needs no factor.

- [ ] **Step 4: Write the migration from confirmed values only**

Create `prisma/manual-migrations/2026-08-19_pack_metadata.sql`. One `UPDATE` per ingredient, each with a comment recording the source of the number (invoice pack data, or owner confirmation). Template — **replace every `<...>` with a confirmed value, and delete any row the owner did not confirm**:

```sql
-- 2026-08-19 pack metadata backfill.
-- Fills caseUnit / recipeUnitsPerCase for ingredients whose invoices bill in
-- cases while recipes consume each/lb/oz/leaf. Without these the delivery
-- ladder reports `unconvertible` and the ingredient cannot be measured.
-- Every value below is either read off invoice pack data or confirmed by the
-- owner; the source is noted per row.

BEGIN;

-- house sauce cup 1.5 oz — $30,002 / 168d. Source: <invoice packSize x unitSize | owner>
UPDATE "CanonicalIngredient"
SET "caseUnit" = '<CS>', "recipeUnitsPerCase" = <N>
WHERE id = '<ingredient id>';

-- ... one block per confirmed ingredient ...

COMMIT;
```

- [ ] **Step 5: Apply and verify**

Run the migration against the database, then verify:

```bash
set -a && . ./.env.local && set +a && psql "$DATABASE_URL" -f prisma/manual-migrations/2026-08-19_pack_metadata.sql
set -a && . ./.env.local && set +a && npx tsx scripts/propose-pack-metadata.ts | tail -1
```
Expected: the trailing count drops by the number of ingredients confirmed in Step 3.

- [ ] **Step 6: Commit**

```bash
git add scripts/propose-pack-metadata.ts prisma/manual-migrations/2026-08-19_pack_metadata.sql
git commit -m "feat(inventory): pack metadata for case-billed ingredients

Each factor is read off invoice pack data or confirmed by the owner, with the
source recorded per row. A wrong factor produces a confident wrong waste
number, so none are inferred."
```

---

### Task 6: Coverage panel

**Files:**
- Modify: `src/app/actions/inventory/coverage-health-actions.ts`
- Modify: `src/app/dashboard/operations/inventory/components/coverage-health-card.tsx`
- Test: `tests/lib/inventory/conversion-guards.test.ts` (extend — the classification logic is already pure and tested there; no new test file)

**Interfaces:**
- Consumes: `classifyIngredientCoverage`, `checkCostConsistency`, `classifyLambdaPlausibility` (Task 4); `sumDeliveredQty` (Task 1); `computeTheoreticalUsage` (Task 3)
- Produces: `InventoryCoverageHealthData` gains `buckets: CoverageBucketSummary[]`

- [ ] **Step 1: Note the existing half-measure before changing it**

`coverage-health-actions.ts` already computes `conversionGapCount`: SKU matches with `conversionFactor === 1` **and** `fromUnit !== toUnit`. That deliberately excludes identity rows — which is exactly the 113 rows that are actually broken. Keep the field (it counts a different, real defect) but do not treat it as the conversion signal. The buckets are the signal.

- [ ] **Step 2: Extend the action's return type**

In `src/app/actions/inventory/coverage-health-actions.ts`, add above the existing interface:

```ts
import type { IngredientCoverageBucket } from "@/lib/inventory/conversion-guards"

export interface CoverageBucketSummary {
  bucket: IngredientCoverageBucket
  ingredientCount: number
  /** Purchase dollars in the window that fall in this bucket. */
  spend: number
}
```

and add to `InventoryCoverageHealthData`:

```ts
  /** Every purchased ingredient in exactly one bucket. Sums to the window's spend. */
  buckets: CoverageBucketSummary[]
  /** Spend the waste maths cannot see: everything except `measurable`. */
  excludedSpend: number
```

- [ ] **Step 3: Compute the buckets in the action**

Inside `getInventoryCoverageHealth`, after the existing queries, add a bucket pass over a 168-day window. Add these imports at the top:

```ts
import {
  checkCostConsistency,
  classifyLambdaPlausibility,
  classifyIngredientCoverage,
  type IngredientCoverageBucket,
} from "@/lib/inventory/conversion-guards"
import { sumDeliveredQty, type SkuFactor } from "@/lib/inventory/delivered-qty"
import { computeTheoreticalUsage } from "@/lib/inventory/theoretical-usage"
import { vendorMatchKey } from "@/lib/vendor-normalize"
```

and this block before the `return`:

```ts
  const BUCKET_WINDOW_DAYS = 168
  const bucketFrom = new Date(windowEnd.getTime() - BUCKET_WINDOW_DAYS * MS_PER_DAY)

  const [ingredients, bucketLines, skuMatches] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      where: { accountId: user.accountId },
      select: {
        id: true,
        name: true,
        recipeUnit: true,
        caseUnit: true,
        recipeUnitsPerCase: true,
        costPerRecipeUnit: true,
      },
    }),
    prisma.invoiceLineItem.findMany({
      where: {
        canonicalIngredientId: { not: null },
        invoice: { storeId: input.storeId, invoiceDate: { gte: bucketFrom, lte: windowEnd } },
      },
      select: {
        canonicalIngredientId: true,
        quantity: true,
        unit: true,
        sku: true,
        extendedPrice: true,
        invoice: { select: { vendorName: true } },
      },
    }),
    prisma.ingredientSkuMatch.findMany({
      where: { accountId: user.accountId },
      select: { vendorKey: true, sku: true, fromUnit: true, toUnit: true, conversionFactor: true },
    }),
  ])

  const skuFactorByKey = new Map<string, SkuFactor>(
    skuMatches.map((m) => [
      `${m.vendorKey}|${m.sku}`,
      { fromUnit: m.fromUnit, toUnit: m.toUnit, conversionFactor: m.conversionFactor },
    ]),
  )

  const usage = await computeTheoreticalUsage({
    storeId: input.storeId,
    accountId: user.accountId,
    from: bucketFrom,
    to: windowEnd,
    ingredients: ingredients
      .filter((i): i is typeof i & { recipeUnit: string } => Boolean(i.recipeUnit))
      .map((i) => ({ id: i.id, recipeUnit: i.recipeUnit })),
  })

  const linesByIngredient = new Map<string, typeof bucketLines>()
  for (const l of bucketLines) {
    const id = l.canonicalIngredientId!
    const b = linesByIngredient.get(id) ?? []
    b.push(l)
    linesByIngredient.set(id, b)
  }

  const tally = new Map<IngredientCoverageBucket, { ingredientCount: number; spend: number }>()
  for (const ing of ingredients) {
    const ls = linesByIngredient.get(ing.id) ?? []
    if (ls.length === 0) continue // never purchased in the window; nothing to classify
    const spend = ls.reduce((s, l) => s + (l.extendedPrice ?? 0), 0)

    const delivered = sumDeliveredQty(
      ls.map((l) => ({
        quantity: l.quantity,
        unit: l.unit,
        sku: l.sku,
        vendorKey: vendorMatchKey(l.invoice.vendorName ?? ""),
      })),
      { recipeUnit: ing.recipeUnit, caseUnit: ing.caseUnit, recipeUnitsPerCase: ing.recipeUnitsPerCase },
      (line) => skuFactorByKey.get(`${line.vendorKey}|${line.sku ?? ""}`),
    )

    const theoretical = usage.byIngredient.get(ing.id) ?? 0
    const cost = checkCostConsistency({
      spend,
      deliveredQty: delivered.deliveriesQty,
      costPerRecipeUnit: ing.costPerRecipeUnit,
    })
    const lambda = theoretical > 0 ? delivered.deliveriesQty / theoretical : null
    const bucket = classifyIngredientCoverage({
      name: ing.name,
      costVerdict: cost.verdict,
      lambdaVerdict: classifyLambdaPlausibility({ lambda, windows: 6 }),
      hasRecipePath: theoretical > 0,
    })

    const cur = tally.get(bucket) ?? { ingredientCount: 0, spend: 0 }
    cur.ingredientCount += 1
    cur.spend += spend
    tally.set(bucket, cur)
  }

  const buckets = [...tally.entries()]
    .map(([bucket, v]) => ({ bucket, ...v }))
    .sort((a, b) => b.spend - a.spend)
  const excludedSpend = buckets
    .filter((b) => b.bucket !== "measurable")
    .reduce((s, b) => s + b.spend, 0)
```

Add `buckets` and `excludedSpend` to the returned `data` object.

- [ ] **Step 4: Render the buckets**

In `coverage-health-card.tsx`, add below the existing three-column grid, inside the `<section>`:

```tsx
      {data.buckets.length > 0 && (
        <div className="border-t border-[var(--hairline)] px-5 py-4">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
              What the waste maths can see
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
              {fmtMoney(data.excludedSpend)} excluded
            </span>
          </div>
          <ul className="mt-3 space-y-1.5">
            {data.buckets.map((b) => (
              <li key={b.bucket} className="flex items-baseline justify-between gap-4">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                  {BUCKET_LABELS[b.bucket]}
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-faint)]">
                    {b.ingredientCount} item{b.ingredientCount === 1 ? "" : "s"}
                  </span>
                  <span
                    className={`text-[15px] ${b.bucket === "measurable" ? "text-[var(--ink)]" : "text-[var(--accent)]"}`}
                    style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
                  >
                    {fmtMoney(b.spend)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
```

and add above the component:

```tsx
import type { IngredientCoverageBucket } from "@/lib/inventory/conversion-guards"

const BUCKET_LABELS: Record<IngredientCoverageBucket, string> = {
  measurable: "Measurable",
  conversion_suspect: "Pack factor wrong",
  recipe_suspect: "Recipe incomplete",
  no_recipe_path: "No recipe path",
  non_recipe_consumable: "Excluded by design",
}
```

- [ ] **Step 5: Verify against production data**

Run: `npm run dev`, open `/dashboard/operations/inventory`, and confirm the panel renders with `measurable` carrying the largest spend and the bucket spends summing to the window's purchases.

Expected after Task 5 is applied: house sauce cup and lettuce leave `conversion_suspect`; butter appears under `recipe_suspect`; fryer oil and foam containers appear under `non_recipe_consumable`.

- [ ] **Step 6: Whole-project gate**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/inventory/coverage-health-actions.ts src/app/dashboard/operations/inventory/components/coverage-health-card.tsx
git commit -m "feat(inventory): coverage panel naming excluded spend

Every purchased ingredient lands in exactly one bucket and the excluded spend
is stated, so the waste total that lands in increment 2 is honestly bounded
rather than silently truncated."
```

---

### Task 7: Reconciliation fixture, so a pack regression fails loudly

**Files:**
- Create: `scripts/reconcile-lambda.ts`
- Create: `scripts/fixtures/lambda-baseline.json`

**Interfaces:**
- Consumes: `sumDeliveredQty` (Task 1), `computeTheoreticalUsage` (Task 3)
- Produces: no exported code. A non-zero exit on drift.

**Why a script and not a vitest test:** this compares against live production data, so it must not run in the unit suite or in CI without a database. It is run by hand after any pack-metadata or recipe change, and is the regression net the spec asks for — a wrong pack factor silently inflates waste, and nothing else would catch it.

- [ ] **Step 1: Write the reconciliation script**

Create `scripts/reconcile-lambda.ts`:

```ts
// scripts/reconcile-lambda.ts
//
// Recomputes lambda (delivered / theoretical, ratio of sums) for the
// ingredients the design pinned, and compares against a checked-in baseline.
// Exits non-zero on drift beyond tolerance. Read-only.
//
// Run: set -a && . ./.env.local && set +a && npx tsx scripts/reconcile-lambda.ts
// Re-baseline (only after confirming the change is intended):
//   ... npx tsx scripts/reconcile-lambda.ts --write

import { readFileSync, writeFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { sumDeliveredQty, type SkuFactor } from "@/lib/inventory/delivered-qty"
import { computeTheoreticalUsage } from "@/lib/inventory/theoretical-usage"
import { vendorMatchKey } from "@/lib/vendor-normalize"

const STORE_ID = "cmexd4zia0001jr04ljkdt9na" // Hollywood — the only trading store
const WINDOW_DAYS = 168
const END = new Date("2026-08-18T00:00:00.000Z")
const TOLERANCE = 0.05 // 5% relative drift in lambda
const BASELINE = "scripts/fixtures/lambda-baseline.json"

async function main() {
  const write = process.argv.includes("--write")
  const from = new Date(END.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const store = await prisma.store.findUniqueOrThrow({
    where: { id: STORE_ID },
    select: { accountId: true },
  })

  const [ingredients, lines, skuMatches] = await Promise.all([
    prisma.canonicalIngredient.findMany({
      where: { accountId: store.accountId },
      select: { id: true, name: true, recipeUnit: true, caseUnit: true, recipeUnitsPerCase: true },
    }),
    prisma.invoiceLineItem.findMany({
      where: {
        canonicalIngredientId: { not: null },
        invoice: { storeId: STORE_ID, invoiceDate: { gte: from, lte: END } },
      },
      select: {
        canonicalIngredientId: true,
        quantity: true,
        unit: true,
        sku: true,
        extendedPrice: true,
        invoice: { select: { vendorName: true } },
      },
    }),
    prisma.ingredientSkuMatch.findMany({
      where: { accountId: store.accountId },
      select: { vendorKey: true, sku: true, fromUnit: true, toUnit: true, conversionFactor: true },
    }),
  ])

  const skuFactorByKey = new Map<string, SkuFactor>(
    skuMatches.map((m) => [
      `${m.vendorKey}|${m.sku}`,
      { fromUnit: m.fromUnit, toUnit: m.toUnit, conversionFactor: m.conversionFactor },
    ]),
  )

  const usage = await computeTheoreticalUsage({
    storeId: STORE_ID,
    accountId: store.accountId,
    from,
    to: END,
    ingredients: ingredients
      .filter((i): i is typeof i & { recipeUnit: string } => Boolean(i.recipeUnit))
      .map((i) => ({ id: i.id, recipeUnit: i.recipeUnit })),
  })

  const linesBy = new Map<string, typeof lines>()
  for (const l of lines) {
    const id = l.canonicalIngredientId!
    const b = linesBy.get(id) ?? []
    b.push(l)
    linesBy.set(id, b)
  }

  const actual: Record<string, { lambda: number | null; delivered: number; theoretical: number }> = {}
  for (const ing of ingredients) {
    const ls = linesBy.get(ing.id) ?? []
    if (ls.length === 0) continue
    const delivered = sumDeliveredQty(
      ls.map((l) => ({
        quantity: l.quantity,
        unit: l.unit,
        sku: l.sku,
        vendorKey: vendorMatchKey(l.invoice.vendorName ?? ""),
      })),
      { recipeUnit: ing.recipeUnit, caseUnit: ing.caseUnit, recipeUnitsPerCase: ing.recipeUnitsPerCase },
      (line) => skuFactorByKey.get(`${line.vendorKey}|${line.sku ?? ""}`),
    )
    const theoretical = usage.byIngredient.get(ing.id) ?? 0
    actual[ing.name] = {
      lambda: theoretical > 0 ? delivered.deliveriesQty / theoretical : null,
      delivered: delivered.deliveriesQty,
      theoretical,
    }
  }

  if (write) {
    writeFileSync(BASELINE, JSON.stringify(actual, null, 2) + "\n")
    console.log(`baseline written: ${Object.keys(actual).length} ingredients`)
    return
  }

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as typeof actual
  let failures = 0
  for (const [name, want] of Object.entries(baseline)) {
    const got = actual[name]
    if (!got) {
      console.error(`MISSING  ${name}`)
      failures++
      continue
    }
    if (want.lambda == null || got.lambda == null) {
      if (want.lambda !== got.lambda) {
        console.error(`DRIFT    ${name}: lambda ${want.lambda} -> ${got.lambda}`)
        failures++
      }
      continue
    }
    const rel = Math.abs(got.lambda - want.lambda) / want.lambda
    if (rel > TOLERANCE) {
      console.error(
        `DRIFT    ${name}: lambda ${want.lambda.toFixed(3)} -> ${got.lambda.toFixed(3)} (${(rel * 100).toFixed(1)}%)`,
      )
      failures++
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} ingredient(s) drifted. If intended, re-run with --write.`)
    process.exitCode = 1
  } else {
    console.log(`ok — ${Object.keys(baseline).length} ingredients within ${TOLERANCE * 100}%`)
  }
}

main().finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Generate the baseline**

Run: `set -a && . ./.env.local && set +a && npx tsx scripts/reconcile-lambda.ts --write`
Expected: a baseline file written.

- [ ] **Step 3: Confirm the baseline matches the design's measured table**

Open `scripts/fixtures/lambda-baseline.json` and check these four against the spec, which measured the same 168-day window:

| Ingredient | Expected λ |
|---|---|
| `ground beef fine grnd 73/27 creekstone` | ≈ 1.25 |
| `whole class ice cream mix soft serve vanilla 5%` | ≈ 1.07 |
| `martins bread potato roll sandwich 3.5 inch` | ≈ 0.92 |
| `lamb potato fry ss 1/4 stealth` | ≈ 0.78 |

Tomato and onion should now be **much closer to 1** than the spec's pre-fix figures (tomato had no theoretical usage at all; onion read 10.8), because Task 3 added the modifier branch. **If they have not moved, the modifier walk is not reaching them — stop and investigate before baselining.**

- [ ] **Step 4: Verify the guard catches a regression**

Temporarily set one confirmed `recipeUnitsPerCase` to a wrong value in the database, re-run without `--write`, and confirm the script reports DRIFT and exits non-zero. Restore the correct value afterwards.

Run: `set -a && . ./.env.local && set +a && npx tsx scripts/reconcile-lambda.ts; echo "exit=$?"`
Expected: `DRIFT` lines and `exit=1` while the value is wrong; `ok` and `exit=0` once restored.

- [ ] **Step 5: Commit**

```bash
git add scripts/reconcile-lambda.ts scripts/fixtures/lambda-baseline.json
git commit -m "test(inventory): pin lambda against a baseline

A wrong pack factor does not throw -- it quietly inflates waste. This
recomputes lambda over the design's window and fails on drift beyond 5%."
```

---

## Done when

- `npm test && npx tsc --noEmit && npm run build` passes.
- `npx tsx scripts/reconcile-lambda.ts` exits 0.
- The coverage panel shows the four non-`measurable` buckets with their spend, and the buckets sum to window purchases.
- Ground beef, buns, fries and ice cream mix classify as `measurable`.
- No waste dollar figure appears anywhere in the UI.
