// getHourlyOrderPatterns already checks for a session, but its OtterHourlySummary
// query filtered only by storeId — an authenticated user could read another
// account's hourly sales by passing a foreign storeId. The query must also scope
// to the caller's account.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
  prisma: { otterHourlySummary: { findMany: vi.fn() } },
}))

import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { getHourlyOrderPatterns } from "@/app/actions/hourly-orders-actions"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.otterHourlySummary.findMany).mockResolvedValue([] as never)
})

describe("getHourlyOrderPatterns — account scoping", () => {
  it("returns null without a session", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getHourlyOrderPatterns("store-1", "today")).toBeNull()
  })

  it("scopes the OtterHourlySummary query to the caller's account", async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: "u1", accountId: "acct-A" } } as never)
    await getHourlyOrderPatterns("store-1", "today")
    const arg = vi.mocked(prisma.otterHourlySummary.findMany).mock.calls[0]?.[0] as {
      where?: { store?: { accountId?: string } }
    }
    expect(arg?.where?.store?.accountId).toBe("acct-A")
  })
})
