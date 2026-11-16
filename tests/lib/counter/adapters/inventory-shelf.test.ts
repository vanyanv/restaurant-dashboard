// Inventory shelf adapter — the lines the Overview, the Shelf tab and the
// store switcher are all drawn from.
//
// 1. `buildShelfLines` is pure: what a line says for each thing the last
//    count and the draft order can tell it, and that an unknown is never $0.
// 2. Tenancy: every query the adapter (and the loaders it borrows from the
//    Waste and Report tabs) sends carries the signed-in account, as
//    `accountId` on account-owned rows and `store: { accountId }` on
//    store-owned ones.

import { describe, it, expect, vi, beforeEach } from "vitest"

type Call = { model: string; method: string; args: { where?: Record<string, unknown> } }

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
// The draft order has its own tests; here it is the thing the shelf reads.
vi.mock("@/lib/counter/adapters/draft-orders", () => ({
  STALE_COUNT_DAYS: 7,
  loadStoreDraft: h.loadStoreDraft,
}))

import {
  buildShelfLines,
  getInventoryShelfSectionPromises,
  getInventorySwitcherSectionPromises,
  pickShelfView,
} from "@/lib/counter/adapters/inventory-shelf"
import type { ItemRow } from "@/lib/counter/adapters/count"
import type { DraftRow, StockRow, StoreDraft } from "@/lib/counter/adapters/draft-orders"
import { ALL_STORES } from "@/lib/counter/shelf-state"

const CASES = [{ label: "Cases", qty: 30, of: "lb", quarters: false, per: 30 }]

function item(id: string, over: Partial<ItemRow> & { cost?: number | null; unit?: string | null } = {}): ItemRow {
  const { cost = 1.5, unit = "lb", ...rest } = over
  return {
    id: `stop_${id}`,
    area: "frozen",
    layers: CASES,
    canonicalIngredientId: id,
    canonicalIngredient: { name: id, recipeUnit: unit, costPerRecipeUnit: cost },
    ...rest,
  }
}

function counted(id: string, qty: number, boxes: number[] | null, nativeUnit: string | null = "lb", stop = `stop_${id}`) {
  return [id, { canonicalIngredientId: id, qtyInRecipeUnit: qty, nativeUnit, breakdown: boxes ? { [stop]: boxes } : null }] as const
}

function stockRow(id: string, status: StockRow["status"], over: Partial<StockRow> = {}): StockRow {
  return { id, name: id, onHand: "", perDay: "", daysLeft: 2, orderAt: 3, runsOut: "Runs out Tue, Nov 17", status, statusText: "", counted: "", stale: false, ...over }
}

function draftRow(id: string, when: string, order: string): DraftRow {
  return { id, name: id, order, when } as DraftRow
}

function draft(over: Partial<Pick<StoreDraft, "stock" | "vendors" | "reads">> = {}): Pick<StoreDraft, "stock" | "vendors" | "reads"> {
  return { stock: [], vendors: [], reads: new Map(), ...over }
}

