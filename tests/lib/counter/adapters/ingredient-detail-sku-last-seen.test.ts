// ingredient detail — "last seen" on the matched-SKU table.
//
// The table lists every product code this ingredient has been bought under and
// said nothing about WHEN. A SKU last billed fourteen months ago sat in the
// list looking exactly like one on this week's invoice, which is the one thing
// a reader needs from that table before they trust the conversion or the price
// beside it. `MAX("Invoice"."invoiceDate")` per (vendor, SKU) answers it.
//
// The fold matters here in a way it does not on the other columns: the SQL
// groups on the RAW vendor name, so `Premier Meats` and
// `Premier Meats & Crystal Bay` arrive as two rows for one supplier and one
// part number. `foldSkus` already adds their line counts; the date has to take
// the LATER of the two, or folding a stale spelling into a current one would
// age the row it just merged into.

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
  type IngredientSkus,
} from "@/lib/counter/adapters/ingredient"
import type { CellObject } from "@/components/counter"

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const TODAY = new Date("2026-09-20T12:00:00Z")

/** The (vendor, SKU) fold query, told apart from the adapter's other raws. */
const isSkuLines = (strings: TemplateStringsArray) => strings.join(" ").includes("productName")

const line = (over: Partial<Record<string, unknown>> = {}) => ({
  vendor: "Sysco Los Angeles, Inc.",
  sku: "9921847",
  product: "GROUND BEEF 73/27",
  n: 4,
  pack: 1,
  unit_size: 40,
  uom: "LB",
  last_px: 4.39,
  line_unit: "CS",
  last_seen: new Date("2026-09-10T00:00:00Z"),
  ...over,
})

function mockLines(rows: unknown[]) {
  asMock(prisma.$queryRaw).mockImplementation((strings: TemplateStringsArray) =>
    Promise.resolve(isSkuLines(strings) ? rows : []),
  )
}

async function skusSection(): Promise<IngredientSkus> {
  const sections = getIngredientSectionPromises({
    ingredientId: "ci_ours",
    storeId: null,
    accountId: "acct_ours",
    range: { start: new Date("2026-08-21T00:00:00Z"), end: TODAY },
    today: TODAY,
  })
  const section = await sections.skus
  if (section.status !== "ready") {
    throw new Error(`skus section was ${section.status}, not ready`)
  }
  return section.data
}

const cellText = (cell: unknown): string =>
  typeof cell === "string" ? cell : String((cell as CellObject).v)

describe("ingredient detail · matched SKUs, last seen", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asMock(prisma.canonicalIngredient.findFirst).mockResolvedValue({
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
    })
    asMock(prisma.ingredientSkuMatch.findMany).mockResolvedValue([])
    asMock(prisma.recipeIngredient.findMany).mockResolvedValue([])
    asMock(prisma.stockCountLine.count).mockResolvedValue(0)
    asMock(getScopedStores).mockResolvedValue([])
    asMock(batchRecipeCosts).mockResolvedValue(new Map())
    mockLines([line()])
  })

  it("asks the database for the newest invoice date per (vendor, SKU)", async () => {
    await skusSection()

    const call = asMock(prisma.$queryRaw).mock.calls.find((c) =>
      isSkuLines(c[0] as TemplateStringsArray),
    )
    expect(call).toBeDefined()
    expect((call![0] as TemplateStringsArray).join(" ")).toContain('MAX(i."invoiceDate")')
  })

  it("prints the date a current SKU was last billed, unmarked", async () => {
    const s = await skusSection()

    expect(cellText(s.rows[0].cells.seen)).toBe("Sep 10")
    expect(typeof s.rows[0].cells.seen).toBe("string")
  })

  it("marks a SKU nobody has bought in six months", async () => {
    mockLines([line({ last_seen: new Date("2025-07-01T00:00:00Z") })])

    const s = await skusSection()

    expect(cellText(s.rows[0].cells.seen)).toBe("Jul 1, 2025")
    expect((s.rows[0].cells.seen as CellObject).cls).toBe("hot")
    expect(s.note).toContain("1 of these")
    expect(s.note.toLowerCase()).toContain("six months")
  })

  it("takes the LATER date when two vendor spellings fold into one row", async () => {
    mockLines([
      line({
        vendor: "Premier Meats & Crystal Bay",
        sku: "0014046-01",
        n: 3,
        last_seen: new Date("2025-07-01T00:00:00Z"),
      }),
      line({
        vendor: "Premier Meats",
        sku: "0014046-01",
        n: 2,
        last_seen: new Date("2026-09-12T00:00:00Z"),
      }),
    ])

    const s = await skusSection()

    expect(s.rows).toHaveLength(1)
    expect(cellText(s.rows[0].cells.lines)).toBe("5")
    // The merged row is current, because one of its two spellings is.
    expect(cellText(s.rows[0].cells.seen)).toBe("Sep 12")
    expect(typeof s.rows[0].cells.seen).toBe("string")
  })

  it("shows an em dash when no line under that SKU carries a date", async () => {
    mockLines([line({ last_seen: null })])

    const s = await skusSection()

    expect(cellText(s.rows[0].cells.seen)).toBe("—")
    // Undated is not the same finding as stale, so it is not counted as one.
    expect(s.note).not.toContain("six months")
  })
})
