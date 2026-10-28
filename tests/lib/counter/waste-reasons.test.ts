// waste-reasons — one taxonomy for stock that left the shelf unsold, and the
// count report that has to add up under it.
//
// Two forms wrote `InventoryAdjustment.reason` with two vocabularies (EXPIRY
// was "Expired" on one and "Went bad" on the other), and the count report
// summed every reason into each row's "waste" while its "Waste $" total
// counted only the waste log's five — so its rows did not add up to its
// totals, and theft and supplier returns were reported as waste.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    stockCount: { findMany: vi.fn() },
    countItem: { findMany: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
    stockCountLine: { findMany: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
    inventoryAdjustment: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/inventory/store-inventory-context", () => ({
  loadStoreInventoryContext: vi.fn(),
  runningOnHandFromContext: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { runningOnHandFromContext } from "@/lib/inventory/store-inventory-context"
import { InventoryAdjustmentReason } from "@/generated/prisma/enums"
import {
  ADJUSTMENT_REASONS,
  ADJUST_FORM_REASONS,
  WASTE_LOG_REASONS,
  reasonClass,
  reasonLabel,
  sumAdjustments,
} from "@/lib/counter/waste-reasons"
import { WASTE_REASONS } from "@/lib/counter/count-layers"
import { loadLoggedAdjustments } from "@/lib/counter/logged-waste"
import { getCountReportSectionPromises, type GapRow } from "@/lib/counter/adapters/count"
import { hasData } from "@/lib/counter/section-data"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe("the reason taxonomy", () => {
  it("covers every reason the schema stores, once", () => {
    const ids = ADJUSTMENT_REASONS.map((r) => r.id).sort()
    expect(ids).toEqual(Object.values(InventoryAdjustmentReason).sort())
  })

  it("puts each reason in its class", () => {
    for (const id of ["DROPPED", "EXPIRY", "BURNT", "REMAKE", "DAMAGE"]) {
      expect(reasonClass(id)).toBe("waste")
    }
    expect(reasonClass("THEFT")).toBe("shrink")
    expect(reasonClass("SUPPLIER_RETURN")).toBe("return")
    expect(reasonClass("OTHER")).toBe("other")
    // An unknown reason is never silently waste.
    expect(reasonClass("SOMETHING_NEW")).toBe("other")
  })

  it("labels EXPIRY the same on both forms", () => {
    const onLog = WASTE_LOG_REASONS.find((r) => r.id === "EXPIRY")!.label
    const onAdjust = ADJUST_FORM_REASONS.find((r) => r.id === "EXPIRY")!.label
    expect(onLog).toBe("Went bad")
    expect(onAdjust).toBe(onLog)
    expect(reasonLabel("EXPIRY")).toBe("Went bad")
  })

  it("keeps the stored values each form already writes", () => {
    expect(WASTE_REASONS.map((r) => r.id)).toEqual(["DROPPED", "EXPIRY", "BURNT", "REMAKE", "OTHER"])
    expect(ADJUST_FORM_REASONS.map((r) => r.id).sort()).toEqual(
      ["DAMAGE", "EXPIRY", "OTHER", "SUPPLIER_RETURN", "THEFT"],
    )
  })

  it("values entries by class", () => {
    const t = sumAdjustments([
      { reason: "DROPPED", qty: 2, cost: 3 },
      { reason: "DAMAGE", qty: 1, cost: 3 },
      { reason: "THEFT", qty: 4, cost: 1 },
      { reason: "SUPPLIER_RETURN", qty: 5, cost: 2 },
      { reason: "OTHER", qty: 1, cost: null },
    ])
    expect(t.dollars).toEqual({ waste: 9, shrink: 4, return: 10, other: 0 })
    expect(t.entries).toEqual({ waste: 2, shrink: 1, return: 1, other: 1 })
  })

  it("scopes the logged-waste figure to the account through Store", async () => {
    asMock(prisma.$queryRaw).mockResolvedValue([{ reason: "BURNT", qty: 2, cost: 5 }])
    const t = await loadLoggedAdjustments({
      accountId: "acct_ours",
      storeIds: null,
      from: new Date(0),
      to: new Date(),
    })
    expect(t.dollars.waste).toBe(10)
    const call = asMock(prisma.$queryRaw).mock.calls[0]
    expect((call[0] as TemplateStringsArray).join(" ")).toContain(`s."accountId" =`)
    expect(call.slice(1)).toContain("acct_ours")
  })
})

/* ── The count report adds up ─────────────────────────────────────────── */

const PREV = new Date("2026-10-20T15:00:00Z")
const CUR = new Date("2026-10-27T15:00:00Z")

beforeEach(() => {
  vi.clearAllMocks()
  asMock(prisma.store.findMany).mockResolvedValue([{ id: "store_a", name: "Hollywood" }])
  asMock(prisma.stockCount.findMany).mockResolvedValue([
    { id: "sc_cur", countedAt: CUR },
    { id: "sc_prev", countedAt: PREV },
  ])
  asMock(prisma.countItem.findMany).mockResolvedValue([])
  asMock(prisma.invoiceLineItem.findMany).mockResolvedValue([])
  asMock(prisma.stockCountLine.findMany).mockResolvedValue([
    { canonicalIngredientId: "ci_beef", qtyInRecipeUnit: 80 },
    { canonicalIngredientId: "ci_buns", qtyInRecipeUnit: 60 },
  ])
  asMock(prisma.canonicalIngredient.findMany).mockResolvedValue([
    { id: "ci_beef", name: "beef", recipeUnit: "lb", costPerRecipeUnit: 5 },
    { id: "ci_buns", name: "buns", recipeUnit: "each", costPerRecipeUnit: 0.5 },
  ])
  const at = new Date("2026-10-24T12:00:00Z")
  asMock(prisma.inventoryAdjustment.findMany).mockResolvedValue([
    { canonicalIngredientId: "ci_beef", reason: "DROPPED", qty: 2, occurredAt: at, canonicalIngredient: { costPerRecipeUnit: 5 } },
    { canonicalIngredientId: "ci_beef", reason: "THEFT", qty: 3, occurredAt: at, canonicalIngredient: { costPerRecipeUnit: 5 } },
    { canonicalIngredientId: "ci_buns", reason: "SUPPLIER_RETURN", qty: 10, occurredAt: at, canonicalIngredient: { costPerRecipeUnit: 0.5 } },
    { canonicalIngredientId: "ci_buns", reason: "EXPIRY", qty: 4, occurredAt: at, canonicalIngredient: { costPerRecipeUnit: 0.5 } },
    // Logged against an item not counted both times: on no row.
    { canonicalIngredientId: "ci_fries", reason: "BURNT", qty: 1, occurredAt: at, canonicalIngredient: { costPerRecipeUnit: 2 } },
  ])
  // beef: should 90, counted 80 → 10 lb short. buns: should 50, counted 60 → 10 extra.
  asMock(runningOnHandFromContext).mockImplementation((_ctx: unknown, ing: { id: string }) =>
    ing.id === "ci_beef"
      ? { baseAt: PREV, baseQty: 100, deliveriesQty: 20, depletionQty: 25, adjustmentsQty: 5, onHand: 90, partial: false }
      : { baseAt: PREV, baseQty: 50, deliveriesQty: 24, depletionQty: 10, adjustmentsQty: 14, onHand: 50, partial: false },
  )
})

async function report() {
  const s = await getCountReportSectionPromises({ accountId: "acct_ours" }).report
  if (!hasData(s) || s.data === null) throw new Error("report did not load")
  return s.data
}

describe("count report · rows add up to the totals", () => {
  it("splits each row's adjustments by class, and every row balances", async () => {
    const d = await report()
    const beef = d.rows.find((r) => r.name === "beef")!
    expect(beef.waste).toBe(2)
    expect(beef.theft).toBe(3)
    expect(beef.wasteDollars).toBe(10)
    expect(beef.theftDollars).toBe(15)
    const buns = d.rows.find((r) => r.name === "buns")!
    expect(buns.waste).toBe(4)
    expect(buns.returned).toBe(10)
    for (const r of d.rows) {
      expect(r.last + r.delivered - r.used - r.waste - r.theft - r.returned - r.other).toBeCloseTo(r.should)
    }
  })

  it("totals are the rows summed, class by class", async () => {
    const d = await report()
    const sum = (f: (r: GapRow) => number) => d.rows.reduce((t, r) => t + f(r), 0)
    expect(d.wasteDollars).toBe(sum((r) => r.wasteDollars))
    expect(d.theftDollars).toBe(sum((r) => r.theftDollars))
    expect(d.returnDollars).toBe(sum((r) => r.returnDollars))
    expect(d.wasteDollars).toBe(12) // $10 beef dropped + $2 buns went bad
    expect(d.theftDollars).toBe(15)
    expect(d.returnDollars).toBe(5)
    expect(d.wasteEntries).toBe(2)
    // The fries entry is reported apart, not folded into a row's total.
    expect(d.offReportEntries).toBe(1)
    expect(d.offReportDollars).toBe(2)
  })

  it("missing is shortages only, and overages are their own figure", async () => {
    const d = await report()
    expect(d.missingDollars).toBe(50) // 10 lb beef × $5
    expect(d.extraDollars).toBe(5) // 10 buns × $0.50
  })

  it("reads every reason over the window the should-have walk subtracts", async () => {
    await report()
    const where = asMock(prisma.inventoryAdjustment.findMany).mock.calls[0][0].where
    expect(where.reason).toBeUndefined()
    expect(where.store).toEqual({ accountId: "acct_ours" })
    expect(where.occurredAt.gt).toEqual(PREV)
    expect(where.occurredAt.lte.getTime()).toBe(CUR.getTime() - 1)
  })
})
