// batchCanonicalCosts — the same price the detail page would show.
//
// This is the list-view path: every ingredients table, every recipe costing
// that goes through `recipe-cost-batch`. It read ONE invoice line per
// canonical, which meant the spike guard — which judges the newest line
// against the median of the lines before it — had nothing to judge against
// and never ran. A pack-metadata mis-parse that `getCanonicalIngredientCost`
// rejects on the ingredient's own page was priced into every recipe on the
// list beside it.
//
// It also never set `costGuardTriggered`, the flag `recipe-cost.ts` reads to
// mark a recipe partial, so the flag could only ever be raised by the path
// nothing costs recipes through.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findMany: vi.fn() },
    ingredientSkuMatch: { findMany: vi.fn() },
    ingredientAlias: { findMany: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { prisma } from "@/lib/prisma"
import { batchCanonicalCosts } from "@/lib/canonical-cost-batch"

const GROUND_BEEF = {
  id: "ci_beef",
  recipeUnit: "lb",
  costPerRecipeUnit: null,
  costSource: null,
  costUpdatedAt: null,
}

/** A catch-weight line: unit === unitSizeUom, so quantity IS the total pounds. */
function line(day: string, quantity: number, extendedPrice: number) {
  return {
    canonicalIngredientId: "ci_beef",
    lineItemId: `li_${day}`,
    invoiceId: `inv_${day}`,
    sku: "12345",
    productName: "GROUND BEEF 80/20",
    quantity,
    unit: "LB",
    packSize: null,
    unitSize: null,
    unitSizeUom: "LB",
    unitPrice: extendedPrice / quantity,
    extendedPrice,
    invoiceDate: new Date(`${day}T00:00:00.000Z`),
    vendorName: "Premier Meats",
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([GROUND_BEEF] as never)
  vi.mocked(prisma.ingredientSkuMatch.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ingredientAlias.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.invoiceLineItem.findMany).mockResolvedValue([] as never)
})

describe("batchCanonicalCosts — the spike guard on the list path", () => {
  it("rejects a mis-parsed newest line and prices off the last sane one", async () => {
    // $4.00/lb, $4.00/lb, then a line whose quantity came off the invoice as 1
    // instead of 100 — $400.00/lb.
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      line("2026-09-15", 1, 400),
      line("2026-09-08", 100, 400),
      line("2026-09-01", 100, 400),
    ] as never)

    const costs = await batchCanonicalCosts("acct_1")
    const beef = costs.get("ci_beef")

    expect(beef?.unitCost).toBe(4)
    expect(beef?.sourceLineItemId).toBe("li_2026-09-08")
    // The date follows the line we actually priced off, not the one we threw out.
    expect(beef?.asOfDate.toISOString().slice(0, 10)).toBe("2026-09-08")
  })

  it("raises costGuardTriggered so the recipes built on it read as partial", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      line("2026-09-15", 1, 400),
      line("2026-09-08", 100, 400),
      line("2026-09-01", 100, 400),
    ] as never)

    expect((await batchCanonicalCosts("acct_1")).get("ci_beef")?.costGuardTriggered).toBe(true)
  })

  it("leaves the flag down and takes the newest line when nothing is out of band", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      line("2026-09-15", 100, 450),
      line("2026-09-08", 100, 400),
    ] as never)

    const beef = (await batchCanonicalCosts("acct_1")).get("ci_beef")
    expect(beef?.unitCost).toBe(4.5)
    expect(beef?.costGuardTriggered).toBe(false)
    expect(beef?.sourceLineItemId).toBe("li_2026-09-15")
  })

  it("asks for a window of lines per canonical, not a single newest row", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
    await batchCanonicalCosts("acct_1")
    const sql = vi.mocked(prisma.$queryRaw).mock.calls[0]?.[0] as { strings: string[] }
    const text = sql.strings.join("")
    // DISTINCT ON collapses to one row per canonical, which is what left the
    // guard with no history to judge against.
    expect(text).not.toContain("DISTINCT ON")
    expect(text).toContain("ROW_NUMBER()")
  })
})
