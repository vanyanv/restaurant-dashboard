// loadPriceMoves is saved (Redis, tags `invoices` + `account:<id>`). What comes
// back from the saved copy must equal what the query builds, bit for bit:
// JSON has no Map and no Date, so the set is stored as entries and revived.

import { describe, it, expect, vi, beforeEach } from "vitest"

const store = new Map<string, string>()
const cachedCalls: Array<{ key: string; ttl: number; tags: string[] }> = []

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findMany: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/cache/cached", async (orig) => ({
  ...(await orig<typeof import("@/lib/cache/cached")>()),
  // Redis, as far as it matters here: a value goes in and out as JSON.
  cached: vi.fn(async (key: string, ttl: number, tags: string[], loader: () => Promise<unknown>) => {
    cachedCalls.push({ key, ttl, tags })
    const hit = store.get(key)
    if (hit !== undefined) return JSON.parse(hit)
    const value = await loader()
    store.set(key, JSON.stringify(value))
    return value
  }),
}))

import { prisma } from "@/lib/prisma"
import { loadPriceMoves, loadPriceMovesUncached, PRICE_MOVES_TTL } from "@/lib/counter/price-move"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const TODAY = new Date("2026-09-20T19:00:00Z")
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)

const line = (iso: string, price: number) => ({
  canonicalIngredientId: "ci_beef",
  sku: "BEEF10",
  productName: "ground beef 10 lb",
  quantity: 1,
  unit: "CS",
  packSize: 1,
  unitSize: 10,
  unitSizeUom: "LB",
  unitPrice: price,
  extendedPrice: price,
  invoice: { invoiceDate: day(iso) },
})

beforeEach(() => {
  vi.clearAllMocks()
  store.clear()
  cachedCalls.length = 0
  asMock(prisma.canonicalIngredient.findMany).mockResolvedValue([
    { id: "ci_beef", name: "ground beef", recipeUnit: "oz", _count: { recipeIngredients: 3 }, skuMatches: [] },
  ])
  asMock(prisma.invoiceLineItem.findMany).mockResolvedValue([
    line("2026-06-10", 20),
    line("2026-07-10", 20),
    line("2026-08-10", 20),
    line("2026-09-15", 27.4),
  ])
})

describe("loadPriceMoves — saved", () => {
  it("returns exactly the set the query builds, from the query and from the saved copy", async () => {
    const built = await loadPriceMovesUncached({ accountId: "acct_A", asOf: TODAY })
    const first = await loadPriceMoves({ accountId: "acct_A", asOf: TODAY })
    expect(first).toEqual(built)
    // A second render reads the saved JSON: Dates and the Map are revived.
    const reads = asMock(prisma.invoiceLineItem.findMany).mock.calls.length
    const second = await loadPriceMoves({ accountId: "acct_A", asOf: TODAY })
    expect(second).toEqual(built)
    expect(second.moves.get("ci_beef")!.latestAt).toBeInstanceOf(Date)
    expect(second.moves.get("ci_beef")!.readings[0].at).toBeInstanceOf(Date)
    expect(asMock(prisma.invoiceLineItem.findMany).mock.calls.length).toBe(reads)
  })

  it("is tagged with the invoice tags and named by account, stores and day", async () => {
    await loadPriceMoves({ accountId: "acct_A", asOf: TODAY, storeIds: ["s2", "s1"] })
    const c = cachedCalls[0]
    expect(c.tags).toEqual(["invoices", "account:acct_A"])
    expect(c.ttl).toBe(PRICE_MOVES_TTL)
    expect(c.key).toContain("acct_A")
    // Store order does not make a second entry.
    await loadPriceMoves({ accountId: "acct_A", asOf: TODAY, storeIds: ["s1", "s2"] })
    expect(new Set(cachedCalls.map((x) => x.key)).size).toBe(1)
  })

  it("never serves one account's moves to another", async () => {
    await loadPriceMoves({ accountId: "acct_A", asOf: TODAY })
    asMock(prisma.canonicalIngredient.findMany).mockResolvedValue([])
    const b = await loadPriceMoves({ accountId: "acct_B", asOf: TODAY })
    expect(b.moves.size).toBe(0)
    expect(cachedCalls[0].key).not.toBe(cachedCalls[1].key)
    expect(asMock(prisma.invoiceLineItem.findMany).mock.calls.at(-1)![0].where.invoice.accountId).toBe("acct_B")
  })
})
