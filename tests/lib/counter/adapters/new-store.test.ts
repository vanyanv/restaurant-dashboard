// new-store adapter — the account boundary on its three integration reads.
//
// `loadNewStore` scoped its `Store.findMany` by `accountId`, then read
// `OtterStore.findMany`, `HarriBrand.findMany` and `StoreWeatherSignal.count`
// with no `where` at all, so `otterLinked`, `harriLinked` and the `weatherRows`
// figure were all computed against every account's rows, not just this one's.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    otterStore: { findMany: vi.fn() },
    harriBrand: { findMany: vi.fn() },
    storeWeatherSignal: { count: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { getNewStoreSectionPromises } from "@/lib/counter/adapters/new-store"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const OURS = "acct_ours"

describe("new-store adapter · account scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(prisma.store.findMany).mockResolvedValue([
      {
        id: "store_ours",
        name: "Chris N Eddys - Hollywood",
        lifecycleStage: "ready",
        fixedMonthlyRent: 5000,
        fixedMonthlyLabor: 8000,
        targetCogsPct: 0.3,
        uberCommissionRate: 0.21,
        doordashCommissionRate: 0.25,
        latitude: 34.1,
      },
    ])
    asMock(prisma.otterStore.findMany).mockResolvedValue([])
    asMock(prisma.harriBrand.findMany).mockResolvedValue([])
    asMock(prisma.storeWeatherSignal.count).mockResolvedValue(0)
  })

  it("scopes all three integration queries to our own account", async () => {
    const sections = getNewStoreSectionPromises({ accountId: OURS })
    await sections.switches

    expect(asMock(prisma.otterStore.findMany).mock.calls[0][0].where).toEqual({
      store: { accountId: OURS },
    })
    expect(asMock(prisma.harriBrand.findMany).mock.calls[0][0].where).toEqual({
      store: { accountId: OURS },
    })
    expect(asMock(prisma.storeWeatherSignal.count).mock.calls[0][0].where).toEqual({
      store: { accountId: OURS },
    })
  })
})
