// Finishing a count: the old per-line loop against the bulk version.
//
// `applyCalibrationUpdatesForCount` made ~6 reads per line through
// `computeRunningOnHand`, then a prior-state read and an upsert per line. It
// now loads the store's inventory context once and writes in one transaction.
// Both run here over ONE in-memory database, and what each WROTE to
// `IngredientModelState` must be the same, field for field.
//
// The recipe walk is stood in for by one table both paths read, so the
// comparison is of everything around it: the anchor count, deliveries (with
// case packs), sales before and after the sales cutoff, adjustments, the
// prior state and the update maths. Quantities are chosen exactly
// representable in binary so "same" can mean `toEqual`.

import { describe, it, expect, vi, beforeEach } from "vitest"

const DAY = 86_400_000
const T = new Date("2026-09-18T21:00:00.000Z")
const at = (daysAgo: number) => new Date(T.getTime() - daysAgo * DAY)

type Row = Record<string, any>

const { db, calls } = vi.hoisted(() => ({
  db: {
    stockCounts: [] as any[],
    countLines: [] as any[],
    ingredients: [] as any[],
    invoiceLines: [] as any[],
    menuItems: [] as any[],
    mappings: [] as any[],
    adjustments: [] as any[],
    states: [] as any[],
  },
  calls: { n: 0, upserts: [] as any[], created: [] as any[], rawValues: [] as any[][] },
}))

const q = <T,>(v: T) => {
  calls.n++
  return Promise.resolve(v)
}
const inRange = (d: Date | null, r?: { gt?: Date; gte?: Date; lte?: Date }) =>
  d !== null && (!r?.gt || d > r.gt) && (!r?.gte || d >= r.gte) && (!r?.lte || d <= r.lte)
const anchorOk = (l: Row) => l.nativeUnit === null || l.nativeUnit !== "partial"

