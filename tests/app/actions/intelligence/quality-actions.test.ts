// Multi-tenant scoping: the intelligence/quality tables (MlForecastEvaluation,
// MlReconciliationDaily) are store-scoped, so these reads must require a session
// and filter to the caller's account — not return every account's rows.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
    mlReconciliationDaily: { findMany: vi.fn() },
  },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getAccuracyTable, getReconciliationTable } from "@/app/actions/intelligence/quality-actions"

const SESSION = { user: { id: "u1", accountId: "acct-A" } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never)
  vi.mocked(prisma.mlReconciliationDaily.findMany).mockResolvedValue([] as never)
})

describe("getAccuracyTable — account scoping", () => {
  it("throws when unauthenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    await expect(getAccuracyTable()).rejects.toThrow()
  })

  it("scopes the raw query to the caller's accountId", async () => {
    vi.mocked(getServerSession).mockResolvedValue(SESSION as never)
    await getAccuracyTable()
    const call = vi.mocked(prisma.$queryRaw).mock.calls[0] as unknown[]
    expect(call.slice(1)).toContain("acct-A")
  })
})

describe("getReconciliationTable — account scoping", () => {
  it("throws when unauthenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    await expect(getReconciliationTable()).rejects.toThrow()
  })

  it("filters mlReconciliationDaily by store.accountId", async () => {
    vi.mocked(getServerSession).mockResolvedValue(SESSION as never)
    await getReconciliationTable()
    const arg = vi.mocked(prisma.mlReconciliationDaily.findMany).mock.calls[0]?.[0] as {
      where?: { store?: { accountId?: string } }
    }
    expect(arg?.where?.store?.accountId).toBe("acct-A")
  })
})