describe("buildShelfLines", () => {
  it("says not counted, with no value, when the store has no finished count", () => {
    const [line] = buildShelfLines({ items: [item("fries")], lastLines: null, lastDay: null, draft: draft() })
    expect(line).toMatchObject({ state: "not_counted", dollars: null, typed: null, amount: null, notValued: null, note: "No finished count yet" })
  })

  it("says not counted for a line the last count left blank, and names the count", () => {
    const [line] = buildShelfLines({ items: [item("fries")], lastLines: new Map(), lastDay: "Sun, Nov 8", draft: draft() })
    expect(line).toMatchObject({ state: "not_counted", dollars: null, note: "Not on the Sun, Nov 8 count" })
  })

  it("is in stock, valued, with no run-out date when nothing on the menu uses it", () => {
    const [line] = buildShelfLines({
      items: [item("fries")],
      lastLines: new Map([counted("fries", 60, [2])]),
      lastDay: "Sun, Nov 8",
      draft: draft({ reads: new Map([["fries", { onHand: 60, vendor: "Sysco" }]]) }),
    })
    expect(line).toMatchObject({ state: "in_stock", stateText: "In stock", typed: "2 Cases", dollars: 90, daysLeft: null, runsOut: null, order: null })
    expect(line.amount).toContain("60")
  })

  it("is out when it was counted at zero, and says why there is no draft", () => {
    const [line] = buildShelfLines({
      items: [item("towels")],
      lastLines: new Map([counted("towels", 0, [0])]),
      lastDay: "Sun, Nov 8",
      draft: draft({ reads: new Map([["towels", { onHand: 0, vendor: "Sysco" }]]) }),
    })
    expect(line).toMatchObject({ state: "out", stateText: "Out", typed: "0 Cases", amount: null, order: null })
    expect(line.note).toBe("No draft yet: nothing on the menu uses it, so the app can't size an order. Last from Sysco")
  })

  it("carries the draft order's amount, vendor and days for a line to order today", () => {
    const [line] = buildShelfLines({
      items: [item("fries")],
      lastLines: new Map([counted("fries", 60, [2])]),
      lastDay: "Sun, Nov 8",
      draft: draft({
        stock: [stockRow("fries", "now")],
        vendors: [{ vendor: "Sysco", lead: "", rows: [draftRow("fries", "Order today", "3 cases")], dollars: 0, unpriced: 0 }],
        reads: new Map([["fries", { onHand: 40, vendor: "Sysco" }]]),
      }),
    })
    expect(line).toMatchObject({
      state: "order_now", stateText: "Order today", order: "3 cases", vendor: "Sysco", when: "Order today",
      daysLeft: 2, orderAt: 3, runsOut: "Runs out Tue, Nov 17", note: "Draft order: 3 cases from Sysco",
    })
  })

  it("reads the draft's own day for a line to order soon", () => {
    const [line] = buildShelfLines({
      items: [item("fries")],
      lastLines: new Map([counted("fries", 60, [2])]),
      lastDay: "Sun, Nov 8",
      draft: draft({
        stock: [stockRow("fries", "soon")],
        vendors: [{ vendor: "Sysco", lead: "", rows: [draftRow("fries", "Order by Thu, Nov 19", "2 cases")], dollars: 0, unpriced: 0 }],
      }),
    })
    expect(line).toMatchObject({ state: "order_soon", stateText: "Order by Thu, Nov 19" })
  })

  it("does not value a box with no size, and says which box", () => {
    const layers = [...CASES, { label: "Trays", qty: 0, of: "", quarters: false, unsized: true, per: 0 }]
    const [line] = buildShelfLines({
      items: [item("lettuce", { layers })],
      lastLines: new Map([counted("lettuce", 30, [1, 3], "partial")]),
      lastDay: "Sun, Nov 8",
      draft: draft(),
    })
    expect(line).toMatchObject({
      state: "cant_tell", stateText: "Not valued yet", dollars: null, notValuedWhy: "size",
      notValued: "3 Trays: no size set yet", typed: "1 Cases + 3 Trays", note: null,
    })
  })

  it("does not value a line with no price on file, and never shows it as $0", () => {
    const [line] = buildShelfLines({
      items: [item("cups", { cost: null })],
      lastLines: new Map([counted("cups", 60, [2])]),
      lastDay: "Sun, Nov 8",
      draft: draft(),
    })
    expect(line).toMatchObject({ state: "in_stock", dollars: null, notValuedWhy: "price", notValued: "No price on file yet" })
  })

  it("flags a line whose on hand has rolled below zero since the count", () => {
    const [line] = buildShelfLines({
      items: [item("beef")],
      lastLines: new Map([counted("beef", 30, [1])]),
      lastDay: "Sun, Nov 8",
      draft: draft({ stock: [stockRow("beef", "unknown", { daysLeft: null, orderAt: null })], reads: new Map([["beef", { onHand: -12, vendor: null }]]) }),
    })
    expect(line).toMatchObject({ state: "cant_tell", belowZero: true, daysLeft: null, runsOut: null, note: "On hand reads below zero. Count it again" })
  })

  it("is not out while another shelf of the same item still holds some", () => {
    const lines = buildShelfLines({
      items: [item("fries", { id: "stop_a" }), item("fries", { id: "stop_b", area: "fridge" })],
      lastLines: new Map([["fries", { canonicalIngredientId: "fries", qtyInRecipeUnit: 60, nativeUnit: "lb", breakdown: { stop_a: [0], stop_b: [2] } }]]),
      lastDay: "Sun, Nov 8",
      draft: draft({ reads: new Map([["fries", { onHand: 60, vendor: null }]]) }),
    })
    expect(lines.map((l) => [l.state, l.dollars])).toEqual([["in_stock", 0], ["in_stock", 90]])
  })

  it("hangs a count taken without boxes on the item's first stop, once", () => {
    const lines = buildShelfLines({
      items: [item("fries", { id: "stop_a" }), item("fries", { id: "stop_b", area: "fridge" })],
      lastLines: new Map([counted("fries", 45, null)]),
      lastDay: "Sun, Nov 8",
      draft: draft(),
    })
    expect(lines[0]).toMatchObject({ dollars: 67.5, typed: null, note: null })
    expect(lines[1]).toMatchObject({ dollars: 0, note: "Counted with Frozen" })
    expect(lines.reduce((t, l) => t + (l.dollars ?? 0), 0)).toBe(67.5)
  })

  it("leaves out an item that has no unit to be counted in", () => {
    expect(buildShelfLines({ items: [item("mystery", { unit: null })], lastLines: new Map(), lastDay: null, draft: draft() })).toEqual([])
  })
})

