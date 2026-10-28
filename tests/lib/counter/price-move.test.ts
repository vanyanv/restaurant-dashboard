// price-move — the one definition of "how far has this ingredient's price
// moved", and the pages that print it.
//
// Before this module there were five: the Ingredients list read a weekly
// median of RAW unit prices 30 days apart, the detail page first-to-last of
// eight weekly medians, COGS two single normalised readings with no spike
// guard, and the Prices page the latest normalised cost against a trailing
// median. These tests hold three things:
//
//   1. The arithmetic: trailing median baseline, the booked-cost spike guard
//      on the latest reading, held moves, too-few readings.
//   2. The money is in RECIPE units. The Prices page multiplied a
//      per-recipe-unit Δ by a volume summed in the invoice's base unit, which
//      put an ingredient costed per ounce and billed by the pound 16× low.
//   3. The same ingredient gets the same move on every adapter that prints
//      one.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findMany: vi.fn(), findFirst: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
    ingredientSkuMatch: { findMany: vi.fn() },
    recipeIngredient: { findMany: vi.fn() },
    stockCountLine: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/recipe-cost", () => ({ batchRecipeCosts: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import {
  loadPriceMoves,
  priceMoveOf,
  pricedReadingOf,
  type PriceLine,
  type PricedReading,
} from "@/lib/counter/price-move"
import { getLineItemBaseQty } from "@/lib/invoice-line-shape"
import { loadPrices, getPriceSections } from "@/lib/counter/adapters/prices"
import { getIngredientsSectionPromises } from "@/lib/counter/adapters/ingredients"
import { getIngredientSectionPromises } from "@/lib/counter/adapters/ingredient"
import { buildMoved } from "@/lib/counter/adapters/cogs"
import { hasData } from "@/lib/counter/section-data"
import type { CellObject } from "@/components/counter"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const TODAY = new Date("2026-09-20T19:00:00Z")
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)

const reading = (iso: string, cost: number, qty = 1): PricedReading => ({
  at: day(iso),
  cost,
  qty,
  key: "sku",
  shape: 1,
})

/* ── 1. The arithmetic ────────────────────────────────────────────────── */

describe("priceMoveOf", () => {
  const since = day("2026-08-21")

  it("compares the latest reading against the median of everything older", () => {
    const m = priceMoveOf(
      [reading("2026-07-01", 1), reading("2026-07-15", 3), reading("2026-08-01", 2), reading("2026-09-10", 2.5)],
      since,
    )
    expect(m).not.toBeNull()
    expect(m!.baseline).toBe(2)
    expect(m!.latest).toBe(2.5)
    expect(m!.move).toBeCloseTo(0.25)
    expect(m!.setAside).toEqual([])
    expect(m!.held).toBe(false)
  })

  it("sets a pack mis-parse aside the way booked costs do, and measures from the reading before it", () => {
    const m = priceMoveOf(
      [reading("2026-07-01", 4.6), reading("2026-07-15", 4.6), reading("2026-08-01", 4.8), reading("2026-09-10", 50.88)],
      since,
    )
    expect(m!.setAside.map((r) => r.cost)).toEqual([50.88])
    expect(m!.latest).toBe(4.8)
    expect(m!.baseline).toBe(4.6)
    expect(m!.move).toBeCloseTo(0.2 / 4.6)
  })

  it("has no move with fewer than three priced readings", () => {
    expect(priceMoveOf([reading("2026-07-01", 1), reading("2026-09-10", 2)], since)).toBeNull()
  })

  it("counts only the last 30 days of volume, credits netted, into the money", () => {
    const m = priceMoveOf(
      [
        reading("2026-07-01", 1, 100),
        reading("2026-08-01", 1, 100),
        reading("2026-09-01", 1.2, 10),
        reading("2026-09-10", 1.2, -2),
        reading("2026-09-12", 1.5, 10),
      ],
      since,
    )
    expect(m!.baseline).toBeCloseTo(1.1)
    expect(m!.volume30).toBe(18)
    expect(m!.impact30).toBeCloseTo(0.4 * 18)
  })
})

