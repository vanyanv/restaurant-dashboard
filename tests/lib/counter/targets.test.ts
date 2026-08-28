// loadStripTargets — what the six headline figures are judged against, and
// the five that nothing judges.
//
// The tests that matter most here assert ABSENCE. A meter is the page claiming
// somebody set a benchmark and this figure is inside or outside it; five of
// the six have no such benchmark anywhere in the schema, so five of the six
// must come back null. The prototype's own numbers are named in the
// assertions so that anyone who later "fills the gap" by pasting them in
// gets a red test with the reason attached.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { store: { findMany: vi.fn() } } }))

import { prisma } from "@/lib/prisma"
import { loadStripTargets } from "@/lib/counter/targets"

const accountId = "acct-A"

// Rows carry an `id` because the store read now goes through
// `@/lib/account-stores`, which fetches the account's stores once per request
// and narrows to the selected one in memory. Ids are `s1`, `s2`, … in order,
// so `loadStripTargets("s1", …)` selects the FIRST value passed here.
const withTargets = (...values: Array<number | null>) =>
  vi.mocked(prisma.store.findMany).mockResolvedValue(
    values.map((targetCogsPct, i) => ({ id: `s${i + 1}`, targetCogsPct })) as never,
  )

beforeEach(() => vi.clearAllMocks())

describe("loadStripTargets", () => {
  it("publishes no reference for the five the schema cannot answer", async () => {
    withTargets(29)
    const t = await loadStripTargets("s1", accountId)

    // Orders: the prototype bands it at 0.92–1.05 of whatever figure the range
    // produced, which is not a benchmark, it is the figure judging itself.
    expect(t.orders).toBeNull()
    // Avg ticket: the prototype's $25.10–$26.40 exists in no column.
    expect(t.ticket).toBeNull()
    // Labor: `Store.fixedMonthlyLabor` is a dollar budget, not a percent band.
    expect(t.labor).toBeNull()
    // Prime: the ceiling belongs to primeCost(), which already returns it —
    // this module deliberately does not publish a second copy.
    expect(t.prime).toBeNull()
    // Marketplace fees: nothing in the schema says what fees SHOULD be.
    expect(t.marketplaceFees).toBeNull()
  })

  it("answers for food cost, because Store.targetCogsPct is a real column", async () => {
    withTargets(28.5)
    const t = await loadStripTargets("s1", accountId)
    expect(t.foodCost).toEqual({ kind: "target", value: 28.5, better: "low" })
  })

  it("does not invent a food plan for a store that has none", async () => {
    // targetCogsPct is nullable and starts null. An unset plan is not 0% and
    // is not the prototype's 29% — it is no plan.
    withTargets(null)
    expect((await loadStripTargets("s1", accountId)).foodCost).toBeNull()
  })

  it("keeps the account-wide plan only when the stores agree on one", async () => {
    withTargets(28.5, 28.5, null)
    expect((await loadStripTargets(null, accountId)).foodCost).toEqual({
      kind: "target",
      value: 28.5,
      better: "low",
    })
  })

  it("publishes no account-wide plan when stores were set to different ones", async () => {
    // Averaging 28 and 31 gives 29.5 — a number no operator ever set. That is
    // the prototype's fabrication reached by arithmetic instead of by typing.
    withTargets(28, 31)
    expect((await loadStripTargets(null, accountId)).foodCost).toBeNull()
  })

  it("scopes to the account, and to one store when one is selected", async () => {
    // The store read moved to `@/lib/account-stores` — `cache()`d and shared
    // with every other loader on the page, so a render pays one store query
    // instead of one per loader. Both guarantees this test was written for
    // survive, and are both still asserted here:
    //
    //   1. THE ACCOUNT BOUNDARY IS IN SQL, not in JavaScript. That is what
    //      stops `storeId: null` reading every store row in the database —
    //      the reason this function takes an accountId at all (see its
    //      docblock). Only the narrowing to one store filters in memory, over
    //      a set the query already scoped.
    //   2. Selecting a store answers for THAT store, not the account.
    withTargets(29)
    await loadStripTargets("s1", accountId)
    expect(vi.mocked(prisma.store.findMany).mock.calls[0][0]).toMatchObject({
      where: { accountId, isActive: true },
    })

    // s1 is 28.5 and s2 is 31 — two stores that do NOT agree, so an unscoped
    // read would publish no plan at all (see the test above). Selecting s1
    // answers 28.5, which is only possible if the narrowing happened.
    vi.clearAllMocks()
    withTargets(28.5, 31)
    expect((await loadStripTargets("s1", accountId)).foodCost).toEqual({
      kind: "target",
      value: 28.5,
      better: "low",
    })
  })

  it("carries none of the prototype's hardcoded numbers", async () => {
    withTargets(null)
    const t = await loadStripTargets(null, accountId)
    // FOOD_PLAN 29.0, PRIME_PLAN 60.0, ticket 25.10–26.40, fees 560–690,
    // labour 23.9–26.2 — counter-prototype.html lines 3395, 3414, 4264, 4287,
    // 4272. None of them may reach a real dashboard through this module.
    expect(Object.values(t)).toEqual([null, null, null, null, null, null])
  })
})
