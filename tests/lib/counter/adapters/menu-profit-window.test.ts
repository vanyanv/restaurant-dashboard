/*
 * Menu profit reads exactly the page's range.
 *
 * `getMenuEngineering` reads `[asOf − lookbackDays, asOf]` with both ends
 * included, so `lookbackDays` is the day count MINUS ONE. The Profit page
 * passed the day count itself, so a 30-day range classified 31 days of sales
 * while `loadStatement` beside it — the page's own total sales and food cost —
 * read 30. `adapters/analytics.ts` already passed `days − 1`.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/app/actions/forecasts/menu-engineering-actions", () => ({
  getMenuEngineering: vi.fn(async () => null),
}))
vi.mock("@/lib/counter/statement", () => ({
  loadStatement: vi.fn(async () => ({ rows: [], grossSales: 0 })),
  rowValues: vi.fn(() => []),
}))

import { getMenuEngineering } from "@/app/actions/forecasts/menu-engineering-actions"
import { getMenuProfitSectionPromises } from "@/lib/counter/adapters/menu-profit"

describe("menu profit · window", () => {
  it("a 30-day range asks for a 30-day window ending on the range's last day", async () => {
    const end = new Date(2026, 8, 30)
    const sections = getMenuProfitSectionPromises({
      range: { start: new Date(2026, 8, 1), end },
      storeId: "holly",
      accountId: "acct_1",
    })
    await sections.headline
    expect(vi.mocked(getMenuEngineering)).toHaveBeenCalledWith({
      storeId: "holly",
      lookbackDays: 29,
      asOf: end,
    })
  })
})
