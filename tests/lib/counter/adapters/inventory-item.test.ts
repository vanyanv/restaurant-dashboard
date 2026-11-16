// Inventory one-item adapter — everything the other tabs say about one line
// of the count list, on one page.
//
// 1. It works nothing out: the lines are the Shelf tab's, the gap row is the
//    Report's, the ordering facts are the Report's "How often you order".
// 2. The same item at every store is drawn in one unit, from the saved count:
//    a store that never counted it, or counted it with a box that has no
//    size, has no amount (never 0), and is left out of the total.
// 3. An id that is not on this account's count list shows nothing.
// 4. Tenancy: every read carries the account.

import { describe, it, expect, vi, beforeEach } from "vitest"

type Where = Record<string, unknown>
type Call = { model: string; method: string; args: { where?: Where; take?: number } }

const h = vi.hoisted(() => {
  const calls: Call[] = []
  const answers = new Map<string, (args: Call["args"]) => unknown>()
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, method: string) => async (args: Call["args"]) => {
        calls.push({ model: name, method, args })
        const answer = answers.get(`${name}.${method}`)
        if (answer) return answer(args)
        return method === "findMany" ? [] : method === "count" ? 0 : null
      },
    })
  const prisma = new Proxy({}, { get: (_t, name: string) => model(name) })
  return { calls, answers, prisma, loadStoreDraft: vi.fn(), loadCtx: vi.fn(), running: vi.fn() }
})

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }))
vi.mock("@/lib/counter/adapters/draft-orders", () => ({ STALE_COUNT_DAYS: 7, loadStoreDraft: h.loadStoreDraft }))
vi.mock("@/lib/inventory/store-inventory-context", () => ({
  loadStoreInventoryContext: h.loadCtx,
  runningOnHandFromContext: h.running,
}))

import { getInventoryItemSectionPromises, type ItemView } from "@/lib/counter/adapters/inventory-item"
import { getInventoryShelfSectionPromises } from "@/lib/counter/adapters/inventory-shelf"
import type { StockRow, StoreDraft } from "@/lib/counter/adapters/draft-orders"
import { DEFAULT_COVER_DAYS } from "@/lib/counter/draft-orders"
import { ALL_STORES } from "@/lib/counter/shelf-state"

const CASES = [{ label: "Cases", qty: 30, of: "lb", quarters: false, per: 30 }]
const TRAYS_UNSIZED = { label: "Trays", qty: 0, of: "", quarters: false, unsized: true, per: 0 }

const LAST = new Date("2026-11-08T20:00:00Z")
const OLDER = new Date("2026-11-03T20:00:00Z")

type LineRow = {
  id: string
  storeId: string
  countId: string
  canonicalIngredientId: string
  qtyInRecipeUnit: number
  nativeUnit: string | null
  breakdown: unknown
  stockCount: { countedAt: Date }
}
let lines: LineRow[] = []
let counts: Record<string, Array<{ id: string; countedAt: Date }>> = {}
/** "Should have" on the store's latest count, by `${storeId}:${ingredientId}`. */
let should: Record<string, number> = {}

function line(id: string, storeId: string, ing: string, at: Date, qty: number, breakdown: unknown, nativeUnit: string | null = "lb"): LineRow {
  return { id, storeId, countId: `${storeId}_${at === LAST ? "cur" : "prev"}`, canonicalIngredientId: ing, qtyInRecipeUnit: qty, nativeUnit, breakdown, stockCount: { countedAt: at } }
}

const emptyDraft = (over: Partial<StoreDraft> = {}): StoreDraft => ({
  vendors: [], covered: 0, notCounted: [], belowZero: [], stock: [], reads: new Map(), skip: false, countsBefore: null, ...over,
})

function stockRow(id: string, over: Partial<StockRow> = {}): StockRow {
  return { id, name: id, onHand: "", perDay: "12 lb", daysLeft: 6, orderAt: 3, runsOut: "Runs out Sat, Nov 14", status: "ok", statusText: "", counted: "", stale: false, ...over }
}

