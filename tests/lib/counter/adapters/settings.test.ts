// Settings' loginEvent reads shipped with no tenant filter at all — every
// account's sign-in IPs and user agents in one list. LoginEvent has no
// relation to User, so the boundary is userId ∈ (this account's users).
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    store: { findMany: vi.fn() },
    alertPreference: { count: vi.fn() },
    loginEvent: { findMany: vi.fn(), count: vi.fn() },
    invite: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from "@/lib/prisma"
import { getSettingsSectionPromises } from "@/lib/counter/adapters/settings"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  asMock(prisma.user.findMany).mockResolvedValue([
    { id: "u1", email: "a@x", name: "A", role: "OWNER", timezone: "UTC",
      notifyInvoices: false, notifyWeeklyReport: false, notifyAnomaly: false,
      ownedStores: [] },
  ])
  asMock(prisma.store.findMany).mockResolvedValue([])
  asMock(prisma.alertPreference.count).mockResolvedValue(0)
  asMock(prisma.loginEvent.findMany).mockResolvedValue([])
  asMock(prisma.loginEvent.count).mockResolvedValue(0)
  asMock(prisma.invite.findMany).mockResolvedValue([])
  asMock(prisma.$queryRaw).mockResolvedValue([{ role: "OWNER" }])
})

describe("loadSettings tenancy", () => {
  it("filters loginEvent reads to this account's users", async () => {
    const sections = getSettingsSectionPromises({ userId: "u1", accountId: "acct_ours" })
    await Promise.all(Object.values(sections))

    const findWhere = asMock(prisma.loginEvent.findMany).mock.calls[0][0].where
    expect(findWhere.userId).toEqual({ in: ["u1"] })

    const countWhere = asMock(prisma.loginEvent.count).mock.calls[0][0].where
    expect(countWhere.userId).toEqual({ in: ["u1"] })
  })
})
