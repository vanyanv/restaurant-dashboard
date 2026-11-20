// Inventory shelf adapter — the lines the Overview, the Shelf tab and the
// store switcher are all drawn from.
//
// 1. `buildShelfLines` is pure: what a line says for each thing the item's
//    latest count line and the draft order can tell it, and that an unknown is
//    never $0. Wherever the draft has a row for an item, the shelf says what
//    the Order tab says.
// 2. The loaders read each item's LATEST finished line (an item skipped on a
//    recount keeps its older number), only the counts the draft read, and no
//    more than each figure needs.
// 3. Tenancy: every query the adapter (and the loaders it borrows from the
//    Waste and Report tabs) sends carries the signed-in account, as
//    `accountId` on account-owned rows and `store: { accountId }` on
//    store-owned ones.

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
  lastCountsSay,
  type CountLine,
} from "@/lib/counter/adapters/inventory-shelf"
import type { ItemRow } from "@/lib/counter/adapters/count"
import type { DraftRead, DraftRow, StockRow, StoreDraft } from "@/lib/counter/adapters/draft-orders"
import { DEFAULT_COVER_DAYS } from "@/lib/counter/draft-orders"
import { UNCONVERTED_UNIT } from "@/lib/inventory/anchor-line"
import { ALL_STORES, shelfCoverage, toOrderNow } from "@/lib/counter/shelf-state"

const CASES = [{ label: "Cases", qty: 30, of: "lb", quarters: false, per: 30 }]
const TRAYS_UNSIZED = { label: "Trays", qty: 0, of: "", quarters: false, unsized: true, per: 0 }
const TRAYS_SIZED = { label: "Trays", qty: 5, of: "lb", quarters: false, per: 5 }

/** The store's last count, and one a week before it. */
const LAST = new Date("2026-11-08T20:00:00Z")
const OLDER = new Date("2026-11-03T20:00:00Z")

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

function counted(
  id: string,
  qty: number,
  boxes: number[] | Record<string, number[]> | null,
  over: Partial<CountLine> = {},
): [string, CountLine] {
  const breakdown = Array.isArray(boxes) ? { [`stop_${id}`]: boxes } : boxes
  return [id, { canonicalIngredientId: id, qtyInRecipeUnit: qty, nativeUnit: "lb", breakdown, countedAt: LAST, ...over }]
}

function stockRow(id: string, status: StockRow["status"], over: Partial<StockRow> = {}): StockRow {
  return { id, name: id, onHand: "", perDay: "", daysLeft: 2, orderAt: 3, runsOut: "Runs out Tue, Nov 17", status, statusText: "", counted: "", stale: false, ...over }
}

function draftRow(id: string, when: string, order: string): DraftRow {
  return { id, name: id, order, when } as DraftRow
}

function read(onHand: number | null, over: Partial<DraftRead> = {}): DraftRead {
  return { onHand, countedAt: onHand === null ? null : LAST, vendor: null, ...over }
}

type Draft = Pick<StoreDraft, "stock" | "vendors" | "reads">
function draft(over: Partial<Draft> = {}): Draft {
  return { stock: [], vendors: [], reads: new Map(), ...over }
}

function build(
  items: ItemRow[],
  lines: Array<[string, CountLine]>,
  d: Draft = draft(),
  over: { lastCountAt?: Date | null; skip?: boolean; previous?: Array<[string, CountLine]> } = {},
) {
  return buildShelfLines({
    items,
    latest: new Map(lines),
    previous: over.previous ? new Map(over.previous) : undefined,
    lastCountAt: over.lastCountAt === undefined ? LAST : over.lastCountAt,
    skip: over.skip,
    draft: d,
  })
}

