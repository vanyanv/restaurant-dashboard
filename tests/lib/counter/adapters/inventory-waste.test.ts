// Inventory waste adapter — "Thrown out" on the Waste tab, and the same
// figure on the Inventory overview's tile.
//
// 1. The total is the last 7 days of the reasons the waste log offers. An
//    entry on an item with no price is listed and counted, never added as $0;
//    with no priced entry the total is an unknown (null), not zero.
// 2. Theft and "sent back" are never in the total: they come back apart.
// 3. The 7 days before are their own figure, and the change is only ever
//    between two real figures.
// 4. One store, every store and the Overview tile read one function.
// 5. Tenancy: the log is read through `store: { accountId }`.

import { describe, it, expect, vi, beforeEach } from "vitest"

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
        return method === "findMany" ? [] : method === "count" ? 0 : null
      },
    })
  const prisma = new Proxy({}, { get: (_t, name: string) => model(name) })
  return { calls, answers, prisma, loadStoreDraft: vi.fn() }
})

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }))
vi.mock("@/lib/counter/adapters/draft-orders", () => ({
  STALE_COUNT_DAYS: 7,
  loadStoreDraft: h.loadStoreDraft,
}))

import { getInventoryWasteSectionPromises, type WasteView } from "@/lib/counter/adapters/inventory-waste"
import { getInventoryShelfSectionPromises } from "@/lib/counter/adapters/inventory-shelf"
import { getCountWasteSectionPromises } from "@/lib/counter/adapters/count"
import { ALL_STORES } from "@/lib/counter/shelf-state"

const DAY = 24 * 60 * 60 * 1000

type Adj = {
  id: string
  storeId: string
  qty: number
  reason: string
  note: string | null
  occurredAt: Date
  canonicalIngredient: { name: string; recipeUnit: string | null; costPerRecipeUnit: number | null }
}

let n = 0
/** An entry `daysAgo` days back: `qty` lb at `cost` a lb (null: no price on file). */
function adj(storeId: string, reason: string, daysAgo: number, qty: number, cost: number | null, name = "Fries"): Adj {
  return {
    id: `a${++n}`,
    storeId,
    qty,
    reason,
    note: null,
    occurredAt: new Date(Date.now() - daysAgo * DAY),
    canonicalIngredient: { name, recipeUnit: "lb", costPerRecipeUnit: cost },
  }
}

/** Answers the log the way the database would: newest first, and no older than the query asks for. */
function logged(rows: Adj[]) {
  h.answers.set("inventoryAdjustment.findMany", (args) => {
    const gte = (args.where?.occurredAt as { gte?: Date } | undefined)?.gte
    return [...rows]
      .filter((r) => !gte || r.occurredAt.getTime() >= gte.getTime())
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
  })
}

async function waste(storeId?: string): Promise<WasteView> {
  const s = await getInventoryWasteSectionPromises({ accountId: "acct_ours", storeId }).waste
  if (s.status !== "ready" || !s.data) throw new Error("waste did not load")
  return s.data
}

beforeEach(() => {
  h.calls.length = 0
  h.answers.clear()
  h.loadStoreDraft.mockReset()
  h.loadStoreDraft.mockResolvedValue({ vendors: [], covered: 0, notCounted: [], belowZero: [], stock: [], reads: new Map(), skip: false, countsBefore: null })
  h.answers.set("store.findMany", () => [
    { id: "store_a", name: "Glendale" },
    { id: "store_b", name: "Van Nuys" },
  ])
})

