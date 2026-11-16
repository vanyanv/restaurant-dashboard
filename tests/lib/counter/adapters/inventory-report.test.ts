// Inventory report adapter — the picture the Report tab leads with.
//
// 1. One store: the headline is the rows' shortages (an unknown, never $0,
//    when nothing compared has a price), the coverage line adds up to the
//    count list, and the pair of counts before is its own figure.
// 2. Every store: each store's bar is the Overview tile's own figure, and the
//    total is only the stores that have one.
// 3. Rows carry the ingredient id (two items can share a plain name), and an
//    entry on an item with no price is counted, not valued at $0.
// 4. Tenancy: every read carries the account.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    store: { findMany: vi.fn() },
    stockCount: { findMany: vi.fn() },
    countItem: { findMany: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
    stockCountLine: { findMany: vi.fn() },
    canonicalIngredient: { findMany: vi.fn() },
    inventoryAdjustment: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/inventory/store-inventory-context", () => ({
  loadStoreInventoryContext: vi.fn(),
  runningOnHandFromContext: vi.fn(),
}))
vi.mock("@/lib/counter/adapters/draft-orders", () => ({ STALE_COUNT_DAYS: 7, loadStoreDraft: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { loadStoreInventoryContext, runningOnHandFromContext } from "@/lib/inventory/store-inventory-context"
import { getInventoryReportSectionPromises, type ReportView } from "@/lib/counter/adapters/inventory-report"
import { loadLatestGap, loadStoreWaste } from "@/lib/counter/adapters/count"
import { ADJUSTMENT_REASONS, THROWN_OUT_REASON_IDS } from "@/lib/counter/waste-reasons"
import { ALL_STORES } from "@/lib/counter/shelf-state"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const OLDER = new Date("2026-10-13T15:00:00Z")
const PREV = new Date("2026-10-20T15:00:00Z")
const CUR = new Date("2026-10-27T15:00:00Z")

type Line = { canonicalIngredientId: string; qtyInRecipeUnit: number; nativeUnit: string | null }
type Ing = { id: string; name: string; recipeUnit: string | null; costPerRecipeUnit: number | null }

/** What each count holds, by count id. */
let lines: Record<string, Line[]> = {}
/** The store's finished counts, newest first, by store id. */
let counts: Record<string, Array<{ id: string; countedAt: Date }>> = {}
let ings: Ing[] = []
/** "Should have" on a count, by `${countId}:${ingredientId}`; absent means no starting point on the count before. */
let should: Record<string, number> = {}
let adjustments: Array<{ canonicalIngredientId: string; reason: string; qty: number; occurredAt: Date; canonicalIngredient: { costPerRecipeUnit: number | null } }> = []

function listItem(id: string, unit: string | null = "lb") {
  const ing = ings.find((i) => i.id === id)
  return { id: `stop_${id}`, area: "frozen", layers: [], canonicalIngredientId: id, canonicalIngredient: { name: ing?.name ?? id, recipeUnit: unit, costPerRecipeUnit: ing?.costPerRecipeUnit ?? null } }
}
let list: Array<ReturnType<typeof listItem>> = []

beforeEach(() => {
  vi.clearAllMocks()
  ings = [
    { id: "ci_buns", name: "Buns", recipeUnit: "each", costPerRecipeUnit: 0.5 },
    { id: "ci_fries", name: "Fries", recipeUnit: "lb", costPerRecipeUnit: 2 },
    { id: "ci_beef", name: "Beef", recipeUnit: "lb", costPerRecipeUnit: 5 },
    { id: "ci_lettuce", name: "Lettuce", recipeUnit: "each", costPerRecipeUnit: 1 },
    { id: "ci_cups", name: "Cups", recipeUnit: "each", costPerRecipeUnit: 0.1 },
  ]
  // Six lines on the list: fries is counted at two stops; syrup has no unit, so it is not a line.
  list = [listItem("ci_buns"), listItem("ci_fries"), { ...listItem("ci_fries"), id: "stop_fries_2", area: "fridge" }, listItem("ci_beef"), listItem("ci_lettuce"), listItem("ci_cups"), listItem("ci_syrup", null)]
  counts = {
    store_a: [{ id: "sc_cur", countedAt: CUR }, { id: "sc_prev", countedAt: PREV }, { id: "sc_older", countedAt: OLDER }],
    store_b: [{ id: "sb_cur", countedAt: CUR }],
  }
  lines = {
    sc_cur: [
      { canonicalIngredientId: "ci_buns", qtyInRecipeUnit: 40, nativeUnit: "each" },
      { canonicalIngredientId: "ci_fries", qtyInRecipeUnit: 25, nativeUnit: "lb" },
      // One case and two trays with no size: only part of the shelf.
      { canonicalIngredientId: "ci_beef", qtyInRecipeUnit: 80, nativeUnit: "partial" },
      // Counted now, not on the count before.
      { canonicalIngredientId: "ci_lettuce", qtyInRecipeUnit: 12, nativeUnit: "each" },
    ],
    sc_prev: [{ canonicalIngredientId: "ci_buns", qtyInRecipeUnit: 50, nativeUnit: "each" }],
  }
  // buns: should 50, counted 40 → 10 short ($5). fries: should 20, counted 25 → 5 extra ($10).
  // The pair before: buns should 70, counted 50 → 20 short ($10).
  should = { "sc_cur:ci_buns": 50, "sc_cur:ci_fries": 20, "sc_prev:ci_buns": 70 }
  adjustments = [
    { canonicalIngredientId: "ci_buns", reason: "DROPPED", qty: 4, occurredAt: new Date("2026-10-24T12:00:00Z"), canonicalIngredient: { costPerRecipeUnit: 0.5 } },
    { canonicalIngredientId: "ci_fries", reason: "THEFT", qty: 3, occurredAt: new Date("2026-10-24T12:00:00Z"), canonicalIngredient: { costPerRecipeUnit: 2 } },
  ]

  asMock(prisma.store.findMany).mockResolvedValue([{ id: "store_a", name: "Glendale" }, { id: "store_b", name: "Van Nuys" }])
  asMock(prisma.stockCount.findMany).mockImplementation(async (args: { where: { storeId: string }; take?: number }) =>
    (counts[args.where.storeId] ?? []).slice(0, args.take ?? 99),
  )
  asMock(prisma.countItem.findMany).mockImplementation(async () => list)
  asMock(prisma.invoiceLineItem.findMany).mockResolvedValue([])
  // The anchor filter (`OR`) keeps whole lines only, the way the database would.
  asMock(prisma.stockCountLine.findMany).mockImplementation(async (args: { where: { stockCountId: string; OR?: unknown } }) =>
    (lines[args.where.stockCountId] ?? []).filter((l) => !args.where.OR || l.nativeUnit !== "partial"),
  )
  asMock(prisma.canonicalIngredient.findMany).mockImplementation(async (args: { where: { stockCountLines: { some: { stockCountId: string } } } }) => {
    const on = new Set((lines[args.where.stockCountLines.some.stockCountId] ?? []).map((l) => l.canonicalIngredientId))
    return ings.filter((i) => on.has(i.id))
  })
  asMock(prisma.inventoryAdjustment.findMany).mockImplementation(async (args: { where: { occurredAt: { gt: Date; lte: Date } } }) =>
    adjustments.filter((a) => a.occurredAt > args.where.occurredAt.gt && a.occurredAt <= args.where.occurredAt.lte),
  )
  // The context remembers which count it is the "should have" of.
  asMock(loadStoreInventoryContext).mockImplementation(async (o: { storeId: string; asOf: Date }) => {
    const cur = (counts[o.storeId] ?? []).find((c) => c.countedAt.getTime() - 1 === o.asOf.getTime())
    const prev = (counts[o.storeId] ?? []).find((c) => c.countedAt < o.asOf)
    return { curId: cur?.id, prevAt: prev?.countedAt ?? null }
  })
  asMock(runningOnHandFromContext).mockImplementation((ctx: { curId: string; prevAt: Date | null }, ing: { id: string }) => {
    const onHand = should[`${ctx.curId}:${ing.id}`]
    return onHand === undefined
      ? { baseAt: null, baseQty: 0, deliveriesQty: 0, depletionQty: 0, adjustmentsQty: 0, onHand: 0, partial: false }
      : { baseAt: ctx.prevAt, baseQty: onHand, deliveriesQty: 0, depletionQty: 0, adjustmentsQty: 0, onHand, partial: false }
  })
})

async function report(opts: { storeId?: string; countId?: string } = {}): Promise<ReportView> {
  const s = await getInventoryReportSectionPromises({ accountId: "acct_ours", ...opts }).report
  if (s.status !== "ready" || !s.data) throw new Error("report did not load")
  return s.data
}

describe("the report for one store", () => {
  it("leads with the shortages, and keeps the extra beside them, never netted", async () => {
    const { one } = await report({ storeId: "store_a" })
    expect(one?.headline).toEqual({ items: 2, unpriced: 0, missingDollars: 5 })
    expect(one?.missingDollars).toBe(5)
    expect(one?.extraDollars).toBe(10)
    expect(one?.current?.label).toBe("Tue, Oct 27")
    expect(one?.previous?.label).toBe("Tue, Oct 20")
  })

  it("says how many lines were compared and why the rest were not, adding up to the list", async () => {
    const c = (await report({ storeId: "store_a" })).one?.coverage
    // buns + fries at two stops compared; beef has a box with no size; cups was not on this count;
    // lettuce was not on the count before. Syrup has no unit and is not a line.
    expect(c).toEqual({ lines: 6, compared: 3, noSize: 1, notOnThis: 1, notOnLast: 1 })
    expect(c!.compared + c!.noSize + c!.notOnThis + c!.notOnLast).toBe(c!.lines)
  })

  it("carries the same figure for the pair of counts before, compared only over the items in both", async () => {
    const { one } = await report({ storeId: "store_a" })
    expect(one?.before).toEqual({
      from: "Tue, Oct 13",
      to: "Tue, Oct 20",
      headline: { items: 1, unpriced: 0, missingDollars: 10 },
      // This pair compared buns and fries, the one before only buns: $5 against $10, on buns alone.
      change: { kind: "less", dollars: 5, items: 1, sameItems: false },
    })
  })

  it("compares the two pairs outright when both compared the same items", async () => {
    lines.sc_prev.push({ canonicalIngredientId: "ci_fries", qtyInRecipeUnit: 30, nativeUnit: "lb" })
    should["sc_prev:ci_fries"] = 40 // 10 lb short at $2
    const { one } = await report({ storeId: "store_a" })
    // Now: buns $5 short, fries extra. Before: buns $10 + fries $20.
    expect(one?.before?.headline.missingDollars).toBe(30)
    expect(one?.before?.change).toEqual({ kind: "less", dollars: 25, items: 2, sameItems: true })
  })

  it("does not set a partial recount's total against a full count's", async () => {
    // Full on Oct 13 and Oct 20; on Oct 27 only buns was recounted.
    lines.sc_prev.push({ canonicalIngredientId: "ci_fries", qtyInRecipeUnit: 30, nativeUnit: "lb" })
    should["sc_prev:ci_fries"] = 40
    lines.sc_cur = [{ canonicalIngredientId: "ci_buns", qtyInRecipeUnit: 40, nativeUnit: "each" }]
    const { one } = await report({ storeId: "store_a" })
    expect(one?.headline?.missingDollars).toBe(5) // one line
    expect(one?.before?.headline.missingDollars).toBe(30) // two
    // Not "$25 less": on buns, the one item in both, $5 against $10.
    expect(one?.before?.change).toEqual({ kind: "less", dollars: 5, items: 1, sameItems: false })
  })

  it("has no comparison when the recount shares no item with the pair before", async () => {
    lines.sc_cur = [{ canonicalIngredientId: "ci_fries", qtyInRecipeUnit: 25, nativeUnit: "lb" }]
    const { one } = await report({ storeId: "store_a" })
    expect(one?.before?.change).toEqual({ kind: "no_items_in_both" })
  })

  it("has no earlier pair to compare with when the store has only two counts", async () => {
    counts.store_a = counts.store_a.slice(0, 2)
    const { one } = await report({ storeId: "store_a" })
    expect(one?.headline?.missingDollars).toBe(5)
    expect(one?.before).toBeNull()
  })

  it("has no figure, no coverage and no rows until there are two counts", async () => {
    const { one } = await report({ storeId: "store_b" })
    expect(one).toMatchObject({ rows: [], headline: null, coverage: null, before: null, previous: null })
    expect(one?.current?.label).toBe("Tue, Oct 27")
  })

  it("is an unknown, not $0, when nothing compared has a price", async () => {
    ings[0].costPerRecipeUnit = null
    ings[1].costPerRecipeUnit = null
    const { one } = await report({ storeId: "store_a" })
    expect(one?.headline).toEqual({ items: 2, unpriced: 2, missingDollars: null })
  })

  it("is a real $0.00 when everything compared is priced and nothing is short", async () => {
    should["sc_cur:ci_buns"] = 40
    const { one } = await report({ storeId: "store_a" })
    expect(one?.headline).toEqual({ items: 2, unpriced: 0, missingDollars: 0 })
  })

  it("opens the count asked for, against the one before it", async () => {
    const { one } = await report({ storeId: "store_a", countId: "sc_prev" })
    expect(one?.current?.label).toBe("Tue, Oct 20")
    expect(one?.previous?.label).toBe("Tue, Oct 13")
    expect(one?.headline?.missingDollars).toBe(10)
    // Nothing before Oct 13 to make an earlier pair from.
    expect(one?.before).toBeNull()
  })

  it("gives every row its ingredient id, so two items with one plain name are two rows", async () => {
    ings[1].name = "Buns"
    const { one } = await report({ storeId: "store_a" })
    expect(one?.rows.map((r) => r.name)).toEqual(["Buns", "Buns"])
    expect(new Set(one?.rows.map((r) => r.ingredientId)).size).toBe(2)
  })

  it("counts the logged entries by class, and how many of them have no price", async () => {
    adjustments.push({ canonicalIngredientId: "ci_buns", reason: "EXPIRY", qty: 2, occurredAt: new Date("2026-10-25T12:00:00Z"), canonicalIngredient: { costPerRecipeUnit: null } })
    adjustments.push({ canonicalIngredientId: "ci_fries", reason: "SUPPLIER_RETURN", qty: 1, occurredAt: new Date("2026-10-25T12:00:00Z"), canonicalIngredient: { costPerRecipeUnit: null } })
    const { one } = await report({ storeId: "store_a" })
    // Thrown out: 4 buns at $0.50, and one entry nobody can value.
    expect(one).toMatchObject({ thrownEntries: 2, thrownUnpriced: 1, thrownDollars: 2 })
    // Apart: theft $6; a return with no price is an unknown, never $0.
    expect(one?.apart).toEqual([
      { id: "shrink", label: "Theft", entries: 1, unpriced: 0, dollars: 6 },
      { id: "return", label: "Sent back", entries: 1, unpriced: 1, dollars: null },
    ])
  })

  it("values a class that is only partly priced at its priced entries, and says how many are not", async () => {
    adjustments.push({ canonicalIngredientId: "ci_fries", reason: "THEFT", qty: 1, occurredAt: new Date("2026-10-25T12:00:00Z"), canonicalIngredient: { costPerRecipeUnit: null } })
    const { one } = await report({ storeId: "store_a" })
    expect(one?.apart).toEqual([
      { id: "shrink", label: "Theft", entries: 2, unpriced: 1, dollars: 6 },
      { id: "return", label: "Sent back", entries: 0, unpriced: 0, dollars: null },
    ])
  })
})

describe("thrown out, on the Report and on the Waste tab", () => {
  it("is the same set of reasons in both loaders", async () => {
    // One entry per reason the schema stores, each worth a different power of two,
    // so a total names exactly the reasons that are in it.
    const worth = new Map(ADJUSTMENT_REASONS.map((r, i) => [r.id as string, 2 ** i]))
    const expected = THROWN_OUT_REASON_IDS.reduce((t, id) => t + worth.get(id)!, 0)
    const apart = ADJUSTMENT_REASONS.filter((r) => !(THROWN_OUT_REASON_IDS as string[]).includes(r.id))
    expect(apart.map((r) => r.id)).toEqual(["THEFT", "SUPPLIER_RETURN"])
    asMock(prisma.inventoryAdjustment.findMany).mockImplementation(async (args: { where: { occurredAt: { gte?: Date } } }) =>
      ADJUSTMENT_REASONS.map((r) => ({
        id: `adj_${r.id}`,
        storeId: "store_a",
        canonicalIngredientId: "ci_buns",
        reason: r.id,
        qty: 1,
        note: null,
        // The waste log asks for a rolling window from now; the report for the days between the counts.
        occurredAt: args.where.occurredAt.gte ? new Date(Date.now() - 86_400_000) : new Date("2026-10-24T12:00:00Z"),
        canonicalIngredient: { name: "Buns", recipeUnit: "each", costPerRecipeUnit: worth.get(r.id)! },
      })),
    )
    const waste = await loadStoreWaste("acct_ours", "store_a")
    const { one } = await report({ storeId: "store_a" })
    const buns = one!.rows.find((r) => r.ingredientId === "ci_buns")!

    // The Waste tab's total and the Overview tile.
    expect(waste.week.dollars).toBe(expected)
    expect(waste.week.reasons.map((r) => r.id).sort()).toEqual([...THROWN_OUT_REASON_IDS].sort())
    expect(waste.apart.map((r) => r.id).sort()).toEqual(["SUPPLIER_RETURN", "THEFT"])
    // The Report's tile, and the row the one-item page's working prints.
    expect(one?.thrownDollars).toBe(expected)
    expect(one?.thrownEntries).toBe(THROWN_OUT_REASON_IDS.length)
    expect(buns.thrownDollars).toBe(expected)
    expect(buns.thrown).toBe(THROWN_OUT_REASON_IDS.length)
    expect(one?.apart.map((a) => [a.label, a.dollars])).toEqual([["Theft", worth.get("THEFT")], ["Sent back", worth.get("SUPPLIER_RETURN")]])
    // Thrown out, theft and sent back are everything logged: the row adds across.
    expect(buns.thrown + buns.theft + buns.returned).toBe(ADJUSTMENT_REASONS.length)
    expect(buns.thrownDollars + buns.theftDollars + buns.returnDollars).toBe(2 ** ADJUSTMENT_REASONS.length - 1)
  })
})

describe("the report for every store", () => {
  it("opens every store when none is asked for, each with the Overview tile's figure", async () => {
    const d = await report()
    expect(d.view).toBe(ALL_STORES)
    expect(d.one).toBeNull()
    expect(d.byStore).toEqual([
      { id: "store_a", name: "Glendale", gap: { from: "Tue, Oct 20", to: "Tue, Oct 27", items: 2, unpriced: 0, missingDollars: 5 } },
      // One finished count: nothing to compare yet, and no figure.
      { id: "store_b", name: "Van Nuys", gap: null },
    ])
    expect(d.byStore[0].gap).toEqual(await loadLatestGap("acct_ours", "store_a"))
  })

  it("adds up only the stores that have a figure, and says how many that is", async () => {
    counts.store_b = [{ id: "sb_cur", countedAt: CUR }, { id: "sb_prev", countedAt: PREV }]
    lines.sb_cur = [{ canonicalIngredientId: "ci_cups", qtyInRecipeUnit: 70, nativeUnit: "each" }]
    should["sb_cur:ci_cups"] = 100 // 30 cups short at $0.10
    const d = await report()
    expect(d.total.stores).toBe(2)
    expect(d.total.dollars).toBeCloseTo(8)
    expect(d.byStore.reduce((t, s) => t + (s.gap?.missingDollars ?? 0), 0)).toBeCloseTo(d.total.dollars!)
  })

  it("leaves a store whose figure is unknown out of the total, and has no total when none is known", async () => {
    ings[0].costPerRecipeUnit = null
    ings[1].costPerRecipeUnit = null
    const d = await report()
    expect(d.byStore[0].gap).toMatchObject({ items: 2, unpriced: 2, missingDollars: null })
    expect(d.total).toEqual({ dollars: null, stores: 0 })
  })
})

describe("whose report it is", () => {
  it("sends every read with the account on it", async () => {
    await report({ storeId: "store_a" })
    await report()
    expect(asMock(prisma.store.findMany).mock.calls.every(([a]) => a.where.accountId === "acct_ours")).toBe(true)
    for (const [a] of asMock(prisma.stockCount.findMany).mock.calls) expect(a.where.store).toEqual({ accountId: "acct_ours" })
    for (const [a] of asMock(prisma.stockCountLine.findMany).mock.calls) expect(a.where.stockCount.store).toEqual({ accountId: "acct_ours" })
    for (const [a] of asMock(prisma.canonicalIngredient.findMany).mock.calls) expect(a.where.accountId).toBe("acct_ours")
    for (const [a] of asMock(prisma.inventoryAdjustment.findMany).mock.calls) expect(a.where.store).toEqual({ accountId: "acct_ours" })
    for (const [a] of asMock(prisma.countItem.findMany).mock.calls) expect(a.where.accountId).toBe("acct_ours")
    for (const [a] of asMock(prisma.invoiceLineItem.findMany).mock.calls) expect(a.where.invoice.accountId).toBe("acct_ours")
    for (const [o] of asMock(loadStoreInventoryContext).mock.calls) expect(o.accountId).toBe("acct_ours")
    // The coverage read is every line of the one count shown, of this account's store.
    const coverage = asMock(prisma.stockCountLine.findMany).mock.calls.map(([a]) => a.where).find((w) => !w.OR)
    expect(coverage).toEqual({ stockCountId: "sc_cur", stockCount: { storeId: "store_a", store: { accountId: "acct_ours" } } })
  })

  it("opens every store, never the one named, for a store that is not ours", async () => {
    const d = await report({ storeId: "store_theirs" })
    expect(d.view).toBe(ALL_STORES)
    expect(asMock(prisma.stockCount.findMany).mock.calls.map(([a]) => a.where.storeId).sort()).toEqual(["store_a", "store_b"])
  })

  it("is empty for an account with no store", async () => {
    asMock(prisma.store.findMany).mockResolvedValue([])
    const s = await getInventoryReportSectionPromises({ accountId: "acct_ours" }).report
    expect(s.status).toBe("empty")
  })
})
