# Pantry Ledger (Increment 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/dashboard/ingredients` into a spend-ranked canonical ingredient ledger, grouped by kitchen station, with SKU-aware price trends and an inline drill-down that links to source invoices.

**Architecture:** Three new pure/batch modules in `src/lib` supply station, trend and spend data. A new server action composes them into ledger rows without touching `listCanonicalIngredients()` (consumed by mobile). The existing tile grid stays reachable behind a view toggle, so the change is reversible without a revert.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 (client generated to `src/generated/prisma`), Vitest (node env, `tests/**/*.test.ts` only), Tailwind v4 with the editorial tokens.

**Spec:** [`docs/superpowers/specs/2026-08-17-pantry-ledger-design.md`](../specs/2026-08-17-pantry-ledger-design.md)
**Visual spec:** https://claude.ai/code/artifact/2d28a9f5-1957-42e0-90e3-f50303159fb1

## Global Constraints

- **Design tokens only on `/dashboard/*`.** `--ink`, `--ink-muted`, `--ink-faint`, `--ink-ornament`, `--paper`, `--paper-deep`, `--paper-soft`, `--hairline`, `--hairline-bold`, `--accent`, `--accent-dark`, `--accent-bg`. No `bg-sky-*`, `text-emerald-*` etc. See `DESIGN.md`.
- **Two-tier typography.** Numbers render in DM Sans 500–600 with `font-variant-numeric: tabular-nums lining-nums`. JetBrains Mono for captions, folios, SKUs, status labels. Fraunces italic only for prose and display titles — **not** for ingredient names.
- **`--ink-ornament` (#a69d92) is for non-text marks only** (rules, bars, chart gridlines). Any text a reader must make out uses `--ink-faint` (#776d63) or darker.
- **Red (`--accent`) means a price rise worth ≥ $250/quarter.** Not selection state, not "unpriced", not falling prices.
- **Do not modify the signature or query cost of `listCanonicalIngredients()`.** Mobile (`src/app/(mobile)/m/ingredients/page.tsx`) and two recipe surfaces consume it. Adding derived fields computed from queries it already runs is allowed; adding new queries is not.
- **No `"use server"` on re-export shims** — it breaks Next.js re-exports (`CLAUDE.md` tripwire 5).
- **Whole-project gate:** `npm test && npx tsc --noEmit && npm run build`. There is no ESLint in this repo.
- **Vitest only picks up `tests/**/*.test.ts`** (not `.tsx`). Keep logic in testable `.ts` modules; component files are verified by the build and by manual check.
- Commit messages: no `Co-Authored-By` line.

---

### Task 1: Station classifier

Resolves an ingredient to a kitchen station. Product name is checked before stored category because the stored categories are wrong for 18% of spend (House Sauce is `Other`; its cup has no category at all).

**Files:**
- Create: `src/lib/pantry-stations.ts`
- Test: `tests/lib/pantry-stations.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `PANTRY_STATIONS: readonly PantryStation[]`, `type PantryStation`, `stationFor(name: string, category: string | null): PantryStation`, `isPackagingStation(s: PantryStation): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/pantry-stations.test.ts
// Station resolution runs on product name BEFORE stored category, because the
// stored categories are unreliable: House Sauce is filed under "Other" and its
// cup under nothing, which together are 18% of 90-day spend.
import { describe, it, expect } from "vitest"
import { stationFor, isPackagingStation, PANTRY_STATIONS } from "@/lib/pantry-stations"

describe("stationFor", () => {
  it("routes packaging categories to Packaging & Supplies regardless of name", () => {
    expect(stationFor("container foam hinged white", "Paper/Supplies")).toBe("Packaging & Supplies")
    expect(stationFor("keyston sanitizer multi quat liq", "Cleaning")).toBe("Packaging & Supplies")
    expect(stationFor("napkin dispenser", "Equipment")).toBe("Packaging & Supplies")
  })

  it("resolves by product name when the stored category is wrong or missing", () => {
    expect(stationFor("chris & eddy's house sauce", "Other")).toBe("Sauce & Condiment")
    expect(stationFor("chris & eddy's house sauce cup", null)).toBe("Sauce & Condiment")
    expect(stationFor("ketchup packets foil", "Dry Goods")).toBe("Sauce & Condiment")
  })

  it("falls back to the stored category when the name says nothing", () => {
    expect(stationFor("packer onion sweet fresh", "Produce")).toBe("Produce")
    expect(stationFor("some unlabelled item", "Bakery")).toBe("Bread & Bakery")
  })

  it("prefers dairy over frozen for frozen dairy products", () => {
    // "whole frozen butter solid usda aa unsalted" matches /frozen/ and /butter/.
    // Butter belongs with dairy; only the fry programme belongs to Fry & Frozen.
    expect(stationFor("whole frozen butter solid usda aa unsalted", "Dairy")).toBe("Dairy & Ice Cream")
    expect(stationFor("lamb potato fry ss 1/4 stealth", "Frozen")).toBe("Fry & Frozen")
  })

  it("routes the anchor products of the menu correctly", () => {
    expect(stationFor("ground beef fine grnd 73/27 creekstone", "Meat")).toBe("Beef & Protein")
    expect(stationFor("martins bread potato roll sandwich 3.5 inch", "Bakery")).toBe("Bread & Bakery")
    expect(stationFor("soda coke mexican glass", "Beverages")).toBe("Drinks")
    expect(stationFor("whole class ice cream mix soft serve vanilla 5%", "Dairy")).toBe("Dairy & Ice Cream")
  })

  it("falls back to Dry Goods when nothing matches", () => {
    expect(stationFor("kosher flake coarse salt", "Dry Goods")).toBe("Dry Goods")
    expect(stationFor("mystery item", null)).toBe("Dry Goods")
  })

  it("only flags the packaging station as packaging", () => {
    expect(isPackagingStation("Packaging & Supplies")).toBe(true)
    expect(isPackagingStation("Beef & Protein")).toBe(false)
  })

  it("lists every station it can return, packaging last", () => {
    const produced = new Set(PANTRY_STATIONS)
    expect(produced.has("Dry Goods")).toBe(true)
    expect(PANTRY_STATIONS[PANTRY_STATIONS.length - 1]).toBe("Packaging & Supplies")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/pantry-stations.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/pantry-stations"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/pantry-stations.ts
/**
 * Kitchen stations for the Pantry ledger.
 *
 * Resolution order is product name FIRST, stored category second. The stored
 * `CanonicalIngredient.category` is unreliable: "Chris & Eddy's House Sauce" is
 * filed under "Other" and its cup under nothing at all, and those two are 18%
 * of 90-day spend. Bucketing on category alone hides the second-largest cost
 * centre in the business inside an "Other" pile.
 */

export const PANTRY_STATIONS = [
  "Beef & Protein",
  "Sauce & Condiment",
  "Bread & Bakery",
  "Dairy & Ice Cream",
  "Fry & Frozen",
  "Produce",
  "Drinks",
  "Dry Goods",
  "Packaging & Supplies",
] as const

export type PantryStation = (typeof PANTRY_STATIONS)[number]

const PACKAGING_STATION: PantryStation = "Packaging & Supplies"

/** Stored categories that are never food, whatever the product name says. */
const PACKAGING_CATEGORIES = new Set(["Paper/Supplies", "Cleaning", "Equipment"])

/**
 * Ordered rules. First match wins, so order encodes precedence:
 * Dairy sits above Fry & Frozen because "whole FROZEN BUTTER" is dairy, and
 * only the fry programme should land in Fry & Frozen.
 */
const RULES: ReadonlyArray<{
  station: PantryStation
  name: RegExp
  categories: readonly string[]
}> = [
  { station: "Beef & Protein", name: /ground beef|patty|bacon|chicken|sausage|hot dog/i, categories: ["Meat"] },
  { station: "Sauce & Condiment", name: /sauce|ketchup|mustard|mayo|mayonnaise|relish|pickle|sce\b|spread/i, categories: [] },
  { station: "Bread & Bakery", name: /bread|roll|bun|loaf/i, categories: ["Bakery"] },
  { station: "Dairy & Ice Cream", name: /cheese|butter|ice cream|milk|cream/i, categories: ["Dairy"] },
  { station: "Fry & Frozen", name: /potato fry|fry |fries|shortening|frozen/i, categories: ["Frozen"] },
  { station: "Produce", name: /lettuce|tomato|onion|pepper|avocado/i, categories: ["Produce"] },
  { station: "Drinks", name: /syrup|soda|coke|sprite|fanta|water|lemonade|juice|tea/i, categories: ["Beverages"] },
]

export function stationFor(name: string, category: string | null): PantryStation {
  if (category != null && PACKAGING_CATEGORIES.has(category)) return PACKAGING_STATION
  for (const rule of RULES) {
    if (rule.name.test(name)) return rule.station
    if (category != null && rule.categories.includes(category)) return rule.station
  }
  return "Dry Goods"
}

export function isPackagingStation(station: PantryStation): boolean {
  return station === PACKAGING_STATION
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/pantry-stations.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/pantry-stations.ts tests/lib/pantry-stations.test.ts
git commit -m "feat(pantry): resolve ingredients to kitchen stations by name before category"
```

---

### Task 2: SKU-aware price trend

**This is a correctness fix, not a feature.** The current `computeTrendsByCanonical` buckets on `(canonicalId, vendor, unit)`, so it compares prices across a SKU change. `lamb potato fry ss 1/4 stealth` merges 4 SKUs across 3 products, and its headline `+67%` is mostly a switch from Lamb Weston to Simplot. Bucketing on SKU as well makes each comparison within one product. Mobile reads `trend30d.pctChange` and benefits from the same fix.

**Files:**
- Create: `src/lib/canonical-trend.ts`
- Test: `tests/lib/canonical-trend.test.ts`
- Modify: `src/types/recipe.ts` (add `sku` to `IngredientTrend`, `skuCount` to `CanonicalIngredientSummary`)
- Modify: `src/app/actions/canonical-ingredient-actions.ts:145-226` (replace the private `computeTrendsByCanonical` body with a call into the new module)

**Interfaces:**
- Consumes: `IngredientTrend` from `@/types/recipe`
- Produces: `type TrendPoint = { date: Date; price: number; vendor: string; unit: string | null; sku: string | null }`, `type CanonicalTrend = { trend: IngredientTrend | null; skuCount: number }`, `computeTrendForPoints(points: TrendPoint[], nowMs: number): CanonicalTrend`

- [ ] **Step 1: Add the two type fields**

```ts
// src/types/recipe.ts — inside IngredientTrend, after `unit`
  /** SKU the compared prices share. Null when the vendor sent no SKU. */
  sku: string | null
```

```ts
// src/types/recipe.ts — inside CanonicalIngredientSummary, after `trend30d`
  /**
   * Distinct SKUs seen on this ingredient's invoice lines in the trend window.
   * >1 means invoice history spans more than one product, so any trend across
   * the whole ingredient compares different things. 22 of 75 ingredients with
   * history are in this state.
   */
  skuCount: number
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/lib/canonical-trend.test.ts
// A price trend is only meaningful within one SKU. The fry canonical merges
// four SKUs across three products; comparing its first and last price reports
// a supplier switch as inflation.
import { describe, it, expect } from "vitest"
import { computeTrendForPoints, type TrendPoint } from "@/lib/canonical-trend"

const NOW = Date.parse("2026-08-17T00:00:00Z")
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000)

const pt = (over: Partial<TrendPoint> & { date: Date; price: number }): TrendPoint => ({
  vendor: "Sysco",
  unit: "CS",
  sku: "A",
  ...over,
})

describe("computeTrendForPoints", () => {
  it("returns no trend when there is no baseline older than 30 days", () => {
    const r = computeTrendForPoints([pt({ date: daysAgo(2), price: 10 }), pt({ date: daysAgo(1), price: 20 })], NOW)
    expect(r.trend).toBeNull()
  })

  it("compares latest against the most recent point at least 30 days old", () => {
    const r = computeTrendForPoints(
      [pt({ date: daysAgo(60), price: 10 }), pt({ date: daysAgo(35), price: 20 }), pt({ date: daysAgo(1), price: 30 })],
      NOW
    )
    expect(r.trend?.baselinePrice).toBe(20)
    expect(r.trend?.latestPrice).toBe(30)
    expect(r.trend?.pctChange).toBeCloseTo(50)
  })

  it("never compares across a SKU change", () => {
    // Old product at $38, new product at $46.75. A SKU-blind comparison reports
    // +23%; there is no valid within-SKU comparison here, so the answer is null.
    const r = computeTrendForPoints(
      [pt({ date: daysAgo(90), price: 38, sku: "OLD" }), pt({ date: daysAgo(1), price: 46.75, sku: "NEW" })],
      NOW
    )
    expect(r.trend).toBeNull()
    expect(r.skuCount).toBe(2)
  })

  it("reports the real within-SKU move when one exists alongside a switch", () => {
    const r = computeTrendForPoints(
      [
        pt({ date: daysAgo(120), price: 38, sku: "OLD" }),
        pt({ date: daysAgo(40), price: 28, sku: "NEW" }),
        pt({ date: daysAgo(1), price: 46.75, sku: "NEW" }),
      ],
      NOW
    )
    expect(r.trend?.sku).toBe("NEW")
    expect(r.trend?.baselinePrice).toBe(28)
    expect(r.trend?.latestPrice).toBe(46.75)
    expect(r.trend?.pctChange).toBeCloseTo(66.96, 1)
    expect(r.skuCount).toBe(2)
  })

  it("keeps vendor and unit in the bucket key", () => {
    // Same SKU, different unit — a case price and a pound price are not comparable.
    const r = computeTrendForPoints(
      [pt({ date: daysAgo(40), price: 38, unit: "CS" }), pt({ date: daysAgo(1), price: 4.33, unit: "LB" })],
      NOW
    )
    expect(r.trend).toBeNull()
  })

  it("picks the largest absolute move when several SKUs each have a valid trend", () => {
    const r = computeTrendForPoints(
      [
        pt({ date: daysAgo(40), price: 100, sku: "A" }),
        pt({ date: daysAgo(1), price: 105, sku: "A" }),
        pt({ date: daysAgo(40), price: 10, sku: "B" }),
        pt({ date: daysAgo(1), price: 14, sku: "B" }),
      ],
      NOW
    )
    expect(r.trend?.sku).toBe("B")
    expect(r.trend?.pctChange).toBeCloseTo(40)
  })

  it("ignores non-positive baselines and counts SKUs including null as one bucket", () => {
    const r = computeTrendForPoints(
      [pt({ date: daysAgo(40), price: 0, sku: null }), pt({ date: daysAgo(1), price: 5, sku: null })],
      NOW
    )
    expect(r.trend).toBeNull()
    expect(r.skuCount).toBe(1)
  })

  it("returns skuCount 0 and no trend for empty input", () => {
    expect(computeTrendForPoints([], NOW)).toEqual({ trend: null, skuCount: 0 })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/canonical-trend.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/canonical-trend"`

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/canonical-trend.ts
/**
 * 30-day price trend for one canonical ingredient.
 *
 * Points are bucketed by (vendor, unit, sku) and compared only inside a
 * bucket. The SKU term is what stops the ledger reporting a product switch as
 * inflation: `lamb potato fry ss 1/4 stealth` carries four SKUs across three
 * products (Lamb Weston $38 → a Vitco fry $33.12 → Simplot $28 → $46.75), and
 * a SKU-blind comparison of its endpoints is a comparison of different things.
 */
import type { IngredientTrend } from "@/types/recipe"

export type TrendPoint = {
  date: Date
  price: number
  vendor: string
  unit: string | null
  sku: string | null
}

export type CanonicalTrend = {
  trend: IngredientTrend | null
  /** Distinct SKUs across all points. >1 means the history spans products. */
  skuCount: number
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export function computeTrendForPoints(points: TrendPoint[], nowMs: number): CanonicalTrend {
  if (points.length === 0) return { trend: null, skuCount: 0 }

  const skus = new Set<string>()
  const buckets = new Map<string, TrendPoint[]>()
  for (const p of points) {
    const sku = p.sku?.trim() || null
    skus.add(sku ?? "∅")
    const key = `${p.vendor}|${p.unit ?? "∅"}|${sku ?? "∅"}`
    const arr = buckets.get(key) ?? []
    arr.push(p)
    buckets.set(key, arr)
  }

  const cutoffMs = nowMs - THIRTY_DAYS_MS
  let best: IngredientTrend | null = null

  for (const pts of buckets.values()) {
    if (pts.length < 2) continue
    const sorted = [...pts].sort((a, b) => b.date.getTime() - a.date.getTime())
    const latest = sorted[0]
    // Baseline is the newest point on or before (now - 30d). Without one we
    // would be calling a two-day swing a 30-day trend.
    const baseline = sorted.find((p) => p.date.getTime() <= cutoffMs)
    if (!baseline || baseline.price <= 0) continue
    const pctChange = ((latest.price - baseline.price) / baseline.price) * 100
    if (!Number.isFinite(pctChange)) continue

    if (best == null || Math.abs(pctChange) > Math.abs(best.pctChange)) {
      best = {
        pctChange,
        latestPrice: latest.price,
        baselinePrice: baseline.price,
        vendor: latest.vendor,
        unit: latest.unit,
        sku: latest.sku?.trim() || null,
        latestDate: latest.date.toISOString().slice(0, 10),
        baselineDate: baseline.date.toISOString().slice(0, 10),
      }
    }
  }

  return { trend: best, skuCount: skus.size }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/canonical-trend.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 6: Rewire the action to use it**

In `src/app/actions/canonical-ingredient-actions.ts`, add `sku: true` to the `select` in `computeTrendsByCanonical`, and replace the bucketing/comparison body with a per-canonical call to `computeTrendForPoints`. Change its return type to `Map<string, CanonicalTrend>`, and in `listCanonicalIngredients` set:

```ts
      trend30d: trendsByCanonical.get(c.id)?.trend ?? null,
      skuCount: trendsByCanonical.get(c.id)?.skuCount ?? 0,
```

- [ ] **Step 7: Typecheck and full suite**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. If any existing test asserts on `IngredientTrend` object equality it will now need the `sku` key — update those assertions rather than making `sku` optional.

- [ ] **Step 8: Commit**

```bash
git add src/lib/canonical-trend.ts tests/lib/canonical-trend.test.ts src/types/recipe.ts src/app/actions/canonical-ingredient-actions.ts
git commit -m "fix(pantry): compare prices within a SKU so product switches stop reading as inflation"
```

---

### Task 3: 90-day spend per canonical

**Files:**
- Create: `src/lib/canonical-spend-batch.ts`
- Test: `tests/lib/canonical-spend-batch.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/prisma`, `normalizeVendorName` from `@/lib/vendor-normalize`
- Produces: `type CanonicalSpend = { spend: number; lineCount: number; vendors: string[]; skus: string[]; lastPurchaseAt: Date | null }`, `batchCanonicalSpend(accountId: string, days?: number): Promise<Map<string, CanonicalSpend>>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/canonical-spend-batch.test.ts
// Spend is the ledger's sort key, so this aggregation decides what an owner
// sees first. Vendor names are normalised because "Sysco" and "Sysco Los
// Angeles, Inc" are one supplier and must not read as two.
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { invoiceLineItem: { findMany: vi.fn() } },
}))

import { prisma } from "@/lib/prisma"
import { batchCanonicalSpend } from "@/lib/canonical-spend-batch"

const line = (over: Record<string, unknown>) => ({
  canonicalIngredientId: "c1",
  extendedPrice: 100,
  sku: "A",
  invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-08-01") },
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe("batchCanonicalSpend", () => {
  it("sums spend and counts lines per canonical", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line({ extendedPrice: 100 }),
      line({ extendedPrice: 50 }),
      line({ canonicalIngredientId: "c2", extendedPrice: 20 }),
    ] as never)

    const map = await batchCanonicalSpend("acct-1")
    expect(map.get("c1")?.spend).toBe(150)
    expect(map.get("c1")?.lineCount).toBe(2)
    expect(map.get("c2")?.spend).toBe(20)
  })

  it("normalises vendor names so one supplier counts once", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line({ invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-08-01") } }),
      line({ invoice: { vendorName: "Sysco Los Angeles, Inc", invoiceDate: new Date("2026-08-02") } }),
    ] as never)

    const map = await batchCanonicalSpend("acct-1")
    expect(map.get("c1")?.vendors).toEqual(["Sysco"])
  })

  it("collects distinct SKUs and the most recent purchase date", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line({ sku: "A", invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-06-01") } }),
      line({ sku: "B", invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-08-10") } }),
      line({ sku: "A", invoice: { vendorName: "Sysco", invoiceDate: new Date("2026-07-01") } }),
    ] as never)

    const map = await batchCanonicalSpend("acct-1")
    expect(map.get("c1")?.skus.sort()).toEqual(["A", "B"])
    expect(map.get("c1")?.lastPurchaseAt).toEqual(new Date("2026-08-10"))
  })

  it("keeps returns negative so spend is net", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([
      line({ extendedPrice: 100 }),
      line({ extendedPrice: -30 }),
    ] as never)

    const map = await batchCanonicalSpend("acct-1")
    expect(map.get("c1")?.spend).toBe(70)
  })

  it("scopes the query to the account and the requested window", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)
    await batchCanonicalSpend("acct-9", 30)

    const arg = vi.mocked(prisma.invoiceLineItem.findMany).mock.calls[0][0] as {
      where: { invoice: { accountId: string; invoiceDate: { gte: Date } } }
    }
    expect(arg.where.invoice.accountId).toBe("acct-9")
    expect(arg.where.invoice.invoiceDate.gte).toBeInstanceOf(Date)
  })

  it("returns an empty map when there are no matched lines", async () => {
    vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)
    expect((await batchCanonicalSpend("acct-1")).size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/canonical-spend-batch.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/canonical-spend-batch"`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/canonical-spend-batch.ts
/**
 * 90-day purchase totals per canonical ingredient — the Pantry ledger's sort
 * key. Deliberately NOT folded into `batchCanonicalCosts` or
 * `listCanonicalIngredients`: those are on mobile's and the recipe editor's
 * critical path and neither needs an aggregation over every invoice line.
 *
 * `extendedPrice` carries its natural sign (returns are negative), so SUM is
 * already net spend.
 */
import { prisma } from "@/lib/prisma"
import { normalizeVendorName } from "@/lib/vendor-normalize"

export type CanonicalSpend = {
  spend: number
  lineCount: number
  /** Normalised, most-recent-first is not guaranteed; order is insertion. */
  vendors: string[]
  skus: string[]
  lastPurchaseAt: Date | null
}

export const DEFAULT_SPEND_WINDOW_DAYS = 90

export async function batchCanonicalSpend(
  accountId: string,
  days: number = DEFAULT_SPEND_WINDOW_DAYS
): Promise<Map<string, CanonicalSpend>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const lines = await prisma.invoiceLineItem.findMany({
    where: {
      canonicalIngredientId: { not: null },
      invoice: { accountId, invoiceDate: { gte: since, not: null } },
    },
    select: {
      canonicalIngredientId: true,
      extendedPrice: true,
      sku: true,
      invoice: { select: { vendorName: true, invoiceDate: true } },
    },
  })

  const out = new Map<string, CanonicalSpend>()
  const vendorSets = new Map<string, Set<string>>()
  const skuSets = new Map<string, Set<string>>()

  for (const li of lines) {
    const id = li.canonicalIngredientId
    if (!id) continue

    const row = out.get(id) ?? { spend: 0, lineCount: 0, vendors: [], skus: [], lastPurchaseAt: null }
    row.spend += li.extendedPrice
    row.lineCount += 1
    const d = li.invoice.invoiceDate
    if (d && (row.lastPurchaseAt == null || d > row.lastPurchaseAt)) row.lastPurchaseAt = d
    out.set(id, row)

    const vs = vendorSets.get(id) ?? new Set<string>()
    vs.add(normalizeVendorName(li.invoice.vendorName))
    vendorSets.set(id, vs)

    const sku = li.sku?.trim()
    if (sku) {
      const ss = skuSets.get(id) ?? new Set<string>()
      ss.add(sku)
      skuSets.set(id, ss)
    }
  }

  for (const [id, row] of out) {
    row.vendors = [...(vendorSets.get(id) ?? [])]
    row.skus = [...(skuSets.get(id) ?? [])]
  }

  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/canonical-spend-batch.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/canonical-spend-batch.ts tests/lib/canonical-spend-batch.test.ts
git commit -m "feat(pantry): batch 90-day spend, vendors and SKUs per canonical ingredient"
```

---

### Task 4: Ledger row loader

**Files:**
- Create: `src/app/actions/pantry-ledger-actions.ts`
- Test: `tests/app/actions/pantry-ledger-actions.test.ts`

**Interfaces:**
- Consumes: `listCanonicalIngredients` (unchanged), `batchCanonicalSpend`, `stationFor`, `isPackagingStation`
- Produces: `type PantryLedgerRow`, `type PantryLedgerData`, `listPantryLedger(): Promise<PantryLedgerData>`

`PantryLedgerRow` extends the summary with `station: PantryStation`, `isPackaging: boolean`, `spend90: number`, `vendors: string[]`, `skus: string[]`, `lastPurchaseAt: Date | null`, and `impact90: number | null` (`spend90 * pctChange / 100`, null when there is no trend). `PantryLedgerData` carries `rows` sorted by `spend90` descending plus `totals` (`spend`, `foodSpend`, `packagingSpend`, `count`) and `stations` (name, itemCount, spend), stations sorted by spend with packaging forced last.

- [ ] **Step 1: Write the failing test** covering: rows sorted by spend descending; `impact90` computed from spend and trend; a null trend yielding a null impact; station and packaging flags applied from `stationFor`; totals splitting food from packaging; stations sorted by spend with `Packaging & Supplies` last regardless of its spend. Mock `listCanonicalIngredients` and `batchCanonicalSpend`; do not mock `stationFor` — its behaviour is part of the contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/actions/pantry-ledger-actions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `listPantryLedger`**

Mark the file `"use server"`. Resolve the session scope the same way `listCanonicalIngredients` does and return empty data when there is no session. Call `listCanonicalIngredients()` and `batchCanonicalSpend(accountId)` in a single `Promise.all`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app/actions/pantry-ledger-actions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/pantry-ledger-actions.ts tests/app/actions/pantry-ledger-actions.test.ts
git commit -m "feat(pantry): compose spend-ranked ledger rows with stations and dollar impact"
```

---

### Task 5: Ingredient history loader for the drill-down

**Files:**
- Modify: `src/app/actions/canonical-ingredient-actions.ts` (add `getPantryIngredientHistory`)
- Test: `tests/app/actions/pantry-ingredient-history.test.ts`

**Interfaces:**
- Produces: `getPantryIngredientHistory(canonicalId: string): Promise<PantryIngredientHistory>` returning `series` (`{ date, unitPrice, unit, vendor, sku }[]`, oldest first, capped at the 60 most recent), `deliveries` (the 8 most recent, newest first, each with `invoiceId`, `invoiceNumber`, `productName`, `sku`, `quantity`, `unit`, `unitPrice`, `extendedPrice`), `products` (grouped by SKU: `sku`, `productName`, `vendor`, `firstAt`, `lastAt`, `lastUnitPrice`, `spend`), and `recipes` (`{ recipeName, quantity, unit, costPerServing }[]` using `computeIngredientLineCost` divided by `servingSize`).

The delivery rows carry the **raw invoice `productName`**, not the canonical name — that difference is the point: it is what shows an owner that `IMPLOT POTATO FRY 1/4 CLR SS` and `LAMB POTATO FRY SS 1/4 STEALTH` are two products under one ingredient.

- [ ] **Step 1: Write the failing test** covering: series ordered oldest→newest and capped at 60; products grouped by SKU with `lastUnitPrice` from the newest line in that SKU; `costPerServing` divided by `servingSize`; `costPerServing` null when `computeIngredientLineCost` cannot reconcile units; empty history returning empty arrays rather than throwing.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/actions/pantry-ingredient-history.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement it**, reusing `computeIngredientLineCost` from `@/lib/recipe-cost` so per-serving costs match every other cost walk in the app.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/canonical-ingredient-actions.ts tests/app/actions/pantry-ingredient-history.test.ts
git commit -m "feat(pantry): load per-ingredient price series, deliveries, SKU groups and recipe impact"
```

---

### Task 6: Ledger presentation helpers

Pure formatting, extracted so it is testable under the node-only Vitest config.

**Files:**
- Create: `src/lib/pantry-format.ts`
- Test: `tests/lib/pantry-format.test.ts`

**Interfaces:**
- Produces: `formatUnitPrice(cost: number | null): string | null` and `MATERIAL_IMPACT_USD = 250`, plus `isMaterialImpact(impact: number | null): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/pantry-format.test.ts
// Three live tiles render "$0.00" today because sub-cent unit prices go
// through toFixed(2). A price that exists must never display as zero.
import { describe, it, expect } from "vitest"
import { formatUnitPrice, isMaterialImpact } from "@/lib/pantry-format"

describe("formatUnitPrice", () => {
  it("uses two decimals at or above a dollar", () => {
    expect(formatUnitPrice(4.331)).toBe("$4.33")
    expect(formatUnitPrice(1)).toBe("$1.00")
  })

  it("adds precision below a dollar rather than rounding to zero", () => {
    expect(formatUnitPrice(0.326)).toBe("$0.326")
    expect(formatUnitPrice(0.0036)).toBe("$0.0036")
    expect(formatUnitPrice(0.00012)).toBe("$0.00012")
  })

  it("never returns $0.00 for a non-zero price", () => {
    for (const p of [0.004, 0.0004, 0.00004]) expect(formatUnitPrice(p)).not.toBe("$0.00")
  })

  it("returns null for an unknown price", () => {
    expect(formatUnitPrice(null)).toBeNull()
  })
})

describe("isMaterialImpact", () => {
  it("treats a quarterly dollar impact of $250 or more as material, either direction", () => {
    expect(isMaterialImpact(250)).toBe(true)
    expect(isMaterialImpact(-8676)).toBe(true)
    expect(isMaterialImpact(26)).toBe(false)
    expect(isMaterialImpact(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/pantry-format.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/lib/pantry-format.ts
/**
 * Display rules for the Pantry ledger.
 *
 * `formatUnitPrice` widens precision instead of rounding to zero. Three tiles
 * on the live page render "$0.00" for real sub-cent prices (Soda Orange Fanta,
 * Soda Sprite, Ketchup Packets), which reads to an owner as "free".
 */

/** A quarterly dollar impact at or above this earns the red accent. */
export const MATERIAL_IMPACT_USD = 250

export function formatUnitPrice(cost: number | null): string | null {
  if (cost == null) return null
  if (cost >= 1) return "$" + cost.toFixed(2)
  if (cost >= 0.01) return "$" + cost.toFixed(3)
  if (cost >= 0.001) return "$" + cost.toFixed(4)
  return "$" + cost.toPrecision(2)
}

export function isMaterialImpact(impact: number | null): boolean {
  return impact != null && Math.abs(impact) >= MATERIAL_IMPACT_USD
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/pantry-format.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/pantry-format.ts tests/lib/pantry-format.test.ts
git commit -m "feat(pantry): format sub-cent unit prices without collapsing them to zero"
```

---

### Task 7: Ledger UI

Build against the visual spec artifact. Editorial tokens only; ingredient names in DM Sans 500, never Fraunces.

**Files:**
- Create: `src/app/dashboard/ingredients/components/ledger/pantry-ledger.tsx` — table shell, station filter state, 12-row head with an explicit "Show all N" control naming what is hidden, rank renumbering on filter
- Create: `src/app/dashboard/ingredients/components/ledger/station-strip.tsx` — ranked station list doubling as the filter; bars use `--ink-ornament`, the selected bar uses `--ink` (**not** `--accent`)
- Create: `src/app/dashboard/ingredients/components/ledger/ledger-row.tsx` — one summary row; multi-SKU rows show an `N products` flag in `--accent-dark`
- Create: `src/app/dashboard/ingredients/components/ledger/ingredient-panel.tsx` — the expanded panel: SKU-segmented price chart, deliveries with invoice links, products-by-SKU, recipe impact
- Create: `src/app/dashboard/ingredients/components/ledger/price-chart.tsx` — inline SVG, path broken at each SKU change with a dashed rule, endpoint dot in `--accent` only when the price rose
- Modify: `src/styles/editorial-dashboard.css` — append a `.pantry-ledger` block

- [ ] **Step 1: Build the components** to match the artifact. Delivery date links to `/dashboard/invoices/${invoiceId}` with `target="_blank" rel="noreferrer"` so the ledger keeps its scroll position.
- [ ] **Step 2: Accessibility pass.** The row toggle is a real `<button>` with `aria-expanded` and `aria-controls`. Station filters are `<button aria-pressed>`. Chart `<svg>` carries `role="img"` and an `aria-label` naming the range and, when SKUs change, the number of products. Focus rings visible against warm paper.
- [ ] **Step 3: `npx tsc --noEmit`** — expect PASS.
- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/ingredients/components/ledger src/styles/editorial-dashboard.css
git commit -m "feat(pantry): ledger, station strip and SKU-segmented ingredient panel"
```

---

### Task 8: Wire the ledger into the page

**Files:**
- Modify: `src/app/dashboard/ingredients/components/sections/pantry-section.tsx` — load `listPantryLedger()` alongside the existing loaders
- Modify: `src/app/dashboard/ingredients/components/pantry-view.tsx` — add a Ledger/Cards view toggle, Ledger default
- Keep: `ingredients-pantry.tsx` untouched and reachable as the Cards view

- [ ] **Step 1: Wire it up**, defaulting to the ledger and keeping the tile grid behind the toggle so the change is reversible without a revert.
- [ ] **Step 2: Full gate.**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all PASS.

- [ ] **Step 3: Verify in the browser.** Start the dev server with `SERVICE_SHUTDOWN_AT=""`, sign in, and confirm against the artifact: ground beef is row 01, four rows carry red impact figures, the fry panel shows the product-change breaks, an invoice link opens `/dashboard/invoices/[id]` in a new tab, and `Soda Coke Mexican Glass` reads `$0.0036/ml` rather than `$0.00`.
- [ ] **Step 4: Confirm mobile is unaffected.** Load `/m/ingredients` and confirm it still renders and that trend percentages appear.
- [ ] **Step 5: Commit and push**

```bash
git add src/app/dashboard/ingredients
git commit -m "feat(pantry): make the spend-ranked ledger the default pantry view"
git push -u origin feat/pantry-ledger
```

---

## Self-review notes

- **Spec coverage:** stations (Task 1), SKU-aware trends (Task 2), spend ranking (Tasks 3–4), drill-down with history and invoice provenance (Tasks 5, 7), sub-cent prices and red rationing (Task 6), 12-row default with named remainder (Task 7), `listCanonicalIngredients` left alone (Tasks 3–4). Increments 2–4 are explicitly out of scope.
- **Known risk:** Task 2 changes numbers users have already seen. The fry's headline moves from a SKU-blind figure to a within-SKU one, and some ingredients lose their trend entirely because no valid within-SKU baseline exists. That is the correct outcome, and Task 7's `N products` flag is what explains it on screen.
- **Deliberately deferred:** `Fuel Surcharge` still appears as an ingredient; ingredient display names are still raw vendor strings; the review inbox and auto-match strip still sit above the ledger until increment 2.