describe("thrown out at one store", () => {
  it("adds up the priced entries of the last 7 days and says how many that is", async () => {
    logged([
      adj("store_a", "DROPPED", 1, 4, 2), // $8
      adj("store_a", "EXPIRY", 2, 3, 2), // $6
      adj("store_a", "BURNT", 3, 1, null, "Shake syrup"), // no price on file
    ])
    const { one } = await waste("store_a")
    expect(one?.week).toMatchObject({ entries: 3, valued: 2, unpriced: 1, dollars: 14 })
    // The unpriced entry is on the log, with no dollars: listed, not added.
    expect(one?.recent.map((e) => [e.name, e.dollars])).toEqual([["Fries", 8], ["Fries", 6], ["Shake syrup", null]])
    expect(one?.recent.reduce((t, e) => t + (e.dollars ?? 0), 0)).toBe(one?.week.dollars)
  })

  it("draws a bar per reason, biggest first, and one with no price last with no figure", async () => {
    logged([
      adj("store_a", "DROPPED", 1, 1, 2),
      adj("store_a", "EXPIRY", 2, 5, 2),
      adj("store_a", "EXPIRY", 2, 1, null),
      adj("store_a", "REMAKE", 3, 1, null),
    ])
    const { one } = await waste("store_a")
    expect(one?.week.reasons.map((r) => [r.label, r.entries, r.unpriced, r.dollars])).toEqual([
      ["Went bad", 2, 1, 10],
      ["Dropped", 1, 0, 2],
      ["Remake", 1, 1, null],
    ])
    // The bars add up to the headline.
    expect(one?.week.reasons.reduce((t, r) => t + (r.dollars ?? 0), 0)).toBe(one?.week.dollars)
  })

  it("is an unknown, never $0, when nothing logged has a price", async () => {
    logged([adj("store_a", "DROPPED", 1, 4, null), adj("store_a", "DROPPED", 9, 2, 2)])
    const { one, byStore, all } = await waste("store_a")
    expect(one?.week).toMatchObject({ entries: 1, valued: 0, unpriced: 1, dollars: null })
    expect(one?.change).toEqual({ kind: "cant_tell", unpriced: 1 })
    expect(byStore[0].dollars).toBeNull()
    expect(all.dollars).toBeNull()
  })

  it("has nothing, and nothing to compare, when no entry was logged", async () => {
    logged([])
    const { one, all } = await waste("store_a")
    expect(one?.week).toMatchObject({ entries: 0, valued: 0, dollars: null, reasons: [] })
    expect(one?.change).toBeNull()
    expect(all).toMatchObject({ entries: 0, dollars: null, storesLogged: 0 })
  })

  it("keeps theft and sent back apart from waste, each with its own figure", async () => {
    logged([
      adj("store_a", "DROPPED", 1, 4, 2), // $8 of waste
      adj("store_a", "THEFT", 1, 10, 2), // $20, never waste
      adj("store_a", "SUPPLIER_RETURN", 2, 5, 2), // $10, never waste
      adj("store_a", "SUPPLIER_RETURN", 2, 1, null),
    ])
    const { one, byStore } = await waste("store_a")
    expect(one?.week).toMatchObject({ entries: 1, dollars: 8 })
    expect(one?.week.reasons.map((r) => r.id)).toEqual(["DROPPED"])
    expect(one?.recent).toHaveLength(1)
    expect(one?.apart.map((r) => [r.label, r.entries, r.unpriced, r.dollars])).toEqual([
      ["Theft", 1, 0, 20],
      ["Sent back", 2, 1, 10],
    ])
    expect(byStore[0]).toMatchObject({ entries: 1, dollars: 8 })
  })

  it("counts damaged, logged on Stock on hand, as thrown out: the Report's own set", async () => {
    logged([
      adj("store_a", "DROPPED", 1, 4, 2), // $8
      adj("store_a", "DAMAGE", 2, 3, 2), // $6, from "Adjust on hand"
      adj("store_a", "OTHER", 2, 1, 2), // $2
      adj("store_a", "THEFT", 2, 10, 2), // never thrown out
    ])
    const { one, byStore } = await waste("store_a")
    expect(one?.week).toMatchObject({ entries: 3, dollars: 16 })
    expect(one?.week.reasons.map((r) => r.label)).toEqual(["Dropped", "Damaged", "Other"])
    expect(one?.recent.map((e) => e.reason)).toEqual(["Dropped", "Damaged", "Other"])
    expect(one?.apart.map((r) => r.label)).toEqual(["Theft"])
    expect(byStore[0].dollars).toBe(16)
  })

  it("does not compare with the 7 days before while either week has an entry with no price", async () => {
    logged([
      adj("store_a", "DROPPED", 1, 10, 2), // $20
      adj("store_a", "EXPIRY", 2, 1, null), // no price: $20 is the value of 1 of 2 entries
      adj("store_a", "DROPPED", 9, 4, 2), // the week before: $8
    ])
    const { one } = await waste("store_a")
    expect(one?.week).toMatchObject({ entries: 2, valued: 1, dollars: 20 })
    // Not "$12 more": this week's total is not whole.
    expect(one?.change).toEqual({ kind: "cant_tell", unpriced: 1 })
  })

  it("compares with the 7 days before, and reads nothing older than those", async () => {
    logged([
      adj("store_a", "DROPPED", 1, 10, 2), // this week: $20
      adj("store_a", "DROPPED", 9, 4, 2), // the week before: $8
      adj("store_a", "THEFT", 9, 50, 2), // never waste, in either week
      adj("store_a", "DROPPED", 20, 100, 2), // older than both windows
    ])
    const { one } = await waste("store_a")
    expect(one?.week.dollars).toBe(20)
    expect(one?.before).toEqual({ entries: 1, valued: 1, unpriced: 0, dollars: 8 })
    expect(one?.change).toEqual({ kind: "more", dollars: 12 })
    // The read itself is bounded to the two windows.
    const q = h.calls.find((c) => c.model === "inventoryAdjustment")
    const gte = (q?.args.where?.occurredAt as { gte: Date }).gte
    expect(Math.round((Date.now() - gte.getTime()) / DAY)).toBe(14)
  })

  it("says less, the same, or that there was nothing before", async () => {
    logged([adj("store_a", "DROPPED", 1, 1, 2), adj("store_a", "DROPPED", 9, 4, 2)])
    expect((await waste("store_a")).one?.change).toEqual({ kind: "less", dollars: 6 })
    logged([adj("store_a", "DROPPED", 1, 4, 2), adj("store_a", "EXPIRY", 9, 4, 2)])
    expect((await waste("store_a")).one?.change).toEqual({ kind: "same" })
    logged([adj("store_a", "DROPPED", 1, 4, 2)])
    expect((await waste("store_a")).one?.change).toEqual({ kind: "nothing_before" })
  })
})