beforeEach(() => {
  h.calls.length = 0
  h.answers.clear()
  h.loadStoreDraft.mockReset()
  h.loadCtx.mockReset()
  h.running.mockReset()

  h.answers.set("store.findMany", () => [
    { id: "store_a", name: "Glendale" },
    { id: "store_b", name: "Hollywood" },
    { id: "store_c", name: "Van Nuys" },
  ])
  // Fries sits on two shelves; beef has a tray nobody has sized; syrup has no unit to be counted in.
  h.answers.set("countItem.findMany", () => [
    { id: "stop_fries", area: "frozen", layers: CASES, canonicalIngredientId: "fries", canonicalIngredient: { name: "FRIES 3/8 STRAIGHT CUT", recipeUnit: "lb", costPerRecipeUnit: 1.5 } },
    { id: "stop_fries_2", area: "fridge", layers: CASES, canonicalIngredientId: "fries", canonicalIngredient: { name: "FRIES 3/8 STRAIGHT CUT", recipeUnit: "lb", costPerRecipeUnit: 1.5 } },
    { id: "stop_beef", area: "fridge", layers: [...CASES, TRAYS_UNSIZED], canonicalIngredientId: "beef", canonicalIngredient: { name: "Beef", recipeUnit: "lb", costPerRecipeUnit: 5 } },
    { id: "stop_syrup", area: "dry", layers: [], canonicalIngredientId: "syrup", canonicalIngredient: { name: "Syrup", recipeUnit: null, costPerRecipeUnit: null } },
  ])
  lines = [
    line("a_fries", "store_a", "fries", LAST, 90, { stop_fries: [2], stop_fries_2: [1] }),
    line("a_fries_old", "store_a", "fries", OLDER, 150, { stop_fries: [4], stop_fries_2: [1] }),
    // One case and two trays with no size: the saved 30 lb is only part of the shelf.
    line("a_beef", "store_a", "beef", LAST, 30, { stop_beef: [1, 2] }, "partial"),
    line("b_fries", "store_b", "fries", LAST, 60, { stop_fries: [2], stop_fries_2: [0] }),
    // Van Nuys has never counted fries.
    line("c_beef", "store_c", "beef", LAST, 60, { stop_beef: [2, 0] }),
  ]
  counts = {
    store_a: [{ id: "store_a_cur", countedAt: LAST }, { id: "store_a_prev", countedAt: OLDER }],
    store_b: [{ id: "store_b_cur", countedAt: LAST }],
    store_c: [{ id: "store_c_cur", countedAt: LAST }],
  }
  should = { "store_a:fries": 100 }

  h.answers.set("stockCountLine.findMany", (args) => {
    const w = args.where ?? {}
    const sorted = [...lines].sort((a, b) => b.stockCount.countedAt.getTime() - a.stockCount.countedAt.getTime())
    // The gap's read: one count's whole lines.
    if (typeof w.stockCountId === "string") return sorted.filter((l) => l.countId === w.stockCountId && (!w.OR || l.nativeUnit !== "partial"))
    const ids = (w.id as { in?: string[] } | undefined)?.in
    if (ids) return sorted.filter((l) => ids.includes(l.id))
    const storeId = (w.stockCount as { storeId?: string } | undefined)?.storeId
    return sorted.filter((l) => l.storeId === storeId)
  })
  h.answers.set("stockCount.findMany", (args) => (counts[args.where?.storeId as string] ?? []).slice(0, args.take ?? 99))
  h.answers.set("canonicalIngredient.findMany", (args) => {
    const countId = (args.where?.stockCountLines as { some: { stockCountId: string } }).some.stockCountId
    const on = new Set(lines.filter((l) => l.countId === countId).map((l) => l.canonicalIngredientId))
    return [
      { id: "fries", name: "FRIES 3/8 STRAIGHT CUT", recipeUnit: "lb", costPerRecipeUnit: 1.5 },
      { id: "beef", name: "Beef", recipeUnit: "lb", costPerRecipeUnit: 5 },
    ].filter((i) => on.has(i.id))
  })
  const invoiced = (day: string, quantity: number) => ({
    canonicalIngredientId: "fries", quantity, unit: "CS", extendedPrice: quantity * 40,
    canonicalIngredient: { name: "FRIES 3/8 STRAIGHT CUT" },
    invoice: { invoiceDate: new Date(`${day}T12:00:00Z`), vendorName: "Sysco" },
  })
  h.answers.set("invoiceLineItem.findMany", (args) =>
    (args.where?.invoice as { storeId: string }).storeId === "store_a" ? [invoiced("2026-10-27", 4), invoiced("2026-11-03", 4), invoiced("2026-11-10", 6)] : [],
  )

  h.loadStoreDraft.mockImplementation(async (_acct: string, storeId: string) =>
    storeId === "store_a"
      ? emptyDraft({ stock: [stockRow("fries")], reads: new Map([["fries", { onHand: 72, countedAt: LAST, vendor: "Sysco" }], ["beef", { onHand: null, countedAt: null, vendor: null }]]) })
      : emptyDraft({ reads: new Map([["fries", { onHand: 60, countedAt: LAST, vendor: null }]]) }),
  )
  h.loadCtx.mockImplementation(async (o: { storeId: string }) => ({ storeId: o.storeId }))
  h.running.mockImplementation((ctx: { storeId: string }, ing: { id: string }) => {
    const onHand = should[`${ctx.storeId}:${ing.id}`]
    return onHand === undefined
      ? { baseAt: null, baseQty: 0, deliveriesQty: 0, depletionQty: 0, adjustmentsQty: 0, onHand: 0, partial: false }
      : { baseAt: OLDER, baseQty: 150, deliveriesQty: 0, depletionQty: 50, adjustmentsQty: 0, onHand, partial: false }
  })
})

