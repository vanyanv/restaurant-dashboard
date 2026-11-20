// The DailyCogsItem write path of the COGS materializer.
//
// Every sweep recomputes its whole window. Since 2026-11-20 the upsert only
// rewrites a row whose figures moved (WHERE ... IS DISTINCT FROM over every
// value column), so an unchanged row keeps its computedAt; the range bust
// fires once per range and only when a row was inserted, updated or deleted;
// and days run three at a time by default.

import { describe, it, expect, vi, beforeEach } from "vitest"

type RawSql = { sql: string; values: unknown[] }
const raw: RawSql[] = []
let affected: (sql: RawSql) => number = () => 0
let menuRows: unknown[] = []
let inFlight = 0
let maxInFlight = 0

vi.mock("@/lib/cache/cached", () => ({
  bustTags: vi.fn(async () => {}),
  monthTagsForRange: vi.fn(() => ["month:2026-07"]),
}))

vi.mock("@/lib/prisma", () => {
  const empty = () => vi.fn(async () => [])
  const tx = {
    $executeRaw: vi.fn(async (sql: RawSql) => {
      raw.push(sql)
      return affected(sql)
    }),
  }
  return {
    prisma: {
      otterMenuItem: {
        findMany: vi.fn(async () => {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          await new Promise((r) => setTimeout(r, 5))
          inFlight--
          return menuRows
        }),
      },
      otterItemMapping: { findMany: empty() },
      recipe: { findMany: empty() },
      otterOrderSubItem: { findMany: empty() },
      otterSubItemMapping: { findMany: empty() },
      otterOrder: { findMany: empty() },
      canonicalIngredient: { findMany: empty() },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  }
})

import { bustTags } from "@/lib/cache/cached"
import { recomputeDailyCogsForRange } from "@/lib/cogs-materializer"

const STORE = "store-1"
const start = new Date("2026-07-20T00:00:00Z")
const end = new Date("2026-07-25T00:00:00Z")

beforeEach(() => {
  vi.clearAllMocks()
  raw.length = 0
  affected = () => 0
  inFlight = 0
  maxInFlight = 0
  menuRows = [
    {
      date: start,
      itemName: "Mystery Slider",
      category: "Sliders",
      fpQuantitySold: 2,
      tpQuantitySold: 0,
      fpTotalSales: 20,
      tpTotalSales: 0,
    },
  ]
})

const inserts = () => raw.filter((r) => r.sql.includes(`INSERT INTO "DailyCogsItem"`))

describe("recomputeDailyCogsForRange — change-only writes", () => {
  it("only rewrites a row whose figures differ, over every value column", async () => {
    await recomputeDailyCogsForRange({ storeId: STORE, accountId: "acct", startDate: start, endDate: start })
    const sql = inserts()[0].sql.replace(/\s+/g, " ")
    expect(sql).toContain(`ON CONFLICT ("storeId", "date", "itemName", "category")`)
    expect(sql).toMatch(
      /WHERE \( "DailyCogsItem"\."recipeId", "DailyCogsItem"\."qtySold", "DailyCogsItem"\."salesRevenue", "DailyCogsItem"\."unitCost", "DailyCogsItem"\."lineCost", "DailyCogsItem"\."status", "DailyCogsItem"\."partialCost", "DailyCogsItem"\."costSource" \) IS DISTINCT FROM \( EXCLUDED\."recipeId", EXCLUDED\."qtySold", EXCLUDED\."salesRevenue", EXCLUDED\."unitCost", EXCLUDED\."lineCost", EXCLUDED\."status", EXCLUDED\."partialCost", EXCLUDED\."costSource" \)/,
    )
  })

  it("does not bust the COGS cache when no row changed", async () => {
    const r = await recomputeDailyCogsForRange({ storeId: STORE, accountId: "acct", startDate: start, endDate: end })
    expect(r.daysProcessed).toBe(6)
    expect(r.rowsUpserted).toBe(6)
    expect(r.rowsChanged).toBe(0)
    expect(bustTags).not.toHaveBeenCalled()
  })

  it("busts once for the whole range when any row changed (upsert or cleanup)", async () => {
    affected = (sql) => (sql.sql.includes("DELETE") ? 1 : 0)
    const r = await recomputeDailyCogsForRange({ storeId: STORE, accountId: "acct", startDate: start, endDate: end })
    expect(r.rowsChanged).toBe(6)
    expect(r.rowsDeleted).toBe(6)
    expect(bustTags).toHaveBeenCalledTimes(1)
    expect(bustTags).toHaveBeenCalledWith(["cogs", "month:2026-07"])
  })

  it("counts upserted rows that the database actually wrote as changed", async () => {
    affected = (sql) => (sql.sql.includes("INSERT") ? 1 : 0)
    const r = await recomputeDailyCogsForRange({ storeId: STORE, accountId: "acct", startDate: start, endDate: start })
    expect(r.rowsChanged).toBe(1)
    expect(r.rowsDeleted).toBe(0)
  })

  it("runs three days at a time by default", async () => {
    await recomputeDailyCogsForRange({ storeId: STORE, accountId: "acct", startDate: start, endDate: end })
    expect(maxInFlight).toBe(3)
  })

  it("still honours an explicit dayConcurrency", async () => {
    await recomputeDailyCogsForRange({ storeId: STORE, accountId: "acct", startDate: start, endDate: end, dayConcurrency: 1 })
    expect(maxInFlight).toBe(1)
  })
})