describe("thrown out at every store", () => {
  beforeEach(() => {
    logged([
      adj("store_a", "DROPPED", 1, 4, 2), // Glendale $8
      adj("store_a", "EXPIRY", 2, 1, null), // Glendale, no price
      adj("store_b", "DROPPED", 1, 1, 2), // Van Nuys $2
      adj("store_b", "EXPIRY", 3, 5, 2), // Van Nuys $10
      adj("store_b", "THEFT", 3, 99, 2), // never waste
    ])
  })

  it("opens every store when none is asked for, with a bar for each", async () => {
    const d = await waste()
    expect(d.view).toBe(ALL_STORES)
    expect(d.one).toBeNull()
    expect(d.byStore).toEqual([
      { id: "store_a", name: "Glendale", entries: 2, unpriced: 1, dollars: 8 },
      { id: "store_b", name: "Van Nuys", entries: 2, unpriced: 0, dollars: 12 },
    ])
  })

  it("adds the stores up to the headline, by store and by reason alike", async () => {
    const d = await waste()
    expect(d.all).toMatchObject({ entries: 4, valued: 3, unpriced: 1, dollars: 20, storesLogged: 2 })
    expect(d.byStore.reduce((t, s) => t + (s.dollars ?? 0), 0)).toBe(d.all.dollars)
    expect(d.all.reasons.map((r) => [r.label, r.entries, r.unpriced, r.dollars])).toEqual([
      ["Dropped", 2, 0, 10],
      ["Went bad", 2, 1, 10],
    ])
  })

  it("shows one store's own figure on its bar when that store is open", async () => {
    const d = await waste("store_b")
    expect(d.one?.store).toEqual({ id: "store_b", name: "Van Nuys" })
    expect(d.one?.week.dollars).toBe(12)
    expect(d.byStore.find((s) => s.id === "store_b")?.dollars).toBe(d.one?.week.dollars)
  })

  it("prints the Waste tab's figure on the Overview tile and in the chat tool", async () => {
    const d = await waste()
    const shelf = await getInventoryShelfSectionPromises({ accountId: "acct_ours" }).shelf
    if (shelf.status !== "ready" || !shelf.data) throw new Error("shelf did not load")
    expect(shelf.data.shelves.map((s) => [s.id, s.waste])).toEqual(
      d.byStore.map((s) => [s.id, { dollars: s.dollars, entries: s.entries, unpriced: s.unpriced }]),
    )
    const chat = await getCountWasteSectionPromises({ accountId: "acct_ours", storeId: "store_a" }).waste
    if (chat.status !== "ready" || !chat.data) throw new Error("waste did not load")
    expect(chat.data.week).toEqual((await waste("store_a")).one?.week)
  })
})

describe("whose waste it is", () => {
  it("reads the log through the store's account, and nothing without the account on it", async () => {
    logged([adj("store_a", "DROPPED", 1, 4, 2)])
    await waste("store_a")
    const log = h.calls.filter((c) => c.model === "inventoryAdjustment")
    expect(log.length).toBeGreaterThan(0)
    for (const c of log) expect(c.args.where?.store).toEqual({ accountId: "acct_ours" })
    const loose = h.calls.filter((c) => {
      const where = c.args?.where ?? {}
      return where.accountId !== "acct_ours" && (where.store as { accountId?: string } | undefined)?.accountId !== "acct_ours"
    })
    expect(loose.map((c) => `${c.model}.${c.method}`)).toEqual([])
  })

  it("never shows a row logged at a store the account does not list", async () => {
    logged([adj("store_a", "DROPPED", 1, 4, 2), adj("store_theirs", "DROPPED", 1, 100, 2)])
    const d = await waste("store_theirs")
    // Not ours: every store opens, and their entry is on no bar and in no total.
    expect(d.view).toBe(ALL_STORES)
    expect(d.all).toMatchObject({ entries: 1, dollars: 8 })
  })

  it("is empty for an account with no store", async () => {
    h.answers.set("store.findMany", () => [])
    const s = await getInventoryWasteSectionPromises({ accountId: "acct_ours" }).waste
    expect(s.status).toBe("empty")
  })
})