/* ── 2. Units ─────────────────────────────────────────────────────────── */

const caseOf10lb = (iso: string, price: number): PriceLine => ({
  sku: "BEEF10",
  productName: "ground beef 10 lb",
  quantity: 1,
  unit: "CS",
  packSize: 1,
  unitSize: 10,
  unitSizeUom: "LB",
  unitPrice: price,
  extendedPrice: price,
  invoice: { invoiceDate: day(iso) },
})

describe("$ impact is Δ per recipe unit × recipe units bought", () => {
  it("prices a 10 lb case per ounce and counts its volume in ounces, not pounds", () => {
    const r = pricedReadingOf(caseOf10lb("2026-09-10", 20), "oz")!
    expect(r.cost).toBeCloseTo(20 / 160)
    expect(r.qty).toBeCloseTo(160)
    // The base quantity the Prices page used to sum is 10 — in POUNDS.
    expect(getLineItemBaseQty(caseOf10lb("2026-09-10", 20))!.totalBaseQty).toBe(10)
  })

  it("gives the same dollars whichever recipe unit the ingredient is costed in", () => {
    const lines = [
      caseOf10lb("2026-07-01", 20),
      caseOf10lb("2026-08-01", 20),
      caseOf10lb("2026-09-10", 24),
    ]
    const since = day("2026-08-21")
    const inOz = priceMoveOf(lines.map((l) => pricedReadingOf(l, "oz")!), since)!
    const inLb = priceMoveOf(lines.map((l) => pricedReadingOf(l, "lb")!), since)!
    // One case, $4 dearer: $4 of impact either way.
    expect(inOz.impact30).toBeCloseTo(4)
    expect(inLb.impact30).toBeCloseTo(4)
    expect(inOz.volume30).toBeCloseTo(160)
    expect(inLb.volume30).toBeCloseTo(10)
    expect(inOz.move).toBeCloseTo(inLb.move)
  })
})

/* ── 3. Every adapter prints the same move ────────────────────────────── */

const ACCOUNT = "acct_ours"
const CANONICAL = {
  id: "ci_beef",
  accountId: ACCOUNT,
  name: "ground beef",
  category: "Protein",
  recipeUnit: "oz",
  costPerRecipeUnit: 0.15,
  costSource: "invoice",
  costLocked: false,
  caseUnit: null,
  recipeUnitsPerCase: null,
  innerPackUnit: null,
  innerPacksPerCase: null,
  _count: { recipeIngredients: 3 },
  skuMatches: [],
}

// $20 → $20 → $20 → $27.40 a case: +37% against the trailing median.
const LINES = [
  { ...caseOf10lb("2026-06-10", 20), canonicalIngredientId: "ci_beef" },
  { ...caseOf10lb("2026-07-10", 20), canonicalIngredientId: "ci_beef" },
  { ...caseOf10lb("2026-08-10", 20), canonicalIngredientId: "ci_beef" },
  { ...caseOf10lb("2026-09-15", 27.4), canonicalIngredientId: "ci_beef" },
]

const CATALOGUE_ROW = {
  id: "ci_beef",
  name: "ground beef",
  category: "Protein",
  vendors: 1,
  last_price: 27.4,
  last_unit: "CS",
  recipes: 3,
  spend30: 27.4,
  spend_chart: 87.4,
  costed: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  asMock(prisma.canonicalIngredient.findMany).mockImplementation(async (args: { where?: { accountId?: string } }) =>
    args?.where?.accountId === ACCOUNT ? [CANONICAL] : [],
  )
  asMock(prisma.canonicalIngredient.findFirst).mockResolvedValue(CANONICAL)
  asMock(prisma.invoiceLineItem.findMany).mockImplementation(
    async (args: { where?: { invoice?: { accountId?: string } } }) =>
      args?.where?.invoice?.accountId === ACCOUNT ? LINES : [],
  )
  asMock(prisma.ingredientSkuMatch.findMany).mockResolvedValue([])
  asMock(prisma.recipeIngredient.findMany).mockResolvedValue([])
  asMock(prisma.stockCountLine.count).mockResolvedValue(0)
  asMock(prisma.$queryRaw).mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ")
    if (sql.includes("newest AS")) return [CATALOGUE_ROW]
    if (sql.includes("AS recent")) return [{ total: 1, recent: 0, costed: 1 }]
    return []
  })
  asMock(getScopedStores).mockResolvedValue([{ id: "store_a" }])
  asMock(batchRecipeCosts).mockResolvedValue(new Map())
})

