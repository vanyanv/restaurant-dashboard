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
