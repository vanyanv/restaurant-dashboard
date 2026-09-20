// ingredient detail — the delivery history the page never drew.
//
// `InvoiceLineItem` joined to `Invoice` has carried every arrival of this
// ingredient all along — the date, the vendor, the quantity and what it cost —
// and the detail page showed none of it. An owner asking "am I about to run
// out" had a price chart and a SKU list and no answer.
//
// The three things these tests hold, because each is a way the section could
// be wrong rather than absent:
//
//   1. It is scoped by `accountId`, like every other query in this adapter.
//   2. A delivered quantity that will not convert to the recipe unit is
//      DROPPED by `sumDeliveries` (see `convertDelivered`'s docblock in
//      `@/lib/inventory/usage-math` — the pack columns are populated on 61 of
//      76 ingredients), so the total under the table understates by an unknown
//      amount and the note has to say so rather than print a bare figure.
//   3. An ingredient with no `recipeUnit` at all converts NOTHING, so the
//      section must claim no total rather than print the zero the arithmetic
//      produces.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findFirst: vi.fn() },
    ingredientSkuMatch: { findMany: vi.fn() },
    recipeIngredient: { findMany: vi.fn() },
    stockCountLine: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))
vi.mock("@/lib/recipe-cost", () => ({ batchRecipeCosts: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { batchRecipeCosts } from "@/lib/recipe-cost"
import {
  getIngredientSectionPromises,
  type IngredientDeliveries,
} from "@/lib/counter/adapters/ingredient"
import type { CellObject } from "@/components/counter"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const TODAY = new Date("2026-09-20T12:00:00Z")

/** The adapter's raw queries, told apart by their own text. */
const isDeliveries = (strings: TemplateStringsArray) => strings.join(" ").includes("AS ext")

const DELIVERY_ROWS = [
  {
    id: "li_recent",
    d: new Date("2026-09-10T00:00:00Z"),
    vendor: "Sysco Los Angeles, Inc.",
    qty: 2,
    unit: "CS",
    ext: 200,
  },
  {
    id: "li_older",
    d: new Date("2026-09-01T00:00:00Z"),
    vendor: "Premier Meats",
    qty: 3,
    unit: "BAG",
    ext: 90,
  },
]

function mockQueries(deliveries = DELIVERY_ROWS) {
  asMock(prisma.$queryRaw).mockImplementation((strings: TemplateStringsArray) =>
    Promise.resolve(isDeliveries(strings) ? deliveries : []),
  )
}

const INGREDIENT = {
  id: "ci_ours",
  name: "ground beef 73/27",
  recipeUnit: "lb",
  category: "Meat",
  costPerRecipeUnit: 4.39,
  costSource: "invoice",
  costLocked: false,
  caseUnit: "CS",
  recipeUnitsPerCase: 40,
  innerPackUnit: null,
  innerPacksPerCase: null,
}

async function deliveriesSection(): Promise<IngredientDeliveries> {
  const sections = getIngredientSectionPromises({
    ingredientId: "ci_ours",
    storeId: null,
    accountId: "acct_ours",
    range: { start: new Date("2026-08-21T00:00:00Z"), end: TODAY },
    today: TODAY,
  })
  const section = await sections.deliveries
  if (section.status !== "ready") {
    throw new Error(`deliveries section was ${section.status}, not ready`)
  }
  return section.data
}

const cellText = (cell: unknown): string =>
  typeof cell === "string" ? cell : String((cell as CellObject).v)

describe("ingredient detail · deliveries", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(prisma.canonicalIngredient.findFirst).mockResolvedValue(INGREDIENT)
    asMock(prisma.ingredientSkuMatch.findMany).mockResolvedValue([])
    asMock(prisma.recipeIngredient.findMany).mockResolvedValue([])
    asMock(prisma.stockCountLine.count).mockResolvedValue(0)
    asMock(getScopedStores).mockResolvedValue([])
    asMock(batchRecipeCosts).mockResolvedValue(new Map())
    mockQueries()
  })

  it("scopes the delivery query to our own account", async () => {
    await deliveriesSection()

    const call = asMock(prisma.$queryRaw).mock.calls.find((c) =>
      isDeliveries(c[0] as TemplateStringsArray),
    )
    expect(call).toBeDefined()
    expect(call!.slice(1)).toContain("acct_ours")
    // And by the ingredient, not by every line on the account.
    expect(call!.slice(1)).toContain("ci_ours")
  })

  it("lists each delivery newest first, with the vendor name folded", async () => {
    const d = await deliveriesSection()

    expect(d.rows).toHaveLength(2)
    expect(d.rows[0].key).toBe("li_recent")
    expect(cellText(d.rows[0].cells.date)).toBe("Sep 10")
    // `normalizeVendorName`, the same fold the SKU table above it uses.
    expect(cellText(d.rows[0].cells.vendor)).toBe("Sysco")
    expect(cellText(d.rows[1].cells.vendor)).toBe("Premier Meats & Crystal Bay")
    expect(cellText(d.rows[0].cells.qty)).toBe("2 cs")
    expect(cellText(d.rows[0].cells.value)).toBe("$200")
  })

  it("converts a case quantity through the pack and marks one that will not convert", async () => {
    const d = await deliveriesSection()

    // 2 CS × 40 lb per case, via `convertDelivered`.
    expect(cellText(d.rows[0].cells.recipeQty)).toBe("80 lb")
    // BAG is neither the case unit nor dimensionally convertible to lb.
    expect(cellText(d.rows[1].cells.recipeQty)).toBe("—")
    expect((d.rows[1].cells.recipeQty as CellObject).cls).toBe("hot")
  })

  it("says how many lines the total leaves out rather than printing it bare", async () => {
    const d = await deliveriesSection()

    expect(d.note).toContain("80 lb")
    // The one dropped line, named as a count and as an understatement.
    expect(d.note).toContain("1 of these 2")
    expect(d.note.toLowerCase()).toContain("understate")
  })

  it("claims no total at all when the ingredient has no recipe unit", async () => {
    asMock(prisma.canonicalIngredient.findFirst).mockResolvedValue({
      ...INGREDIENT,
      recipeUnit: null,
    })

    const d = await deliveriesSection()

    expect(d.unit).toBeNull()
    // No quantity is claimed — not "0", which would read as a measurement.
    expect(d.note).not.toMatch(/\b0 \b/)
    expect(d.note.toLowerCase()).toContain("no recipe unit")
    expect(cellText(d.rows[0].cells.recipeQty)).toBe("—")
  })

  it("claims no total when NOTHING on the list converts, rather than printing zero", async () => {
    mockQueries([
      { ...DELIVERY_ROWS[0], unit: "BAG" },
      { ...DELIVERY_ROWS[1], unit: "BAG" },
    ])

    const d = await deliveriesSection()

    expect(d.note).not.toContain("0 lb")
    expect(d.note).not.toContain("in total")
    expect(d.note).toContain("None of them is billed in a unit that converts to lb")
  })

  it("names a negative quantity as a credit rather than folding it in silently", async () => {
    mockQueries([DELIVERY_ROWS[0], { ...DELIVERY_ROWS[1], unit: "CS", qty: -1 }])

    const d = await deliveriesSection()

    // 2 CS in, 1 CS back, at 40 lb a case.
    expect(d.note).toContain("40 lb in total")
    expect(d.note).toContain("a credit, not an arrival")
  })

  it("puts an em dash, not a dollar value, in a phone row that would not convert", async () => {
    const d = await deliveriesSection()

    expect(d.phoneRows).toHaveLength(2)
    expect(d.phoneRows[0].value).toBe("80 lb")
    expect(d.phoneRows[0].detail).toBe("Sysco · 2 cs")
    // Not "$90" — a column that is a quantity on one row and a price on the
    // next is not a column.
    expect(d.phoneRows[1].value).toBe("—")
  })

  it("counts the days since the last delivery in its meta", async () => {
    const d = await deliveriesSection()

    // 2026-09-10 to 2026-09-20.
    expect(d.meta).toContain("10 days")
  })

  it("says so plainly when nothing has ever been delivered", async () => {
    mockQueries([])

    const d = await deliveriesSection()

    expect(d.rows).toHaveLength(0)
    expect(d.phoneRows).toHaveLength(0)
    expect(d.meta).toBe("never delivered")
    // "dated" is load-bearing: the query filters `invoiceDate IS NOT NULL`,
    // so an undated matched line exists and is not on this list.
    expect(d.note.toLowerCase()).toContain("no dated invoice line")
  })
})
