// getAllStoresPnL on a cache hit: Redis hands back JSON, so `periods[]` dates
// arrive as ISO strings. Callers (SPLH, Decisions) call Date methods on them;
// on 2026-10-29 "Sales per labor hour" failed with
// "a.getUTCMonth is not a function" whenever the statement came from cache.

import { describe, it, expect, vi } from "vitest"

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => ({ user: { id: "u1", accountId: "acct-A", role: "OWNER" } })),
}))
vi.mock("@/lib/auth", () => ({ authOptions: {}, hasOwnerAccess: () => true }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/cache/cached", async (orig) => ({
  ...(await orig<typeof import("@/lib/cache/cached")>()),
  // A hit: the stored value, round-tripped through JSON as Upstash does.
  cached: vi.fn(async () =>
    JSON.parse(
      JSON.stringify({
        storeCount: 1,
        combined: {},
        perStore: [],
        consolidatedRows: [],
        perPeriod: [],
        periods: [
          {
            label: "Oct 27",
            startDate: new Date("2026-10-27T00:00:00.000Z"),
            endDate: new Date("2026-10-27T23:59:59.999Z"),
            days: 1,
            isPartial: false,
          },
        ],
      }),
    ),
  ),
}))

import { getAllStoresPnL } from "@/app/actions/store/pnl-actions"

describe("getAllStoresPnL cache hit", () => {
  it("returns periods with real Date bounds", async () => {
    const res = await getAllStoresPnL({
      startDate: new Date("2026-10-27T00:00:00.000Z"),
      endDate: new Date("2026-10-27T00:00:00.000Z"),
      granularity: "daily",
    })
    if ("error" in res) throw new Error(res.error)
    const [p] = res.periods
    expect(p.startDate).toBeInstanceOf(Date)
    expect(p.endDate).toBeInstanceOf(Date)
    expect(p.startDate.getUTCMonth()).toBe(9)
    expect(p.endDate.toISOString()).toBe("2026-10-27T23:59:59.999Z")
  })
})
