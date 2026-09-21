// ingredients adapter — the date control that moved nothing.
//
// `/dashboard/ingredients` renders a full `DateControl` — presets, comparison,
// stepper, calendar — and `IngredientsInput` had no `range` field at all.
// Every window in `loadIngredients` was a constant derived from `today`: a
// `d30` computed as "thirty days back from now" fed the spend aggregate, the
// modifier volumes and the category spend alike. Picking a range pushed the
// URL, fired the transition, greyed the page, re-ran every query and returned
// byte-identical numbers — note 19's lie, in the version that does not even
// change the label.
//
// These tests pin the three windows that are genuinely the reader's to the
// range they are handed, and pin the two that are deliberately NOT — the
// fixed 30-day "added recently" count and the fixed 8-week price monitor — to
// their own constants, so a later change cannot quietly hand one of those to
// the control either.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn() },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { toQueryBounds, type DateRange } from "@/lib/counter/date-range"
import { getIngredientsSectionPromises } from "@/lib/counter/adapters/ingredients"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const STORE_IDS = ["store_a", "store_b"]
const ACCOUNT = "acct_ours"

/** Today, and a range that is nowhere near thirty days back from it. */
const TODAY = new Date(2026, 8, 20) // 20 Sep 2026, local midnight
const RANGE: DateRange = { start: new Date(2026, 5, 1), end: new Date(2026, 5, 7) }

/** What the old hardcoded window would have been. */
const d30 = () => {
  const d = new Date(TODAY)
  d.setDate(d.getDate() - 30)
  return d
}

type RawCall = unknown[]

async function runAdapter(range: DateRange = RANGE): Promise<RawCall[]> {
  const sections = getIngredientsSectionPromises({
    storeId: null,
    accountId: ACCOUNT,
    range,
    today: TODAY,
  })
  // Every section is mapped off one `loadIngredients`, so awaiting one runs
  // all eight queries.
  await sections.headline
  return asMock(prisma.$queryRaw).mock.calls as RawCall[]
}

const textOf = (call: RawCall) => (call[0] as TemplateStringsArray).join(" ")
const valuesOf = (call: RawCall) => call.slice(1)

const findQuery = (calls: RawCall[], needle: string): RawCall => {
  const hit = calls.find((c) => textOf(c).includes(needle))
  expect(hit, `no $queryRaw call containing ${JSON.stringify(needle)}`).toBeDefined()
  return hit!
}

const times = (call: RawCall): number[] =>
  valuesOf(call)
    .filter((v): v is Date => v instanceof Date)
    .map((v) => v.getTime())

describe("ingredients adapter · the date control drives the queries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(getScopedStores).mockResolvedValue(STORE_IDS.map((id) => ({ id })))
    asMock(prisma.$queryRaw).mockResolvedValue([])
  })

  it("hands the range's own bounds to the catalogue spend aggregate", async () => {
    const calls = await runAdapter()
    const call = findQuery(calls, "AS last_price")
    const { startDate, endDate } = toQueryBounds(RANGE)

    expect(times(call)).toContain(startDate.getTime())
    expect(times(call)).toContain(endDate.getTime())
    // The defect: a thirty-day offset from `today`, whatever the reader picked.
    expect(times(call)).not.toContain(d30().getTime())
  })

  it("hands the range's own bounds to the modifier volumes", async () => {
    const calls = await runAdapter()
    const call = findQuery(calls, "OtterOrderSubItem")
    const { startDate, endDate } = toQueryBounds(RANGE)

    expect(times(call)).toContain(startDate.getTime())
    expect(times(call)).toContain(endDate.getTime())
    expect(times(call)).not.toContain(d30().getTime())
  })

  it("hands the range's own bounds to the category spend", async () => {
    const calls = await runAdapter()
    const call = findQuery(calls, "Uncategorised")
    const { startDate, endDate } = toQueryBounds(RANGE)

    expect(times(call)).toContain(startDate.getTime())
    expect(times(call)).toContain(endDate.getTime())
    expect(times(call)).not.toContain(d30().getTime())
  })

  it("moves those bounds when the reader moves the control", async () => {
    const other: DateRange = { start: new Date(2026, 7, 1), end: new Date(2026, 7, 31) }
    const first = await runAdapter()
    const firstSpend = times(findQuery(first, "AS last_price"))

    vi.clearAllMocks()
    asMock(getScopedStores).mockResolvedValue(STORE_IDS.map((id) => ({ id })))
    asMock(prisma.$queryRaw).mockResolvedValue([])

    const second = await runAdapter(other)
    const secondSpend = times(findQuery(second, "AS last_price"))

    expect(secondSpend).toContain(toQueryBounds(other).startDate.getTime())
    expect(secondSpend).not.toEqual(firstSpend)
  })

  /*
   * The two windows that are NOT the control's, pinned so nobody "fixes" them
   * into it later.
   *
   * `recent` is the strip's "none added in 30 days" — whether the catalogue
   * pipeline has stopped — and the price monitor is eight weekly medians,
   * which needs weeks to mean anything and would be drawn from one point on
   * the default range. Both print their own window where the reader can see
   * it; neither takes the range.
   */
  it("keeps the recently-created count on a fixed thirty days", async () => {
    const calls = await runAdapter()
    const call = findQuery(calls, `FILTER (WHERE "createdAt"`)
    const { startDate } = toQueryBounds(RANGE)

    expect(times(call)).toContain(d30().getTime())
    expect(times(call)).not.toContain(startDate.getTime())
  })

  it("keeps the price monitor on a fixed eight weeks", async () => {
    const calls = await runAdapter()
    const call = findQuery(calls, "PERCENTILE_CONT")
    const { startDate, endDate } = toQueryBounds(RANGE)

    // It is anchored on `today` and a week count, not on either range bound.
    expect(textOf(call)).toContain("MAKE_INTERVAL(weeks =>")
    expect(valuesOf(call)).toContain(7) // WEEKS - 1
    expect(times(call)).toContain(TODAY.getTime())
    expect(times(call)).not.toContain(startDate.getTime())
    expect(times(call)).not.toContain(endDate.getTime())
  })

  it("still filters every catalogue query by accountId", async () => {
    const calls = await runAdapter()

    for (const needle of ["AS last_price", "Uncategorised", `FILTER (WHERE "createdAt"`]) {
      const call = findQuery(calls, needle)
      expect(textOf(call)).toContain(`"accountId" =`)
      expect(valuesOf(call)).toContain(ACCOUNT)
    }
    // The modifier volumes reach the boundary through the scoped store list.
    const mods = findQuery(calls, "OtterOrderSubItem")
    expect(
      valuesOf(mods).some((v) => Array.isArray(v) && v.includes("store_a") && v.includes("store_b")),
    ).toBe(true)
  })
})