vi.mock("@/lib/inventory/recipe-walk", () => {
  // grams of each ingredient per serving of each recipe
  const per: Record<string, Record<string, number>> = {
    r_pizza: { "ing-1": 0.5, "ing-2": 0.25 },
    r_salad: { "ing-3": 0.125, "ing-2": 1 },
    r_wings: { "ing-4": 0.0625 },
  }
  const f = (recipeId: string, ing: string) => per[recipeId]?.[ing] ?? 0
  return {
    loadRecipeGraph: async () => new Map(),
    walkRecipeForIngredientSync: (_g: unknown, recipeId: string, ing: string) => f(recipeId, ing),
    walkRecipeForIngredient: async (recipeId: string, ing: string) => f(recipeId, ing),
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stockCount: {
      findUnique: ({ where }: Row) => q(db.stockCounts.find((c) => c.id === where.id) ?? null),
      findFirst: ({ where }: Row) =>
        q(db.stockCounts.find((c) => c.id === where.id && c.accountId === where.store.accountId) ?? null),
    },
    canonicalIngredient: {
      findUnique: ({ where }: Row) => q(db.ingredients.find((i) => i.id === where.id) ?? null),
      findMany: ({ where }: Row) =>
        q(db.ingredients.filter((i) => where.id.in.includes(i.id) && i.accountId === where.accountId)),
    },
    stockCountLine: {
      findFirst: ({ where }: Row) => {
        const sc = where.stockCount
        const hits = db.countLines
          .filter((l) => l.canonicalIngredientId === where.canonicalIngredientId && anchorOk(l))
          .filter((l) => l.status === sc.status && l.storeId === sc.storeId && inRange(l.countedAt, sc.countedAt))
          .sort((a, b) => b.countedAt - a.countedAt)
        return q(hits[0] ? { qtyInRecipeUnit: hits[0].qtyInRecipeUnit, stockCount: { countedAt: hits[0].countedAt } } : null)
      },
      findMany: ({ where }: Row) => {
        const sc = where.stockCount
        const hits = db.countLines
          .filter(anchorOk)
          .filter((l) => l.status === sc.status && l.storeId === sc.storeId && inRange(l.countedAt, sc.countedAt))
          .sort((a, b) => b.countedAt - a.countedAt)
        return q(hits.map((l) => ({ canonicalIngredientId: l.canonicalIngredientId, qtyInRecipeUnit: l.qtyInRecipeUnit, stockCount: { countedAt: l.countedAt } })))
      },
    },
    invoiceLineItem: {
      findMany: ({ where }: Row) =>
        q(
          db.invoiceLines
            .filter((l) =>
              where.canonicalIngredientId.not !== undefined
                ? l.canonicalIngredientId !== null
                : l.canonicalIngredientId === where.canonicalIngredientId,
            )
            .filter((l) => l.storeId === where.invoice.storeId && inRange(l.invoiceDate, where.invoice.invoiceDate))
            .map((l) => ({ canonicalIngredientId: l.canonicalIngredientId, quantity: l.quantity, unit: l.unit, invoice: { invoiceDate: l.invoiceDate } })),
        ),
    },
    otterMenuItem: {
      findMany: ({ where }: Row) =>
        q(db.menuItems.filter((m) => m.storeId === where.storeId && inRange(m.date, where.date)).sort((a, b) => a.date - b.date)),
      groupBy: ({ where }: Row) => {
        const by = new Map<string, Row>()
        for (const m of db.menuItems.filter((x) => x.storeId === where.storeId && inRange(x.date, where.date))) {
          const e = by.get(m.itemName) ?? { itemName: m.itemName, _sum: { fpQuantitySold: 0, tpQuantitySold: 0 } }
          e._sum.fpQuantitySold += m.fpQuantitySold ?? 0
          e._sum.tpQuantitySold += m.tpQuantitySold ?? 0
          by.set(m.itemName, e)
        }
        return q([...by.values()])
      },
    },
    otterItemMapping: { findMany: () => q(db.mappings) },
    inventoryAdjustment: {
      findMany: ({ where }: Row) =>
        q(
          db.adjustments
            .filter((a) => a.storeId === where.storeId && (where.canonicalIngredientId === undefined || a.canonicalIngredientId === where.canonicalIngredientId))
            .filter((a) => inRange(a.occurredAt, where.occurredAt)),
        ),
    },
    ingredientModelState: {
      findUnique: ({ where }: Row) => {
        const k = where.storeId_canonicalIngredientId
        return q(db.states.find((s) => s.storeId === k.storeId && s.canonicalIngredientId === k.canonicalIngredientId) ?? null)
      },
      findMany: ({ where }: Row) =>
        q(db.states.filter((s) => s.storeId === where.storeId && where.canonicalIngredientId.in.includes(s.canonicalIngredientId))),
      upsert: (arg: Row) => {
        calls.upserts.push(arg)
        return q(null)
      },
      createMany: (arg: Row) => ({ kind: "createMany", arg }),
    },
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => ({ kind: "raw", strings, values }),
    $transaction: async (ops: Row[]) => {
      calls.n++
      for (const op of ops) {
        if (op.kind === "createMany") calls.created.push(...op.arg.data)
        else calls.rawValues.push(Prisma.sql(op.strings, ...op.values).values)
      }
      return []
    },
  },
}))

import { Prisma } from "@/generated/prisma/client"
import { applyCalibrationUpdatesForCount } from "@/lib/inventory/calibration-update"
import { applyCalibrationUpdatesForCount as legacyApply } from "./fixtures/calibration-update-legacy"

const ing = (id: string, recipeUnit: string, pack: Row = {}) => ({
  id, accountId: "acct", name: id, recipeUnit, caseUnit: null, recipeUnitsPerCase: null, innerPackUnit: null, innerPacksPerCase: null, ...pack,
})

