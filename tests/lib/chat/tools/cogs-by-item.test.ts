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

vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(async () => ["s1"]),
}))

import { getCogsByItem } from "@/lib/chat/tools/cogs"
import type { ChatToolContext } from "@/lib/chat/tools/types"

const ROWS = [
  { itemName: "Burger", category: "Food", status: "COSTED", qtySold: 10, salesRevenue: 100, lineCost: 40 },
  { itemName: "Burger", category: "Food", status: "UNMAPPED", qtySold: 10, salesRevenue: 100, lineCost: 0 },
  { itemName: "Fries", category: "Sides", status: "UNMAPPED", qtySold: 10, salesRevenue: 50, lineCost: 0 },
]

/** Applies the `status` filter it is given, the way the database would. */
const groupBy = vi.fn(async (args: { where: { status?: string } }) => {
  const by = new Map<string, { itemName: string; category: string; _sum: Record<string, number> }>()
  for (const r of ROWS) {
    if (args.where.status && r.status !== args.where.status) continue
    const g = by.get(r.itemName) ?? {
      itemName: r.itemName,
      category: r.category,
      _sum: { qtySold: 0, salesRevenue: 0, lineCost: 0 },
    }
    g._sum.qtySold += r.qtySold
    g._sum.salesRevenue += r.salesRevenue
    g._sum.lineCost += r.lineCost
    by.set(r.itemName, g)
  }
  return [...by.values()]
})

const ctx: ChatToolContext = {
  ownerId: "u1",
  accountId: "acct-A",
  prisma: { dailyCogsItem: { groupBy } } as unknown as ChatToolContext["prisma"],
}

describe("getCogsByItem — costed rows only", () => {
  it("never reports an unmapped item at $0 cost and 100% margin", async () => {
    const rows = await getCogsByItem.execute(
      { dateRange: { from: "2026-09-01", to: "2026-09-30" }, topN: 10 },
      ctx,
    )
    expect(rows.map((r) => r.menuItem)).toEqual(["Burger"])
    // Burger's margin over its costed sales, not inflated by the unmapped half.
    expect(rows[0]).toMatchObject({ revenue: 100, cogs: 40, marginPct: 60 })
  })
})
