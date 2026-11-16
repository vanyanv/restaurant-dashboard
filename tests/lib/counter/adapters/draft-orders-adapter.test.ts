// Order next — the adapter around `draftLine`.
//
// 1. `loadStoreDraft` is exported, and the inventory context it loads filters
//    by `storeId` alone. So it checks the store against the account itself,
//    first, and reads nothing for a store that is not ours.
// 2. "Skip this week's count" is read from the store, the draft starts from
//    the counts before the last 7 days, and it says so (`skip`,
//    `countsBefore`, each item's `countedAt`) so the shelf views read the same
//    counts.
// 3. The Order tab drafts only the store it shows; the other stores' figures
//    are the switcher's.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

type Where = Record<string, unknown>
type Call = { model: string; method: string; args: { where?: Where } }

const h = vi.hoisted(() => {
  const calls: Call[] = []
  const answers = new Map<string, (args: Call["args"]) => unknown>()
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, method: string) => async (args: Call["args"]) => {
        calls.push({ model: name, method, args })
        const answer = answers.get(`${name}.${method}`)
        if (answer) return answer(args)
        return method === "findMany" ? [] : null
      },
    })
  const prisma = new Proxy({}, { get: (_t, name: string) => model(name) })
  return { calls, answers, prisma, loadContext: vi.fn(), onHand: vi.fn(), rate: vi.fn() }
})

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }))
vi.mock("@/lib/inventory/store-inventory-context", () => ({
  loadStoreInventoryContext: h.loadContext,
  runningOnHandFromContext: h.onHand,
  dailyDepletionRateFromContext: h.rate,
}))
vi.mock("@/lib/inventory/forecast-depletion", () => ({
  computeForecastShapedDepletion: vi.fn(async () => new Map()),
}))

import { getDraftOrderSectionPromises, loadStoreDraft } from "@/lib/counter/adapters/draft-orders"
import { anchorLineWhere } from "@/lib/inventory/anchor-line"

const DAY_MS = 86_400_000
// A fixed clock, and one that crosses the 2026-11-01 end of daylight time: nine
// Los Angeles calendar days are not nine 24-hour steps across that night.
// 10:00 PST on Nov 6.
const NOW = new Date("2026-11-06T18:00:00Z")
const NEWEST = new Date(NOW.getTime() - 2 * DAY_MS)
// 11:00 PDT on Oct 28: nine Los Angeles calendar days before NOW.
const BEFORE = new Date("2026-10-28T18:00:00Z")

type Base = Map<string, { qtyInRecipeUnit: number; countedAt: Date }>

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  h.calls.length = 0
  h.answers.clear()
  vi.clearAllMocks()
  h.answers.set("store.findFirst", (args) => (args.where?.id === "store_a" && args.where?.accountId === "acct_ours" ? { draftSkipCount: false } : null))
  h.answers.set("store.findMany", () => [
    { id: "store_a", name: "Glendale", draftSkipCount: false },
    { id: "store_b", name: "Van Nuys", draftSkipCount: false },
  ])
  h.answers.set("canonicalIngredient.findMany", () => [
    { id: "ci_fries", name: "fries", recipeUnit: "lb", costPerRecipeUnit: 1, caseUnit: "case", recipeUnitsPerCase: 30, innerPackUnit: null, innerPacksPerCase: null },
    { id: "ci_bags", name: "bags", recipeUnit: "each", costPerRecipeUnit: null, caseUnit: null, recipeUnitsPerCase: null, innerPackUnit: null, innerPacksPerCase: null },
  ])
  // The live context: both items on the newest count.
  h.loadContext.mockResolvedValue({
    sales: [],
    lastCountByIngredient: new Map([["ci_fries", { qtyInRecipeUnit: 60, countedAt: NEWEST }], ["ci_bags", { qtyInRecipeUnit: 500, countedAt: NEWEST }]]) as Base,
  })
  // Fries sells 10 lb a day; nothing uses bags. On hand is whatever count the context was given.
  h.rate.mockImplementation((_ctx: unknown, ing: { id: string }) => ({ ratePerDay: ing.id === "ci_fries" ? 10 : 0 }))
  h.onHand.mockImplementation((ctx: { lastCountByIngredient: Base }, ing: { id: string }) => {
    const base = ctx.lastCountByIngredient.get(ing.id)
    return { baseAt: base?.countedAt ?? null, baseQty: base?.qtyInRecipeUnit ?? 0, onHand: base?.qtyInRecipeUnit ?? 0, partial: false }
  })
})