beforeEach(() => {
  calls.n = 0
  calls.upserts = []
  calls.created = []
  calls.rawValues = []
  const s = "store1"
  db.ingredients = [
    ing("ing-1", "lb"),
    ing("ing-2", "oz", { caseUnit: "CS", recipeUnitsPerCase: 64 }),
    ing("ing-3", "each"),
    ing("ing-4", "lb"),
    ing("ing-5", "lb"),
  ]
  db.stockCounts = [
    {
      id: "sc-now", accountId: "acct", storeId: s, countedAt: T, status: "IN_PROGRESS",
      lines: [
        { canonicalIngredientId: "ing-1", qtyInRecipeUnit: 40, estimatedQtyAtCount: 48 },
        { canonicalIngredientId: "ing-2", qtyInRecipeUnit: 100, estimatedQtyAtCount: 96 },
        { canonicalIngredientId: "ing-3", qtyInRecipeUnit: 8, estimatedQtyAtCount: 8 }, // never counted before
        { canonicalIngredientId: "ing-4", qtyInRecipeUnit: 20, estimatedQtyAtCount: 12 }, // last count is a partial: no anchor
        { canonicalIngredientId: "ing-5", qtyInRecipeUnit: 3, estimatedQtyAtCount: null }, // no expectation: skipped
        { canonicalIngredientId: "ing-gone", qtyInRecipeUnit: 3, estimatedQtyAtCount: 3 }, // no such ingredient
      ],
    },
  ]
  const line = (id: string, daysAgo: number, qty: number, nativeUnit: string | null = null) => ({
    canonicalIngredientId: id, qtyInRecipeUnit: qty, nativeUnit, status: "COMPLETED", storeId: s, countedAt: at(daysAgo),
  })
  db.countLines = [
    line("ing-1", 14, 64), line("ing-1", 30, 10),
    line("ing-2", 7, 128), line("ing-2", 21, 32),
    line("ing-4", 9, 5, "partial"),
    { ...line("ing-1", -3, 1), status: "IN_PROGRESS" }, // another open count: never an anchor
  ]
  const inv = (id: string, daysAgo: number, quantity: number, unit: string) => ({
    canonicalIngredientId: id, quantity, unit, storeId: s, invoiceDate: at(daysAgo),
  })
  db.invoiceLines = [
    inv("ing-1", 20, 100, "lb"), inv("ing-1", 10, 16, "lb"), inv("ing-1", 2, 8, "lb"),
    inv("ing-2", 15, 2, "CS"), inv("ing-2", 3, 1, "CS"), inv("ing-2", 3, 48, "oz"),
    inv("ing-3", 40, 24, "each"), inv("ing-3", 5, 12, "each"),
    inv("ing-4", 12, 30, "lb"),
    { ...inv("ing-1", 1, 999, "lb"), storeId: "other" },
  ]
  const sale = (name: string, daysAgo: number, fp: number, tp: number | null = 0) => ({
    storeId: s, date: at(daysAgo), itemName: name, fpQuantitySold: fp, tpQuantitySold: tp,
  })
  db.menuItems = [
    sale("Pizza", 40, 16), sale("Pizza", 25, 32), sale("Pizza", 12, 64, 16), sale("Pizza", 8, 8), sale("Pizza", 2, 24),
    sale("Salad", 35, 8), sale("Salad", 6, 40, 8), sale("Salad", 1, 16),
    sale("Wings", 20, 128), sale("Wings", 4, 64), sale("Wings", 0.5, 32, null),
    { ...sale("Pizza", 3, 5000), storeId: "other" },
  ]
  db.mappings = [
    { otterItemName: "Pizza", recipeId: "r_pizza" },
    { otterItemName: "Salad", recipeId: "r_salad" },
    { otterItemName: "Wings", recipeId: "r_wings" },
  ]
  db.adjustments = [
    { storeId: s, canonicalIngredientId: "ing-1", qty: 4, occurredAt: at(5) },
    { storeId: s, canonicalIngredientId: "ing-1", qty: 2, occurredAt: at(20) }, // before the anchor
    { storeId: s, canonicalIngredientId: "ing-2", qty: 8, occurredAt: at(2) },
    { storeId: s, canonicalIngredientId: "ing-3", qty: 1, occurredAt: at(1) },
  ]
  db.states = [
    {
      storeId: s, canonicalIngredientId: "ing-2", calibrationFactor: 1.25, recountDeltaMean: 0.5,
      recountDeltaM2: 2, sampleSize: 6, consecutiveTightWeeks: 2, isGraduated: false, graduatedAt: null,
    },
    {
      storeId: s, canonicalIngredientId: "ing-4", calibrationFactor: 0.75, recountDeltaMean: -1,
      recountDeltaM2: 8, sampleSize: 12, consecutiveTightWeeks: 3, isGraduated: true, graduatedAt: at(30),
    },
  ]
})