async function item(ingredientId: string, storeId?: string): Promise<ItemView> {
  const s = await getInventoryItemSectionPromises({ accountId: "acct_ours", ingredientId, storeId }).item
  if (s.status !== "ready" || !s.data) throw new Error("item did not load")
  return s.data
}

describe("one item at every store", () => {
  it("draws each store's saved count in the item's unit, and what was typed there", async () => {
    const d = await item("fries")
    expect(d.view).toBe(ALL_STORES)
    expect(d.one).toBeNull()
    expect(d.item).toMatchObject({ id: "fries", unit: "lb", fullName: "FRIES 3/8 STRAIGHT CUT", areas: "Frozen · Refrigeration" })
    expect(d.byStore.map((b) => [b.name, b.qty, b.amount, b.typed, b.day, b.why])).toEqual([
      ["Glendale", 90, "90 lb", "2 Cases; 1 Cases", "Sun, Nov 8", null],
      ["Hollywood", 60, "60 lb", "2 Cases; 0 Cases", "Sun, Nov 8", null],
      ["Van Nuys", null, null, null, null, "not_counted"],
    ])
  })

  it("adds up only the stores with a whole count, and says how many that is", async () => {
    const d = await item("fries")
    expect(d.across).toEqual({ amount: "150 lb", stores: 2 })
    expect(d.byStore.reduce((t, b) => t + (b.qty ?? 0), 0)).toBe(150)
  })

  it("has no amount, never a part of one, where a box has no size", async () => {
    const d = await item("beef")
    expect(d.byStore.map((b) => [b.name, b.qty, b.why])).toEqual([
      ["Glendale", null, "no_size"],
      ["Hollywood", null, "not_counted"],
      ["Van Nuys", 60, null],
    ])
    // Glendale's 30 lb is one case of a shelf that also holds two unsized trays: it is not in the total.
    expect(d.across).toEqual({ amount: "60 lb", stores: 1 })
    expect(d.byStore[0]).toMatchObject({ amount: null, typed: "1 Cases + 2 Trays", day: "Sun, Nov 8" })
  })

  it("has no total when no store has a whole count", async () => {
    lines = lines.filter((l) => l.id !== "c_beef")
    expect((await item("beef")).across).toBeNull()
  })

  it("carries the switcher's own numbers", async () => {
    const d = await item("fries")
    const shelf = await getInventoryShelfSectionPromises({ accountId: "acct_ours" }).shelf
    if (shelf.status !== "ready" || !shelf.data) throw new Error("shelf did not load")
    expect(d.stores).toEqual(shelf.data.stores)
    expect(d.total).toBe(shelf.data.total)
  })
})