const text = (c: unknown) => (typeof c === "string" ? c : (c as CellObject).v)

describe("the same ingredient gets the same move on every page", () => {
  it("is +37% in the shared function", async () => {
    const set = await loadPriceMoves({ accountId: ACCOUNT, asOf: TODAY })
    expect(set.moves.get("ci_beef")!.move).toBeCloseTo(0.37)
  })

  it("is +37% on the Prices page, with the money in ounces", async () => {
    const d = await loadPrices(ACCOUNT, { asOf: TODAY })
    const beef = d.movers.find((m) => m.id === "ci_beef")!
    expect(beef.move).toBeCloseTo(0.37)
    // One case bought in the last 30 days = 160 oz, $0.04625/oz dearer.
    expect(beef.volume).toBeCloseTo(160)
    expect(beef.costs).toBeCloseTo(7.4)
    const s = await getPriceSections(ACCOUNT)
    if (!hasData(s.movers)) throw new Error("movers did not load")
    expect(text(s.movers.data.rows[0].cells.move)).toContain("37")
  })

  it("is ▲ 37% in the Ingredients list's move column", async () => {
    const s = getIngredientsSectionPromises({
      storeId: null,
      accountId: ACCOUNT,
      range: { start: new Date(2026, 8, 20), end: new Date(2026, 8, 20) },
      today: TODAY,
    })
    const catalogue = await s.catalogue
    if (!hasData(catalogue)) throw new Error(`catalogue did not load: ${JSON.stringify(catalogue)}`)
    expect(text(catalogue.data.rows[0].cells.move)).toBe("▲ 37%")
  })

  it("is ▲ 37% on the ingredient's own page", async () => {
    const s = getIngredientSectionPromises({
      ingredientId: "ci_beef",
      accountId: ACCOUNT,
      storeId: null,
      range: { start: new Date(2026, 8, 20), end: new Date(2026, 8, 20) },
      today: TODAY,
    })
    const head = await s.head
    if (!hasData(head)) throw new Error("head did not load")
    expect(head.data.cells[0].delta).toBe("▲ 37% vs 120-day median")
  })

  it("is ▲ 37% in COGS' What moved, from the same baseline and latest", async () => {
    const set = await loadPriceMoves({ accountId: ACCOUNT, asOf: TODAY })
    const moved = buildMoved([...set.moves.values()])
    expect(moved.rows[0].change).toContain("37")
    expect(moved.rows[0].then).toBe("$0.13")
  })

  it("never reads another account's lines", async () => {
    await loadPriceMoves({ accountId: ACCOUNT, asOf: TODAY })
    const where = asMock(prisma.invoiceLineItem.findMany).mock.calls[0][0].where
    expect(where.invoice.accountId).toBe(ACCOUNT)
    expect(asMock(prisma.canonicalIngredient.findMany).mock.calls[0][0].where.accountId).toBe(ACCOUNT)
  })

  it("scopes to a store's invoices when the page is store-scoped", async () => {
    await loadPriceMoves({ accountId: ACCOUNT, asOf: TODAY, storeIds: ["store_a"] })
    const where = asMock(prisma.invoiceLineItem.findMany).mock.calls[0][0].where
    expect(where.invoice.storeId).toEqual({ in: ["store_a"] })
  })
})
