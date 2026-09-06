// product-usage adapter — the canonical-name lookup's missing account scope.
//
// `loadUsage` names purchased-only variance rows by looking up
// `CanonicalIngredient` rows by id with no `accountId` filter, so an id
// collision with another account's catalogue (or simply a broader query plan
// across accounts) was possible on the very lookup that exists to label a
// row correctly.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/recipe-cost", () => ({ batchRecipeCosts: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import { getProductUsageSectionPromises } from "@/lib/counter/adapters/product-usage"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe("product-usage adapter · canonical name lookup scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(getScopedStores).mockResolvedValue([{ id: "store_a" }])
    asMock(batchRecipeCosts).mockResolvedValue(new Map())
    asMock(prisma.canonicalIngredient.findMany).mockResolvedValue([])

    // $queryRaw is called for: sold, purchasedByIngredient, dailyTheoretical,
    // dailyPurchased. Only `purchasedByIngredient` needs a row here — a
    // purchased-only ingredient id with no theoretical side, which is what
    // drives the canonical-name lookup this test is about.
    asMock(prisma.$queryRaw).mockImplementation(((strings: TemplateStringsArray) => {
      const text = strings.join(" ")
      if (text.includes("canonicalIngredientId") && text.includes("extendedPrice")) {
        return Promise.resolve([{ cid: "ci_purchased_only", spend: 42 }])
      }
      return Promise.resolve([])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any)
  })

  it("scopes the canonical-name lookup to our own account", async () => {
    const sections = getProductUsageSectionPromises({
      storeId: null,
      accountId: "acct_ours",
      range: { start: new Date(0), end: new Date() },
    })
    await sections.variance

    expect(asMock(prisma.canonicalIngredient.findMany).mock.calls[0][0].where).toMatchObject({
      id: { in: ["ci_purchased_only"] },
      accountId: "acct_ours",
    })
  })
})