/**
 * The note that told the reader the opposite of the table above it.
 *
 * Making `spend30` the reader's range was the fix; it also quietly broke a
 * sentence built on the old fixed window. `pantryOf` picked the groups worth
 * naming with `costed < c.items && c.spend30 > 0`, which was safe while
 * `spend30` was a trailing thirty days — some group always had spend in it.
 * It is the reader's range now, and `DEFAULT_PRESET` is `yesterday`, so on
 * any day a restaurant took no delivery every group fell out of that filter
 * and the note printed "Every group is fully costed." directly beneath a
 * table painting its uncosted counts red.
 *
 * What is uncosted is a fact about the catalogue. Only the RANKING is the
 * range's business.
 */
describe("ingredients adapter · the pantry note and the range", () => {
  const CATEGORIES = [
    { category: "Produce", items: 9, costed: 4, spend30: 0 },
    { category: "Dairy", items: 6, costed: 6, spend30: 0 },
  ]

  /**
   * The category query returns rows, and the catalogue counts return a
   * non-zero `total` so the section does not classify as empty — `isEmpty` is
   * `(d) => d.total === 0`, which would swallow the note under test.
   */
  const mockCategories = (rows: typeof CATEGORIES) => {
    asMock(prisma.$queryRaw).mockImplementation(async (...call: unknown[]) => {
      const sql = (call[0] as TemplateStringsArray).join(" ")
      if (sql.includes("Uncategorised")) return rows
      if (sql.includes("AS recent")) {
        const items = rows.reduce((t, c) => t + c.items, 0)
        return [{ total: items, recent: 0, costed: rows.reduce((t, c) => t + c.costed, 0) }]
      }
      return []
    })
  }

  const pantryNote = async (range: DateRange) => {
    const sections = getIngredientsSectionPromises({
      storeId: null,
      accountId: ACCOUNT,
      range,
      today: TODAY,
    })
    const pantry = await sections.pantry
    if (pantry.status !== "ready") throw new Error(`pantry ${pantry.status}`)
    return pantry.data.note
  }

  it("does not claim every group is costed just because nothing was bought in the range", async () => {
    mockCategories(CATEGORIES)

    // A one-day range with no invoice on it — the default preset's shape.
    const note = await pantryNote({ start: new Date(2026, 8, 19), end: new Date(2026, 8, 19) })

    expect(note).not.toContain("Every group is fully costed")
    expect(note).toContain("Produce")
    // And it says WHY there is no money beside the gap, rather than printing
    // "$0.00 of Sep 19" as though that were the size of the problem.
    expect(note).toContain("was bought in")
  })

  it("still says every group is costed when that is actually true", async () => {
    mockCategories([{ category: "Dairy", items: 6, costed: 6, spend30: 0 }])

    const note = await pantryNote({ start: new Date(2026, 8, 19), end: new Date(2026, 8, 19) })

    expect(note).toBe("Every group is fully costed.")
  })

  it("prices the gap when the range does contain the spend", async () => {
    mockCategories([{ category: "Produce", items: 9, costed: 4, spend30: 4_160 }])

    const note = await pantryNote(RANGE)

    expect(note).toContain("Produce")
    expect(note).toContain("$4,160")
    expect(note).toContain("reaches no plate")
  })
})
