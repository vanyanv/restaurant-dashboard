// OperatorGateDailyVerdict is a global (chain-level) table with no store/account
// column, so there is nothing to scope by — but the read still exposes ML
// pipeline health and must at least require an authenticated session.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: { operatorGateDailyVerdict: { findMany: vi.fn() } },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getOperatorGateStreak } from "@/app/actions/intelligence/gate-streak-actions"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.operatorGateDailyVerdict.findMany).mockResolvedValue([] as never)
})

describe("getOperatorGateStreak — auth gate", () => {
  it("throws when unauthenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    await expect(getOperatorGateStreak()).rejects.toThrow()
    expect(prisma.operatorGateDailyVerdict.findMany).not.toHaveBeenCalled()
  })

  it("returns the streak for an authenticated user", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1", accountId: "acct-A" } } as never)
    const result = await getOperatorGateStreak()
    expect(result.consecutivePass).toBe(0)
    expect(prisma.operatorGateDailyVerdict.findMany).toHaveBeenCalledTimes(1)
  })
})