describe("buildShelfLines", () => {
  it("says not counted, with no value, when the store has no finished count", () => {
    const [line] = build([item("fries")], [], draft(), { lastCountAt: null })
    expect(line).toMatchObject({ state: "not_counted", dollars: null, typed: null, amount: null, notValued: null, from: null, note: "No finished count yet" })
  })

  it("says not counted only for an item that has never been on a finished count", () => {
    const [line] = build([item("fries")], [])
    expect(line).toMatchObject({ state: "not_counted", dollars: null, note: "Never on a finished count" })
  })

  it("says which counts it read when this week's count is being skipped", () => {
    const [line] = build([item("fries")], [], draft(), { skip: true })
    expect(line).toMatchObject({ state: "not_counted", note: "Not on a count from before the last 7 days" })
  })

  it("is in stock, valued, with no run-out date when nothing on the menu uses it", () => {
    const [line] = build([item("fries")], [counted("fries", 60, [2])], draft({ reads: new Map([["fries", read(60, { vendor: "Sysco" })]]) }))
    expect(line).toMatchObject({ state: "in_stock", stateText: "In stock", typed: "2 Cases", dollars: 90, daysLeft: null, runsOut: null, order: null, from: null, note: null })
    expect(line.amount).toContain("60")
  })

  it("is out when it was counted at zero, and says why there is no draft", () => {
    const [line] = build([item("towels")], [counted("towels", 0, [0])], draft({ reads: new Map([["towels", read(0, { vendor: "Sysco" })]]) }))
    expect(line).toMatchObject({ state: "out", stateText: "Out", typed: "0 Cases", amount: null, order: null, belowZero: false })
    expect(line.note).toBe("No draft yet: nothing on the menu uses it, so the app can't size an order. Last from Sysco")
  })

  it("carries the draft order's amount, vendor and days for a line to order today", () => {
    const [line] = build([item("fries")], [counted("fries", 60, [2])], draft({
      stock: [stockRow("fries", "now")],
      vendors: [{ vendor: "Sysco", lead: "", rows: [draftRow("fries", "Order today", "3 cases")], dollars: 0, unpriced: 0 }],
      reads: new Map([["fries", read(40, { vendor: "Sysco" })]]),
    }))
    expect(line).toMatchObject({
      state: "order_now", stateText: "Order today", order: "3 cases", vendor: "Sysco", when: "Order today",
      daysLeft: 2, orderAt: 3, runsOut: "Runs out Tue, Nov 17", note: "Draft order: 3 cases from Sysco",
    })
  })

  it("reads the draft's own day for a line to order soon", () => {
    const [line] = build([item("fries")], [counted("fries", 60, [2])], draft({
      stock: [stockRow("fries", "soon")],
      vendors: [{ vendor: "Sysco", lead: "", rows: [draftRow("fries", "Order by Thu, Nov 19", "2 cases")], dollars: 0, unpriced: 0 }],
    }))
    expect(line).toMatchObject({ state: "order_soon", stateText: "Order by Thu, Nov 19" })
  })

  it("does not value a line with no price on file, and never shows it as $0", () => {
    const [line] = build([item("cups", { cost: null })], [counted("cups", 60, [2])])
    expect(line).toMatchObject({ state: "in_stock", dollars: null, notValuedWhy: "price", notValued: "No price on file yet" })
  })

  it("is not out while another shelf of the same item still holds some", () => {
    const lines = build(
      [item("fries", { id: "stop_a" }), item("fries", { id: "stop_b", area: "fridge" })],
      [counted("fries", 60, { stop_a: [0], stop_b: [2] })],
      draft({ reads: new Map([["fries", read(60)]]) }),
    )
    expect(lines.map((l) => [l.state, l.dollars])).toEqual([["in_stock", 0], ["in_stock", 90]])
  })

  it("leaves out an item that has no unit to be counted in", () => {
    expect(build([item("mystery", { unit: null })], [])).toEqual([])
  })

  /* ── An item skipped on a recount keeps its older number ─────────────── */

  it("reads an item from its latest line and says which count that was", () => {
    // A three-line recount: fries is on it, buns is not and keeps Nov 3's number.
    const lines = build(
      [item("fries"), item("buns")],
      [counted("fries", 60, [2]), counted("buns", 30, [1], { countedAt: OLDER })],
      draft({
        stock: [stockRow("buns", "now")],
        vendors: [{ vendor: "Sysco", lead: "", rows: [draftRow("buns", "Order today", "2 cases")], dollars: 0, unpriced: 0 }],
        reads: new Map([["fries", read(60)], ["buns", read(4, { countedAt: OLDER })]]),
      }),
    )
    expect(lines[0]).toMatchObject({ state: "in_stock", from: null })
    // Not "Not counted": the Order tab has it to order today, and so does the shelf.
    expect(lines[1]).toMatchObject({ state: "order_now", from: "Tue, Nov 3", typed: "1 Cases", dollars: 45, order: "2 cases" })
    expect(toOrderNow(lines)).toBe(1)
    expect(shelfCoverage(lines)).toMatchObject({ lines: 2, counted: 2, notCounted: 0 })
  })

  /* ── A box with no size on the latest count ──────────────────────────── */

  it("does not value a box with no size, and says which box", () => {
    const [line] = build([item("lettuce", { layers: [...CASES, TRAYS_UNSIZED] })], [counted("lettuce", 30, [1, 3], { nativeUnit: "partial" })])
    expect(line).toMatchObject({
      state: "cant_tell", stateText: "Not valued yet", dollars: null, notValuedWhy: "size",
      notValued: "3 Trays: no size set yet", typed: "1 Cases + 3 Trays", note: null, belowZero: false,
    })
  })

  it("shows the draft's reading, not 'can't tell', when the draft could start from the count before", () => {
    const [line] = build(
      [item("lettuce", { layers: [...CASES, TRAYS_UNSIZED] })],
      [counted("lettuce", 30, [1, 3], { nativeUnit: "partial" })],
      draft({
        stock: [stockRow("lettuce", "now")],
        vendors: [{ vendor: "Sysco", lead: "", rows: [draftRow("lettuce", "Order today", "4 cases")], dollars: 0, unpriced: 0 }],
        reads: new Map([["lettuce", read(12, { countedAt: OLDER, vendor: "Sysco" })]]),
      }),
    )
    // Same state as the Order tab; still not valued, and still in "Set sizes".
    expect(line).toMatchObject({ state: "order_now", stateText: "Order today", order: "4 cases", dollars: null, notValuedWhy: "size", daysLeft: 2 })
    expect(line.note).toBe("Draft order: 4 cases from Sysco. The latest count has a box with no size yet. Read from the Tue, Nov 3 count")
  })

  it("points at the other shelf when the box with no size is there", () => {
    const lines = build(
      [item("beef", { id: "stop_a" }), item("beef", { id: "stop_b", area: "fridge", layers: [...CASES, TRAYS_UNSIZED] })],
      [counted("beef", 60, { stop_a: [2], stop_b: [0, 4] }, { nativeUnit: "partial" })],
    )
    expect(lines[0]).toMatchObject({ state: "cant_tell", dollars: 90, notValuedWhy: null, note: "Another shelf of this item has a box with no size yet" })
    expect(lines[1]).toMatchObject({ state: "cant_tell", dollars: null, notValuedWhy: "size", notValued: "4 Trays: no size set yet", note: null })
  })

  it("says to count again, not to set sizes, once every box has been given a size", () => {
    // Counted with unsized trays; the trays were sized afterwards. The saved line is still a floor.
    const [line] = build([item("lettuce", { layers: [...CASES, TRAYS_SIZED] })], [counted("lettuce", 30, [1, 3], { nativeUnit: "partial" })])
    expect(line).toMatchObject({ state: "cant_tell", stateText: "Can't tell yet", typed: "1 Cases + 3 Trays", note: "Sized after this count. Count it again" })
    // Not valued from today's sizes (1 case of 30 + 3 trays of 5 = 45): the saved line is a floor of 30,
    // and nothing on the page may disagree with it. Not in "Set sizes" either: it is one to count again.
    expect(line).toMatchObject({ dollars: null, amount: null, notValuedWhy: "boxes", notValued: "A size or a box was changed after this count" })
  })

  /* ── On hand reads below zero ────────────────────────────────────────── */

  it("flags a counted line whose on hand has rolled below zero since the count", () => {
    const [line] = build([item("beef")], [counted("beef", 30, [1])], draft({
      stock: [stockRow("beef", "unknown", { daysLeft: null, orderAt: null })],
      reads: new Map([["beef", read(-12)]]),
    }))
    expect(line).toMatchObject({ state: "cant_tell", belowZero: true, daysLeft: null, runsOut: null, note: "On hand reads below zero. Count it again" })
  })

  it("keeps a line counted at zero Out when sales since read it below zero, and says the draft has no line for it", () => {
    const [line] = build([item("lettuce")], [counted("lettuce", 0, [0])], draft({
      // The draft skips it: "Reads below zero", no vendor row.
      stock: [stockRow("lettuce", "unknown", { daysLeft: null, orderAt: null })],
      reads: new Map([["lettuce", read(-3, { vendor: "Sysco" })]]),
    }))
    expect(line).toMatchObject({ state: "out", belowZero: true, order: null })
    expect(line.note).toBe("On hand reads below zero since the count. A delivery may not be invoiced yet. Count it again")
  })

  /* ── Nothing on the menu uses it ─────────────────────────────────────── */

  it("is out, not in stock, once everything counted has been logged off", () => {
    const [line] = build([item("bags")], [counted("bags", 60, [2])], draft({ reads: new Map([["bags", read(0)]]) }))
    expect(line).toMatchObject({ state: "out", belowZero: false })
    expect(line.note).toBe("Everything counted has been logged off since. No draft: nothing on the menu uses it, so the app can't size an order")
  })

  /* ── Counts without boxes, and boxes changed since ───────────────────── */

  it("hangs a count taken without boxes on the item's first stop, once", () => {
    const lines = build([item("fries", { id: "stop_a" }), item("fries", { id: "stop_b", area: "fridge" })], [counted("fries", 45, null)])
    expect(lines[0]).toMatchObject({ dollars: 67.5, typed: null, note: null })
    expect(lines[1]).toMatchObject({ dollars: 0, note: "Counted with Frozen" })
    expect(lines.reduce((t, l) => t + (l.dollars ?? 0), 0)).toBe(67.5)
  })

  it("does not count the second stop of an unpriced item as valued at $0", () => {
    const lines = build(
      [item("fries", { id: "stop_a", cost: null }), item("fries", { id: "stop_b", area: "fridge", cost: null })],
      [counted("fries", 45, null)],
    )
    expect(lines.map((l) => [l.dollars, l.notValuedWhy])).toEqual([[null, "price"], [null, "price"]])
    expect(shelfCoverage(lines)).toMatchObject({ counted: 2, valued: 0, notValued: 2, dollars: null })
  })

  /* ── A size or a box edited in Sizes & list after the count ──────────── */

  it("shows the quantity the count saved, not the typed boxes at a size edited since", () => {
    // 2 cases of 30 lb were saved as 60 lb; the case was then edited to 60 lb.
    const bigger = [{ label: "Cases", qty: 60, of: "lb", quarters: false, per: 60 }]
    const [line] = build([item("fries", { layers: bigger })], [counted("fries", 60, [2])], draft({ stock: [stockRow("fries", "ok")], reads: new Map([["fries", read(55)]]) }))
    // 60 lb and $90, as saved and as the draft order starts from; never 2 × 60 = 120.
    expect(line).toMatchObject({ state: "ok", typed: "2 Cases", dollars: 90, notValuedWhy: null })
    expect(line.amount).toContain("60")
    expect(line.amount).not.toContain("120")
    expect(line.note).toBe("A size or a box was changed after this count, so this is the total saved then")
  })

  it("shows that saved total once when the item sits on two shelves", () => {
    const bigger = [{ label: "Cases", qty: 60, of: "lb", quarters: false, per: 60 }]
    const lines = build(
      [item("fries", { id: "stop_a" }), item("fries", { id: "stop_b", area: "fridge", layers: bigger })],
      [counted("fries", 90, { stop_a: [2], stop_b: [1] })],
    )
    expect(lines.map((l) => [l.typed, l.dollars])).toEqual([["2 Cases", 135], ["1 Cases", 0]])
    expect(lines[1].amount).toBeNull()
    expect(lines[1].note).toBe("A size or a box was changed after this count: its amount is with Frozen")
    expect(shelfCoverage(lines).dollars).toBe(90 * 1.5)
  })

  it("keeps the item's state, and the saved total, when one stop's boxes were changed after the count", () => {
    const lines = build(
      [item("fries", { id: "stop_a" }), item("fries", { id: "stop_b", area: "fridge", layers: [...CASES, TRAYS_SIZED] })],
      [counted("fries", 90, { stop_a: [2], stop_b: [1] })],
      draft({ stock: [stockRow("fries", "ok")], reads: new Map([["fries", read(80)]]) }),
    )
    // One number was typed for a stop that now has two boxes: it reads nothing, but the item is still fine
    // and its 90 lb is still on the page.
    expect(lines[0]).toMatchObject({ state: "ok", typed: "2 Cases", dollars: 135 })
    expect(lines[1]).toMatchObject({ state: "ok", typed: null, dollars: 0 })
  })

  it("carries the whole total on the first stop when no stop's boxes fit any more", () => {
    const [line] = build([item("fries", { layers: [...CASES, TRAYS_SIZED] })], [counted("fries", 60, [2])], draft({ stock: [stockRow("fries", "now")], reads: new Map([["fries", read(10)]]) }))
    expect(line).toMatchObject({ state: "order_now", dollars: 90, typed: null })
  })

  it("reads a stop added to the list after the count as part of the item, with nothing on it", () => {
    const lines = build(
      [item("fries", { id: "stop_a" }), item("fries", { id: "stop_new", area: "dry" })],
      [counted("fries", 60, { stop_a: [2] })],
      draft({ reads: new Map([["fries", read(60)]]) }),
    )
    expect(lines[0]).toMatchObject({ state: "in_stock", dollars: 90, note: null })
    expect(lines[1]).toMatchObject({ state: "in_stock", dollars: 0, typed: null, note: "Not on this count: added or changed since" })
  })

  /* ── The count before: what was typed last time ──────────────────────── */

  it("says what was typed on the count before, with its day, and never an amount worked out from it", () => {
    const [line] = build([item("fries")], [counted("fries", 60, [2])], draft(), { previous: [counted("fries", 90, [3], { countedAt: OLDER })] })
    expect(line.last).toEqual({ day: "Tue, Nov 3", typed: "3 Cases" })
  })

  it("has no last count for an item counted once, or never", () => {
    expect(build([item("fries")], [counted("fries", 60, [2])])[0].last).toBeNull()
    // Never counted: a previous line cannot stand in for the one that is missing.
    expect(build([item("fries")], [], draft(), { previous: [counted("fries", 90, [3], { countedAt: OLDER })] })[0].last).toBeNull()
  })

  it("reads each stop's own boxes from the count before", () => {
    const lines = build(
      [item("fries", { id: "stop_a" }), item("fries", { id: "stop_b", area: "fridge" })],
      [counted("fries", 90, { stop_a: [2], stop_b: [1] })],
      draft(),
      { previous: [counted("fries", 150, { stop_a: [4], stop_b: [1] }, { countedAt: OLDER })] },
    )
    expect(lines.map((l) => l.last?.typed)).toEqual(["4 Cases", "1 Cases"])
  })

  it("shows the saved total, once, when the count before was taken without boxes", () => {
    const lines = build(
      [item("fries", { id: "stop_a" }), item("fries", { id: "stop_b", area: "fridge" })],
      [counted("fries", 90, { stop_a: [2], stop_b: [1] })],
      draft(),
      { previous: [counted("fries", 45, null, { countedAt: OLDER })] },
    )
    expect(lines[0].last?.typed).toContain("45")
    expect(lines[1].last).toBeNull()
  })

  it("says nothing about a count before whose boxes no longer fit the stop, or that had a box with no size", () => {
    const changed = build([item("fries", { layers: [...CASES, TRAYS_SIZED] })], [counted("fries", 60, [2, 0])], draft(), {
      previous: [counted("fries", 90, [3], { countedAt: OLDER })],
    })
    expect(changed[0].last).toBeNull()
    const unsized = build([item("fries")], [counted("fries", 60, [2])], draft(), {
      previous: [counted("fries", 0, null, { countedAt: OLDER, nativeUnit: UNCONVERTED_UNIT })],
    })
    expect(unsized[0].last).toBeNull()
  })

  it("never puts today's box name on a count typed in a different box", () => {
    // Then: 3 Cases of 30 lb, saved as 90 lb. Since: the stop's one box is a 5 lb bag.
    // The saved "3" still fits one box by position, and would read "3 Bags".
    const bags = [{ label: "Bags", qty: 5, of: "lb", quarters: false, per: 5 }]
    const [line] = build([item("fries", { layers: bags })], [counted("fries", 10, [2])], draft(), {
      previous: [counted("fries", 90, [3], { countedAt: OLDER })],
    })
    expect(line.last?.typed).toContain("90")
    expect(line.last?.typed).not.toContain("Bags")
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

/* ── The loaders ──────────────────────────────────────────────────────── */

const emptyDraft = (over: Partial<StoreDraft> = {}): StoreDraft => ({
  vendors: [], covered: 0, notCounted: [], belowZero: [], stock: [], reads: new Map(), skip: false, countsBefore: null, ...over,
})

/** A `stockCountLine` row as each of the adapter's two reads selects it. */
type LineRow = { id: string; canonicalIngredientId: string; qtyInRecipeUnit: number; nativeUnit: string | null; breakdown: unknown; stockCount: { countedAt: Date } }
function lineRow(id: string, ing: string, at: Date, qty = 60, boxes = [2]): LineRow {
  return { id, canonicalIngredientId: ing, qtyInRecipeUnit: qty, nativeUnit: "lb", breakdown: { [`stop_${ing}`]: boxes }, stockCount: { countedAt: at } }
}

/** Answers both reads from one list, newest first, the way the database would. */
function countLines(rows: LineRow[]) {
  h.answers.set("stockCountLine.findMany", (args) => {
    const ids = (args.where?.id as { in?: string[] } | undefined)?.in
    const sorted = [...rows].sort((a, b) => b.stockCount.countedAt.getTime() - a.stockCount.countedAt.getTime())
    return ids ? sorted.filter((r) => ids.includes(r.id)) : sorted
  })
}

function countList(...ids: string[]) {
  h.answers.set("countItem.findMany", () => ids.map((id) => item(id)))
}

describe("the shelf loaders", () => {
  beforeEach(() => {
    h.calls.length = 0
    h.answers.clear()
    h.loadStoreDraft.mockReset()
    h.loadStoreDraft.mockResolvedValue(emptyDraft())
    h.answers.set("store.findMany", () => [
      { id: "store_a", name: "Glendale", isActive: true },
      { id: "store_b", name: "Van Nuys", isActive: true },
    ])
  })

  /** Account-owned models are filtered by `accountId`; everything a store owns goes through the store. */
  function scopedTo(call: Call, accountId: string): boolean {
    const where = call.args?.where ?? {}
    const store = where.store as { accountId?: string } | undefined
    const viaCount = (where.stockCount as { store?: { accountId?: string } } | undefined)?.store
    return where.accountId === accountId || store?.accountId === accountId || viaCount?.accountId === accountId
  }

  async function shelfOf(storeId?: string) {
    const shelf = await getInventoryShelfSectionPromises({ accountId: "acct_ours", storeId }).shelf
    if (shelf.status !== "ready" || !shelf.data) throw new Error("shelf did not load")
    return shelf.data
  }

  it("sends no query without the account on it", async () => {
    countList("fries")
    countLines([lineRow("l1", "fries", LAST)])
    await shelfOf()
    expect(h.calls.length).toBeGreaterThan(0)
    const loose = h.calls.filter((c) => !scopedTo(c, "acct_ours")).map((c) => `${c.model}.${c.method}`)
    expect(loose).toEqual([])
  })

  it("asks for each store's draft with the account, at the Order tab's default cover", async () => {
    await shelfOf()
    expect(h.loadStoreDraft.mock.calls).toEqual([
      ["acct_ours", "store_a", DEFAULT_COVER_DAYS],
      ["acct_ours", "store_b", DEFAULT_COVER_DAYS],
    ])
  })

  it("a store that is not ours opens every store, never the one named", async () => {
    const data = await shelfOf("store_theirs")
    expect(data.view).toBe(ALL_STORES)
    expect(data.shelves.map((s) => s.id)).toEqual(["store_a", "store_b"])
  })

  it("keeps an item skipped on a recount at its older number, and says how many lines that is", async () => {
    countList("fries", "buns", "cups")
    // A one-line recount on Nov 8; buns was last counted on Nov 3; cups never.
    countLines([lineRow("l_new", "fries", LAST), lineRow("l_old_fries", "fries", OLDER, 30, [1]), lineRow("l_old_buns", "buns", OLDER, 0, [0])])
    h.loadStoreDraft.mockResolvedValue(emptyDraft({ reads: new Map([["fries", read(60)], ["buns", read(0, { countedAt: OLDER })]]) }))
    const [glendale] = (await shelfOf()).shelves
    expect(glendale.lines.map((l) => [l.ingredientId, l.state, l.from])).toEqual([
      ["fries", "in_stock", null],
      ["buns", "out", "Tue, Nov 3"],
      ["cups", "not_counted", null],
    ])
    expect(glendale.lastCount).toMatchObject({ day: "Sun, Nov 8", older: 1 })
    // 2 of 3 lines have been counted, not 1; buns is still one to order.
    expect(glendale.coverage).toMatchObject({ lines: 3, counted: 2, notCounted: 1 })
    expect(glendale.toOrder).toBe(1)
    // Only each item's latest line, and the one before it, are read in full.
    const full = h.calls.find((c) => c.model === "stockCountLine" && c.args.where?.id)
    expect((full?.args.where?.id as { in: string[] }).in.sort()).toEqual(["l_new", "l_old_buns", "l_old_fries"])
    // Fries shows what was typed on Nov 3; buns has no count before its only one.
    expect(glendale.lines.map((l) => l.last)).toEqual([{ day: "Tue, Nov 3", typed: "1 Cases" }, null, null])
  })

  it("reads only the counts the draft read while this week's count is skipped", async () => {
    countList("fries")
    countLines([lineRow("l_new", "fries", LAST, 0, [0]), lineRow("l_old", "fries", OLDER)])
    // The draft started from Nov 3: everything from Nov 5 on is left out.
    h.loadStoreDraft.mockResolvedValue(emptyDraft({ skip: true, countsBefore: new Date("2026-11-05T00:00:00Z"), reads: new Map([["fries", read(55, { countedAt: OLDER })]]) }))
    const [glendale] = (await shelfOf()).shelves
    expect(glendale.skip).toBe(true)
    expect(glendale.lastCount).toMatchObject({ day: "Tue, Nov 3", older: 0 })
    // Nov 8 says zero, but the draft never saw it: the shelf is the Nov 3 one, as the order is.
    expect(glendale.lines[0]).toMatchObject({ state: "in_stock", typed: "2 Cases", from: null })
    expect(glendale.toOrder).toBe(0)
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

  it("prints the same number on the switcher as on the shelf, from the lines alone", async () => {
    countList("fries", "buns")
    countLines([lineRow("l1", "fries", LAST, 0, [0]), lineRow("l2", "buns", LAST)])
    h.loadStoreDraft.mockResolvedValue(emptyDraft({ reads: new Map([["fries", read(0)], ["buns", read(60)]]) }))
    const sw = await getInventorySwitcherSectionPromises({ accountId: "acct_ours" }).switcher
    if (sw.status !== "ready" || !sw.data) throw new Error("switcher did not load")
    expect(sw.data).toEqual({
      stores: [{ id: "store_a", name: "Glendale", toOrder: 1 }, { id: "store_b", name: "Van Nuys", toOrder: 1 }],
      total: 2,
    })
    // One integer per store: no open count, no week of waste, no two-count gap.
    expect([...new Set(h.calls.map((c) => c.model))].sort()).toEqual(["countItem", "stockCountLine", "store"])
    expect(h.calls.filter((c) => !scopedTo(c, "acct_ours"))).toEqual([])

    h.calls.length = 0
    const data = await shelfOf()
    expect(data.stores).toEqual(sw.data.stores)
    expect(data.total).toBe(2)
  })

  it("counts the switcher from the draft at the cover the Order tab is showing", async () => {
    await getInventorySwitcherSectionPromises({ accountId: "acct_ours", coverDays: 14 }).switcher
    expect(h.loadStoreDraft.mock.calls).toEqual([
      ["acct_ours", "store_a", 14],
      ["acct_ours", "store_b", 14],
    ])
  })

  it("is empty for an account with no store", async () => {
    h.answers.set("store.findMany", () => [])
    const sw = await getInventorySwitcherSectionPromises({ accountId: "acct_ours" }).switcher
    expect(sw.status).toBe("empty")
    expect(h.loadStoreDraft).not.toHaveBeenCalled()
  })
})

describe("lastCountsSay — which stores have a count to trust, on All stores", () => {
  const at = (day: string, stale: boolean) => ({ day, ago: "", stale, older: 0 })
  it("groups each store by its last finished count", () => {
    expect(lastCountsSay([
      { name: "Van Nuys", lastCount: at("Nov 12", false) },
      { name: "Burbank", lastCount: at("Sep 3", true) },
      { name: "Glendale", lastCount: null },
    ])).toBe("Recent count: Van Nuys (Nov 12). Old count: Burbank (Sep 3). Not counted yet: Glendale.")
  })
  it("says only what is true when every store is counted", () => {
    expect(lastCountsSay([{ name: "Van Nuys", lastCount: at("Nov 12", false) }])).toBe("Recent count: Van Nuys (Nov 12).")
  })
})
