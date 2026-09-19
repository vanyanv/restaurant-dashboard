/*
 * The cap is a ceiling against a runaway, and the property that matters most
 * is the one that is easy to get backwards: an unreadable ledger must not
 * refuse the question. A database hiccup taking the whole assistant down to
 * protect a bill that is nowhere near the line would be a worse outage than
 * the one it prevents.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const queryRaw = vi.fn()
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: (...a: unknown[]) => queryRaw(...a) } }))
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import {
  CHAT_DAILY_BUDGET_USD,
  checkDailyBudget,
  resetSpendCapCache,
  spentTodayUsd,
} from "@/lib/chat/spend-cap"

beforeEach(() => {
  vi.clearAllMocks()
  resetSpendCapCache()
})
afterEach(() => resetSpendCapCache())

describe("spentTodayUsd", () => {
  it("returns the ledger total", async () => {
    queryRaw.mockResolvedValue([{ total: 3.5 }])
    expect(await spentTodayUsd("acct-A")).toBe(3.5)
  })

  it("reads a day with no turns as zero, not as unknown", async () => {
    queryRaw.mockResolvedValue([{ total: null }])
    expect(await spentTodayUsd("acct-A")).toBe(0)
  })

  it("returns null when the ledger cannot be read", async () => {
    queryRaw.mockRejectedValue(new Error("connection reset"))
    expect(await spentTodayUsd("acct-A")).toBeNull()
  })

  it("reads at most once a minute per account", async () => {
    queryRaw.mockResolvedValue([{ total: 1 }])
    await spentTodayUsd("acct-A")
    await spentTodayUsd("acct-A")
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })

  it("caches per account, so one tenant's figure is never another's", async () => {
    queryRaw.mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce([{ total: 99 }])
    expect(await spentTodayUsd("acct-A")).toBe(1)
    expect(await spentTodayUsd("acct-B")).toBe(99)
    expect(queryRaw).toHaveBeenCalledTimes(2)
  })
})

describe("checkDailyBudget", () => {
  it("passes a turn under the line", async () => {
    queryRaw.mockResolvedValue([{ total: 0.5 }])
    const v = await checkDailyBudget("acct-A")
    expect(v.overBudget).toBe(false)
    expect(v.budgetUsd).toBe(CHAT_DAILY_BUDGET_USD)
  })

  it("stops a turn at or over the line", async () => {
    queryRaw.mockResolvedValue([{ total: CHAT_DAILY_BUDGET_USD }])
    expect((await checkDailyBudget("acct-A")).overBudget).toBe(true)
  })

  it("FAILS OPEN when the ledger is unreadable", async () => {
    queryRaw.mockRejectedValue(new Error("connection reset"))
    const v = await checkDailyBudget("acct-A")
    expect(v.overBudget).toBe(false)
    expect(v.spentUsd).toBeNull()
  })
})
