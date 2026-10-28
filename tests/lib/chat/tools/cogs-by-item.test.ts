/*
 * `getCogsByItem` — an uncosted item is not a 100%-margin item.
 *
 * The tool grouped `DailyCogsItem` across every status. UNMAPPED and
 * MISSING_COST rows carry real revenue at $0 `lineCost`, so an item with no
 * recipe came back as `cogs: 0, marginPct: 100` — and the model, asked for the
 * best-margin items, would lead with the ones nobody has costed. The tool's
 * description already said only costed items appear; now the query agrees.
 */
import { describe, it, expect, vi } from "vitest"

// `item-economics.ts` imports the app's client at module load; the tool reads
// through the context's own client, so the app's is never used here.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))

vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(async () => ["s1"]),
}))

import { getCogsByItem } from "@/lib/chat/tools/cogs"
import type { ChatToolContext } from "@/lib/chat/tools/types"
import {
  BOGO_ROWS,
  cogsGroupBy,
  cogsRow,
  SLIDER,
  SLIDER_FOOD_COST,
} from "../../counter/fixtures/item-economics"

const ROWS = [
  cogsRow({ itemName: "Burger", category: "Food", qtySold: 10, salesRevenue: 100, lineCost: 40 }),
  cogsRow({ itemName: "Burger", category: "Food", status: "UNMAPPED", recipeId: null, qtySold: 10, salesRevenue: 100, lineCost: 0 }),
  cogsRow({ itemName: "Fries", category: "Sides", status: "UNMAPPED", recipeId: null, qtySold: 10, salesRevenue: 50, lineCost: 0 }),
]

/** The tool reads through the context's own client, never the app's. */
function ctxOver(rows: typeof ROWS, discounts: Array<{ name: string; platform: string; gross: number }> = []) {
  const groupBy = vi.fn(cogsGroupBy(rows))
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray) =>
    // `getItemDiscounts`: the gross query first, then the discounted lines.
    strings.join("").includes('SUM(i."price" * i."quantity")') ? discounts : [],
  )
  const ctx: ChatToolContext = {
    ownerId: "u1",
    accountId: "acct-A",
    prisma: { dailyCogsItem: { groupBy }, $queryRaw } as unknown as ChatToolContext["prisma"],
  }
  return { ctx, groupBy, $queryRaw }
}

describe("getCogsByItem — costed rows only", () => {
  it("never reports an unmapped item at $0 cost and 100% margin", async () => {
    const { ctx, groupBy } = ctxOver(ROWS)
    const rows = await getCogsByItem.execute(
      { dateRange: { from: "2026-09-01", to: "2026-09-30" }, topN: 10 },
      ctx,
    )
    expect(rows.map((r) => r.menuItem)).toEqual(["Burger"])
    // Burger's margin over its costed sales, not inflated by the unmapped half.
    expect(rows[0]).toMatchObject({ revenue: 100, cogs: 40, marginPct: 60 })
    expect(groupBy.mock.calls[0][0].where).toMatchObject({ store: { accountId: "acct-A" } })
  })

  it("prices a buy-one-get-one on what it collected, through the shared definition", async () => {
    // Half of every slider's line value came back off on its orders.
    const { ctx } = ctxOver(BOGO_ROWS as typeof ROWS, [
      { name: SLIDER, platform: "ubereats", gross: 1349 },
    ])
    // The discounted-lines query: one order, 2 × $13.49 at −$13.49, × 50.
    ;(ctx.prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (strings: TemplateStringsArray) =>
        strings.join("").includes('SUM(i."price" * i."quantity")')
          ? [{ name: SLIDER, platform: "ubereats", storeId: "s1", gross: 1349 }]
          : Array.from({ length: 50 }, (_, n) => ({
              orderId: `o${n}`,
              platform: "ubereats",
              storeId: "s1",
              discount: 13.49,
              name: SLIDER,
              price: 13.49,
              quantity: 2,
            })),
    )
    const rows = await getCogsByItem.execute(
      { dateRange: { from: "2026-10-01", to: "2026-10-02" }, topN: 10 },
      ctx,
    )
    const slider = rows.find((r) => r.menuItem === SLIDER)!
    expect(slider.revenue).toBeCloseTo(674.5)
    expect(100 - (slider.marginPct as number)).toBeCloseTo(SLIDER_FOOD_COST)
    // Packaging is not an item; the unmapped item has no cost to report.
    expect(rows.map((r) => r.menuItem).sort()).toEqual(["Fries", SLIDER].sort())
  })
})