describe("one item at one store", () => {
  it("shows the Shelf tab's own lines, the saved amount and what it is worth", async () => {
    const d = await item("fries", "store_a")
    const shelf = await getInventoryShelfSectionPromises({ accountId: "acct_ours", storeId: "store_a" }).shelf
    if (shelf.status !== "ready" || !shelf.data) throw new Error("shelf did not load")
    expect(d.one?.lines).toEqual(shelf.data.shelves[0].lines.filter((l) => l.ingredientId === "fries"))
    expect(d.one).toMatchObject({ store: { id: "store_a", name: "Glendale" }, counted: "Sun, Nov 8", amount: "90 lb", worth: 135 })
    expect(d.one?.lines.map((l) => l.last)).toEqual([
      { day: "Tue, Nov 3", typed: "4 Cases" },
      { day: "Tue, Nov 3", typed: "1 Cases" },
    ])
  })

  it("says how fast it goes only when the draft order has a use rate for it", async () => {
    expect((await item("fries", "store_a")).one?.perDay).toBe("12 lb")
    // Hollywood's draft has no stock row for fries: nothing on the menu uses it there.
    expect((await item("fries", "store_b")).one?.perDay).toBeNull()
  })

  it("names each box and what it holds, once", async () => {
    expect((await item("fries", "store_a")).one?.sizes).toEqual(["Cases: 30 lb each"])
    expect((await item("beef", "store_a")).one?.sizes).toEqual(["Cases: 30 lb each", "Trays: no size yet"])
  })

  it("shows the Report's own row since the last count, and its verdict", async () => {
    const d = await item("fries", "store_a")
    expect(d.one?.gapWhy).toBeNull()
    expect(d.one?.gap).toMatchObject({ from: "Tue, Nov 3", to: "Sun, Nov 8", verdict: "short" })
    // Should have 100, counted 90: 10 lb at $1.50.
    expect(d.one?.gap?.row).toMatchObject({ ingredientId: "fries", should: 100, counted: 90, missing: 10, missingDollars: 15, last: 150, used: 50 })
  })

  it("says matches when the count is within 5% of what should be there", async () => {
    should["store_a:fries"] = 92
    expect((await item("fries", "store_a")).one?.gap?.verdict).toBe("match")
    should["store_a:fries"] = 60
    expect((await item("fries", "store_a")).one?.gap?.verdict).toBe("extra")
  })

  it("says why there is no comparison: one count, or not counted both times", async () => {
    expect((await item("fries", "store_b")).one).toMatchObject({ gap: null, gapWhy: "one_count" })
    // Beef at Glendale: two counts, but its line has a box with no size, so it is on no row.
    expect((await item("beef", "store_a")).one).toMatchObject({ gap: null, gapWhy: "not_compared" })
  })

  it("is not valued, and has no days left, while a box has no size", async () => {
    const d = await item("beef", "store_a")
    expect(d.one).toMatchObject({ amount: null, worth: null, perDay: null, counted: "Sun, Nov 8" })
    expect(d.one?.lines[0]).toMatchObject({ state: "cant_tell", dollars: null, notValuedWhy: "size" })
  })

  it("is not counted, with nothing made up, at a store that never counted it", async () => {
    const d = await item("fries", "store_c")
    expect(d.one).toMatchObject({ counted: null, amount: null, worth: null, perDay: null, ordering: null })
    expect(d.one?.lines.map((l) => l.state)).toEqual(["not_counted", "not_counted"])
  })

  it("reads how it is ordered from the store's invoices", async () => {
    const d = await item("fries", "store_a")
    expect(d.one?.ordering).toMatchObject({ ingredientId: "fries", vendor: "Sysco", orders: 3, usually: "Tue", amount: "4 CS", every: "7 days" })
    expect((await item("fries", "store_b")).one?.ordering).toBeNull()
  })
})

describe("whose item it is", () => {
  it("shows nothing for an id that is not on this account's count list", async () => {
    const d = await item("someone_elses")
    expect(d).toMatchObject({ item: null, one: null, byStore: [], across: null })
    // Nor for one with no unit to be counted in.
    expect((await item("syrup", "store_a")).item).toBeNull()
  })

  it("sends no query without the account on it", async () => {
    await item("fries", "store_a")
    expect(h.calls.length).toBeGreaterThan(0)
    const scoped = (c: Call) => {
      const w = c.args?.where ?? {}
      const via = (k: string) => (w[k] as { accountId?: string; store?: { accountId?: string } } | undefined)
      return w.accountId === "acct_ours" || via("store")?.accountId === "acct_ours" || via("stockCount")?.store?.accountId === "acct_ours" || via("invoice")?.accountId === "acct_ours"
    }
    expect(h.calls.filter((c) => !scoped(c)).map((c) => `${c.model}.${c.method}`)).toEqual([])
    for (const [acct, , cover] of h.loadStoreDraft.mock.calls) {
      expect(acct).toBe("acct_ours")
      expect(cover).toBe(DEFAULT_COVER_DAYS)
    }
    for (const [o] of h.loadCtx.mock.calls) expect(o.accountId).toBe("acct_ours")
    // The ordering read is this store's invoices for this one item.
    const inv = h.calls.find((c) => c.model === "invoiceLineItem")
    expect(inv?.args.where).toMatchObject({ canonicalIngredientId: { in: ["fries"] }, invoice: { accountId: "acct_ours", storeId: "store_a" } })
  })

  it("opens every store, never the one named, for a store that is not ours", async () => {
    const d = await item("fries", "store_theirs")
    expect(d.view).toBe(ALL_STORES)
    expect(d.one).toBeNull()
    expect(h.loadStoreDraft.mock.calls.map((c) => c[1]).sort()).toEqual(["store_a", "store_b", "store_c"])
  })

  it("is empty for an account with no store", async () => {
    h.answers.set("store.findMany", () => [])
    const s = await getInventoryItemSectionPromises({ accountId: "acct_ours", ingredientId: "fries" }).item
    expect(s.status).toBe("empty")
  })
})
