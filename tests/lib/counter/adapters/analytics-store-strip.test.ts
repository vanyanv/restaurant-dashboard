/**
 * The store analytics strip's Food cost cell, against the shared food rule
 * (`@/lib/counter/food-coverage`): no food posted is a labelled dash, never a
 * 0.0%; a partial food cost keeps its figure and says why.
 */
import { describe, it, expect, vi } from "vitest"

// The adapter module imports `@/lib/prisma` and server actions at load.
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/app/actions/store/crud-actions", () => ({ getStores: vi.fn() }))
vi.mock("@/app/actions/forecasts/menu-engineering-actions", () => ({ getMenuEngineering: vi.fn() }))
vi.mock("@/app/actions/store/pnl-actions", () => ({ getAllStoresPnL: vi.fn() }))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))

import { buildStoreStrip } from "@/lib/counter/adapters/analytics"
import { comparisonContext } from "@/lib/counter/comparison"
import { primeCost } from "@/lib/counter/prime-cost"
import type { Statement } from "@/lib/counter/statement"

const range = { start: new Date(2026, 10, 9), end: new Date(2026, 10, 15) }
const cmp = comparisonContext("none", null)

function statement(over: Partial<Statement> = {}): Statement {
  const grossSales = over.grossSales ?? 10_000
  const cogsValue = over.cogsValue ?? 3_000
  return {
    grossSales,
    cogsValue,
    laborValue: 2_500,
    cogsMissingDays: 0,
    uncostedSales: 0,
    prime: primeCost({ grossSales, cogsValue, laborValue: 2_500 }),
    ...over,
  } as Statement
}

const food = (s: Statement) => buildStoreStrip(s, 400, cmp, range).cells.find((c) => c.label === "Food cost")

describe("store analytics — Food cost cell", () => {
  it("prints the food share and its dollars when food is whole", () => {
    const cell = food(statement())
    expect(cell?.value).toBe("30.0%")
    expect(cell?.delta).toBe("$3,000")
  })

  it("prints a labelled dash, not 0.0%, when no food cost is posted", () => {
    const cell = food(statement({ cogsValue: 0 }))
    expect(cell?.value).toBe("—")
    expect(cell?.delta).toBe("no food cost posted")
  })

  it("keeps a partial figure and says what is missing, in the plain page's words", () => {
    const cell = food(statement({ cogsMissingDays: 2, uncostedSales: 1_000 }))
    expect(cell?.value).toBe("30.0%")
    expect(cell?.delta).toBe("$3,000 · partial · 2 days with no food cost · 10% of sales not fully costed")
  })

  it("puts the same cell on the phone", () => {
    const strip = buildStoreStrip(statement({ cogsValue: 0 }), 400, cmp, range)
    expect(strip.phoneCells.find((c) => c.label === "Food cost")?.value).toBe("—")
  })
})