describe("pickShelfView", () => {
  const stores = [{ id: "a" }, { id: "b" }]
  it("shows the store asked for", () => expect(pickShelfView(stores, "b")).toBe("b"))
  it("shows every store when none is asked for, or one that is not ours", () => {
    expect(pickShelfView(stores, undefined)).toBe(ALL_STORES)
    expect(pickShelfView(stores, "theirs")).toBe(ALL_STORES)
  })
  it("shows the only store there is", () => expect(pickShelfView([{ id: "a" }], undefined)).toBe("a"))
  it("has nothing to show an account with no store", () => expect(pickShelfView([], "a")).toBeNull())
})

describe("inventory shelf tenancy", () => {
  beforeEach(() => {
    h.calls.length = 0
    h.answers.clear()
    h.loadStoreDraft.mockReset()
    h.loadStoreDraft.mockResolvedValue({ vendors: [], covered: 0, notCounted: [], belowZero: [], stock: [], reads: new Map() })
    h.answers.set("store.findMany", () => [
      { id: "store_a", name: "Glendale", draftSkipCount: false },
      { id: "store_b", name: "Van Nuys", draftSkipCount: true },
    ])
  })

  /** Account-owned models are filtered by `accountId`; everything a store owns goes through the store. */
  function scopedTo(call: Call, accountId: string): boolean {
    const where = call.args?.where ?? {}
    const store = where.store as { accountId?: string } | undefined
    return where.accountId === accountId || store?.accountId === accountId
  }

  it("sends no query without the account on it", async () => {
    const shelf = await getInventoryShelfSectionPromises({ accountId: "acct_ours" }).shelf
    expect(shelf.status).toBe("ready")
    expect(h.calls.length).toBeGreaterThan(0)
    const loose = h.calls.filter((c) => !scopedTo(c, "acct_ours")).map((c) => `${c.model}.${c.method}`)
    expect(loose).toEqual([])
    // Both stores were read: the last count, an open count, waste and the two-count gap for each.
    for (const storeId of ["store_a", "store_b"]) {
      const forStore = h.calls.filter((c) => c.args?.where?.storeId === storeId)
      expect(forStore.map((c) => c.model).sort()).toEqual(["inventoryAdjustment", "stockCount", "stockCount", "stockCount"])
    }
  })

  it("asks for each store's draft with the account, at the Order tab's default cover", async () => {
    await getInventoryShelfSectionPromises({ accountId: "acct_ours" }).shelf
    expect(h.loadStoreDraft.mock.calls.map((c) => [c[0], c[1], c[3]])).toEqual([
      ["acct_ours", "store_a", false],
      ["acct_ours", "store_b", true],
    ])
    expect(new Set(h.loadStoreDraft.mock.calls.map((c) => c[2])).size).toBe(1)
  })

  it("a store that is not ours opens every store, never the one named", async () => {
    const shelf = await getInventoryShelfSectionPromises({ accountId: "acct_ours", storeId: "store_theirs" }).shelf
    if (shelf.status !== "ready" || !shelf.data) throw new Error("shelf did not load")
    expect(shelf.data.view).toBe(ALL_STORES)
    expect(shelf.data.shelves.map((s) => s.id)).toEqual(["store_a", "store_b"])
  })

  it("reads not counted, not zero, for a store with no finished count", async () => {
    const sw = await getInventorySwitcherSectionPromises({ accountId: "acct_ours" }).switcher
    if (sw.status !== "ready" || !sw.data) throw new Error("switcher did not load")
    expect(sw.data.stores).toEqual([
      { id: "store_a", name: "Glendale", toOrder: null },
      { id: "store_b", name: "Van Nuys", toOrder: null },
    ])
    expect(sw.data.total).toBeNull()
  })

  it("is empty for an account with no store", async () => {
    h.answers.set("store.findMany", () => [])
    const sw = await getInventorySwitcherSectionPromises({ accountId: "acct_ours" }).switcher
    expect(sw.status).toBe("empty")
  })
})
