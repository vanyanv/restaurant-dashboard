/*
 * The Decisions verdict cache is per account. The portfolio key used to be
 * the bare "ALL", shared by every account, so one account's portfolio
 * sentence could be served on another account's page the same day.
 */
import { describe, it, expect, vi } from "vitest"

const findUnique = vi.fn(async (_a: unknown) => null)
vi.mock("@/lib/prisma", () => ({
  prisma: { decisionVerdict: { findUnique: (a: unknown) => findUnique(a), upsert: vi.fn() } },
}))
vi.mock("next/server", () => ({ after: vi.fn() }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }))
vi.mock("@/lib/decision-verdict-llm", () => ({
  VERDICT_NARRATION_VERSION: "v1",
  generateVerdictLine: vi.fn(),
}))

import { getVerdictLine, verdictScopeKey } from "@/app/actions/decisions/get-verdict"

const facts = {
  storeName: "All stores",
  isAggregate: true,
  weekTotal: 10000,
  weekP10: null,
  weekP90: null,
  peakDay: { weekdayShort: "Sat", predictedRevenue: 2000 },
  laborGapHours: null,
  laborStatus: "unknown",
  shortDays: 0,
  unscheduledDays: 0,
  topAction: null,
  potUsdPerWeek: 0,
  accuracyWape: null,
  accuracySample: 0,
  topBriefing: null,
} as never

describe("verdict cache key", () => {
  it("is per account for the portfolio view, and the store id for a store", () => {
    expect(verdictScopeKey(null, "acct-A")).toBe("ALL:acct-A")
    expect(verdictScopeKey(null, "acct-B")).not.toBe(verdictScopeKey(null, "acct-A"))
    expect(verdictScopeKey("store-1", "acct-A")).toBe("store-1")
  })

  it("reads the portfolio row under the account's own key", async () => {
    await getVerdictLine({ facts, storeId: null, accountId: "acct-A", asOf: "2026-11-20" })
    const where = (findUnique.mock.calls[0] as unknown as [{ where: { scopeKey_asOfDate: { scopeKey: string } } }])[0].where
    expect(where.scopeKey_asOfDate.scopeKey).toBe("ALL:acct-A")
  })
})