describe("loadStoreDraft · the account boundary", () => {
  it("reads nothing for a store that is not in the account", async () => {
    await expect(loadStoreDraft("acct_ours", "store_theirs", 4)).rejects.toThrow("not in your account")
    // The one query sent is the check itself, by id AND account.
    expect(h.calls.map((c) => `${c.model}.${c.method}`)).toEqual(["store.findFirst"])
    expect(h.calls[0].args.where).toEqual({ id: "store_theirs", accountId: "acct_ours" })
    expect(h.loadContext).not.toHaveBeenCalled()
  })

  it("carries the account on every query for a store that is", async () => {
    await loadStoreDraft("acct_ours", "store_a", 4)
    const scoped = (c: Call) => {
      const w = c.args.where ?? {}
      const viaInvoice = (w.invoice as { store?: { accountId?: string } } | undefined)?.store
      return w.accountId === "acct_ours" || viaInvoice?.accountId === "acct_ours"
    }
    expect(h.calls.filter((c) => !scoped(c)).map((c) => `${c.model}.${c.method}`)).toEqual([])
    expect(h.loadContext).toHaveBeenCalledWith(expect.objectContaining({ storeId: "store_a", accountId: "acct_ours" }))
  })
})

describe("loadStoreDraft · what the shelf views read", () => {
  it("says which count each item starts from, whether or not anything uses it", async () => {
    const d = await loadStoreDraft("acct_ours", "store_a", 4)
    expect(d.skip).toBe(false)
    expect(d.countsBefore).toBeNull()
    expect(d.reads.get("ci_fries")).toEqual({ onHand: 60, countedAt: NEWEST, vendor: null })
    // Nothing on the menu uses bags: no stock row, but its on hand is still read.
    expect(d.reads.get("ci_bags")).toEqual({ onHand: 500, countedAt: NEWEST, vendor: null })
    expect(d.stock.map((r) => r.id)).toEqual(["ci_fries"])
  })

  it("starts from the counts before the last 7 days when the store skips this week's count", async () => {
    h.answers.set("store.findFirst", () => ({ draftSkipCount: true }))
    h.answers.set("stockCountLine.findMany", () => [
      { canonicalIngredientId: "ci_fries", qtyInRecipeUnit: 90, stockCount: { countedAt: BEFORE } },
    ])
    const d = await loadStoreDraft("acct_ours", "store_a", 4)
    expect(d.skip).toBe(true)
    // The cutoff the shelf views are handed is the one the query used.
    const older = h.calls.find((c) => c.model === "stockCountLine")!
    const stockCount = older.args.where?.stockCount as { store: { accountId: string }; countedAt: { lt: Date }; status: string }
    expect(older.args.where).toMatchObject(anchorLineWhere)
    expect(stockCount).toMatchObject({ storeId: "store_a", store: { accountId: "acct_ours" }, status: "COMPLETED" })
    expect(stockCount.countedAt.lt).toBe(d.countsBefore)
    expect(Date.now() - d.countsBefore!.getTime()).toBeGreaterThanOrEqual(7 * DAY_MS)
    // Fries rolls forward from the older 90, and says so; bags has no count from before, so it reads nothing.
    expect(d.reads.get("ci_fries")).toEqual({ onHand: 90, countedAt: BEFORE, vendor: null })
    expect(d.reads.get("ci_bags")).toEqual({ onHand: null, countedAt: null, vendor: null })
    expect(d.stock[0].counted).toBe("Counted 9 days ago")
    expect(d.stock[0].stale).toBe(true)
  })

  it("works the order out again for a longer cover, from the same reading", async () => {
    const short = await loadStoreDraft("acct_ours", "store_a", 4)
    const long = await loadStoreDraft("acct_ours", "store_a", 14)
    expect(long.reads.get("ci_fries")).toEqual(short.reads.get("ci_fries"))
    const cases = (d: typeof short) => Number(d.vendors.flatMap((v) => v.rows).find((r) => r.id === "ci_fries")?.order.split(" ")[0] ?? 0)
    expect(cases(long)).toBeGreaterThan(cases(short))
  })
})

describe("the Order tab", () => {
  it("drafts the store it shows and no other", async () => {
    const s = await getDraftOrderSectionPromises({ accountId: "acct_ours", storeId: "store_a", coverDays: 4 }).drafts
    if (s.status !== "ready" || !s.data) throw new Error("drafts did not load")
    expect(s.data.store).toEqual({ id: "store_a", name: "Glendale", skip: false })
    expect(s.data).not.toHaveProperty("summaries")
    expect(h.loadContext).toHaveBeenCalledTimes(1)
    expect(h.calls.filter((c) => c.model === "store" && c.method === "findFirst").map((c) => c.args.where?.id)).toEqual(["store_a"])
  })

  it("falls back to the account's first store for an id that is not ours", async () => {
    const s = await getDraftOrderSectionPromises({ accountId: "acct_ours", storeId: "store_theirs", coverDays: 4 }).drafts
    if (s.status !== "ready" || !s.data) throw new Error("drafts did not load")
    expect(s.data.store.id).toBe("store_a")
  })
})
