// Menu catalog — an item nothing has costed has no plate cost.
//
// The materializer writes `DailyCogsItem` rows for every sold item: COSTED
// ones with a real `lineCost`, and UNMAPPED / MISSING_COST ones with real
// revenue and quantity at $0 `lineCost`. The catalog grouped every status, so
// an unmapped item printed a $0.00 plate cost and a 100% margin, and an item
// unmapped for part of the range had its plate cost averaged down over the
// units sold while nothing costed it. Only COSTED rows say what a plate costs.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    otterMenuItem: { findMany: vi.fn() },
    otterItemMapping: { findMany: vi.fn() },
    otterSubItemMapping: { findMany: vi.fn() },
    dailyCogsItem: { groupBy: vi.fn() },
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/app/actions/mapping-proposal-actions", () => ({ listMappingProposals: vi.fn() }))
vi.mock("@/lib/counter/item-discounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/counter/item-discounts")>()),
  getItemDiscounts: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { listMappingProposals } from "@/app/actions/mapping-proposal-actions"
import { getItemDiscounts } from "@/lib/counter/item-discounts"
import { getMenuCatalogSectionPromises } from "@/lib/counter/adapters/menu-catalog"
import { cogsGroupBy, cogsRow } from "../fixtures/item-economics"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

/** DailyCogsItem rows; the groupBy stand-in folds them the way Postgres would. */
const COGS = [
  cogsRow({ itemName: "Burger", lineCost: 40, salesRevenue: 100, qtySold: 10 }),
  // Unmapped for part of the range: 10 more sold at $0 cost.
  cogsRow({ itemName: "Burger", status: "UNMAPPED", recipeId: null, salesRevenue: 100, qtySold: 10 }),
  cogsRow({ itemName: "Fries", status: "UNMAPPED", recipeId: null, salesRevenue: 50, qtySold: 10 }),
  cogsRow({ itemName: "Shake", status: "MISSING_COST", salesRevenue: 60, qtySold: 10 }),
]

beforeEach(() => {
  vi.clearAllMocks()
  asMock(getScopedStores).mockResolvedValue([{ id: "s1" }])
  asMock(listMappingProposals).mockResolvedValue([])
  asMock(getItemDiscounts).mockResolvedValue(new Map())
  asMock(prisma.otterMenuItem.findMany).mockImplementation(async (args: { where: { isModifier: boolean } }) =>
    args.where.isModifier
      ? []
      : ["Burger", "Fries", "Shake"].map((itemName) => ({
          itemName,
          category: "Food",
          fpQuantitySold: 20,
          tpQuantitySold: 0,
          fpTotalSales: 200,
          tpTotalSales: 0,
        })),
  )
  asMock(prisma.otterItemMapping.findMany).mockResolvedValue([
    { otterItemName: "Burger" },
    { otterItemName: "Shake" },
  ])
  asMock(prisma.otterSubItemMapping.findMany).mockResolvedValue([])
  asMock(prisma.dailyCogsItem.groupBy).mockImplementation(cogsGroupBy(COGS))
})

async function rows() {
  const list = await getMenuCatalogSectionPromises({
    storeId: null,
    accountId: "acct_1",
    range: { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30) },
  }).list
  if (list.status !== "ready") throw new Error(`list was ${list.status}`)
  return new Map(list.data.rows.map((r) => [r.item, r]))
}

describe("menu catalog · uncosted items", () => {
  it("an unmapped item shows no plate cost and no margin, not $0 and 100%", async () => {
    const fries = (await rows()).get("Fries")!
    expect(fries).toBeDefined()
    expect(fries.mapped).toBe(false)
    expect(fries.plateCost).toBe("—")
    expect(fries.margin).toBe("—")
  })

  it("a mapped item whose recipe has no cost stays visible, uncosted", async () => {
    const shake = (await rows()).get("Shake")!
    expect(shake.mapped).toBe(true)
    expect(shake.plateCost).toBe("—")
    expect(shake.margin).toBe("—")
  })

  it("a part-costed item's plate cost comes from its costed days only", async () => {
    const burger = (await rows()).get("Burger")!
    // $40 over 10 costed plates — not $40 over 20.
    expect(burger.plateCost).toBe("$4.00")
    expect(burger.margin).toBe("60.0%")
  })
})