const FIELDS = [
  "calibrationFactor", "recountDeltaMean", "recountDeltaM2", "sampleSize", "consecutiveTightWeeks",
  "isGraduated", "graduatedAt", "confidenceLevel", "typicalWeeklyThroughput", "lastUpdatedAt",
] as const

/** What the OLD loop upserted, by ingredient. `create` and `update` carry the same fields. */
function legacyWrites() {
  const out: Record<string, Row> = {}
  for (const u of calls.upserts) {
    expect(u.create).toEqual({ storeId: u.create.storeId, canonicalIngredientId: u.create.canonicalIngredientId, ...u.update })
    out[u.create.canonicalIngredientId] = Object.fromEntries(FIELDS.map((f) => [f, u.update[f]]))
  }
  return out
}

/** What the NEW version wrote: created rows and the raw UPDATE's VALUES, by ingredient. */
function newWrites() {
  const out: Record<string, Row> = {}
  for (const c of calls.created) out[c.canonicalIngredientId] = Object.fromEntries(FIELDS.map((f) => [f, c[f]]))
  for (const values of calls.rawValues) {
    // (cid, cf, rdm, rdm2, ss, ctw, ig, ga, cl, twt, lu) × rows, then the storeId
    const rows = (values.length - 1) / 11
    expect(values[values.length - 1]).toBe("store1")
    for (let r = 0; r < rows; r++) {
      const v = values.slice(r * 11, r * 11 + 11)
      out[v[0] as string] = Object.fromEntries(FIELDS.map((f, i) => [f, v[i + 1]]))
    }
  }
  return out
}

describe("finishing a count — old per-line loop vs bulk", () => {
  it("writes exactly the same IngredientModelState rows", async () => {
    await legacyApply("sc-now")
    const before = calls.n
    const want = legacyWrites()

    calls.n = 0
    calls.upserts = []
    await applyCalibrationUpdatesForCount("sc-now", "acct")
    const got = newWrites()

    // Four ingredients are written: 1 and 3 are new, 2 and 4 have a prior state.
    expect(Object.keys(want).sort()).toEqual(["ing-1", "ing-2", "ing-3", "ing-4"])
    expect(got).toEqual(want)
    // The prior-state arithmetic really ran for 2 and 4 (so this is not four fresh starts).
    expect(want["ing-2"].sampleSize).toBe(7)
    expect(want["ing-4"].sampleSize).toBe(13)
    expect(want["ing-1"].sampleSize).toBe(1)

    // And the round trips: per line before, fixed after.
    expect(calls.upserts).toHaveLength(0)
    console.log(`round trips for 4 written lines: legacy ${before}, bulk ${calls.n}`)
    expect(calls.n).toBeLessThan(before / 3)
  })

  it("splits creates from updates: one createMany, one UPDATE, in one transaction", async () => {
    await applyCalibrationUpdatesForCount("sc-now", "acct")
    expect(calls.created.map((c) => c.canonicalIngredientId).sort()).toEqual(["ing-1", "ing-3"])
    expect(calls.rawValues).toHaveLength(1)
    expect((calls.rawValues[0].length - 1) / 11).toBe(2) // ing-2, ing-4
  })

  it("makes the same number of queries for 4 lines as for 400", async () => {
    await applyCalibrationUpdatesForCount("sc-now", "acct")
    const small = calls.n
    const extra = Array.from({ length: 396 }, (_, i) => `bulk-${i}`)
    db.ingredients.push(...extra.map((id) => ing(id, "lb")))
    db.stockCounts[0].lines.push(...extra.map((id) => ({ canonicalIngredientId: id, qtyInRecipeUnit: 4, estimatedQtyAtCount: 5 })))
    calls.n = 0
    calls.created = []
    calls.rawValues = []
    await applyCalibrationUpdatesForCount("sc-now", "acct")
    expect(calls.n).toBe(small)
    expect(calls.created.length).toBe(398)
  })

  it("will not finish another account's count", async () => {
    await applyCalibrationUpdatesForCount("sc-now", "someone-else")
    expect(calls.created).toHaveLength(0)
    expect(calls.rawValues).toHaveLength(0)
  })
})
