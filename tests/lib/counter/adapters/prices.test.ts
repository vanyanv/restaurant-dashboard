// prices adapter — the price monitor's account boundary.
//
// `loadPrices` read `CanonicalIngredient` with no `where` at all and
// `InvoiceLineItem` filtered only by date, so every account's catalogue and
// every account's invoice lines ranked together in one movers table. Both
// models carry `accountId` (`@@index([accountId])`), and every sibling adapter
// scopes by it — `ingredients.ts` does it on all nine of its queries.
//
// The fake below filters its fixtures the way Postgres would: pass no
// `accountId` and you get both accounts back, which is exactly what the page
// used to render.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findMany: vi.fn() },
    invoiceLineItem: { findMany: vi.fn() },
  },
}))

import { prisma } from "@/lib/prisma"
import { getPriceSections } from "@/lib/counter/adapters/prices"
import { hasData } from "@/lib/counter/section-data"

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const OURS = "acct_ours"
const THEIRS = "acct_theirs"

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)

const CANONICALS = [
  {
    id: "ci_tomato",
    accountId: OURS,
    name: "house tomato",
    recipeUnit: "lb",
    _count: { recipeIngredients: 2 },
  },
  {
    id: "ci_truffle",
    accountId: THEIRS,
    name: "rival truffle",
    recipeUnit: "lb",
    _count: { recipeIngredients: 5 },
  },
]

/**
 * `unit` and `unitSizeUom` are the same UOM, so `getLineItemBaseQty` takes the
 * already-in-base shape and the derived cost is just `extendedPrice / quantity`
 * per lb. That keeps the fixture about scoping rather than about unit maths.
 */
function line(
  accountId: string,
  canonicalIngredientId: string,
  at: Date,
  quantity: number,
  extendedPrice: number
) {
  return {
    accountId,
    canonicalIngredientId,
    sku: `sku_${canonicalIngredientId}`,
    productName: canonicalIngredientId,
    quantity,
    unit: "lb",
    packSize: 1,
    unitSize: 1,
    unitSizeUom: "lb",
    unitPrice: extendedPrice / quantity,
    extendedPrice,
    invoice: { invoiceDate: at },
  }
}

// Ours moves $1.00 → $1.20 on 10 lb of volume: $2 of cost.
// Theirs moves $10.00 → $12.00 on 100 lb: $200 of cost — so if the account
// boundary is not applied, THEIRS outranks OURS and is what the page names.
const LINES = [
  line(OURS, "ci_tomato", daysAgo(60), 10, 10),
  line(OURS, "ci_tomato", daysAgo(40), 10, 10),
  line(OURS, "ci_tomato", daysAgo(10), 10, 12),
  line(THEIRS, "ci_truffle", daysAgo(60), 100, 1000),
  line(THEIRS, "ci_truffle", daysAgo(40), 100, 1000),
  line(THEIRS, "ci_truffle", daysAgo(10), 100, 1200),
]

beforeEach(() => {
  vi.mocked(prisma.canonicalIngredient.findMany).mockImplementation((async (args: {
    where?: { accountId?: string }
  }) => {
    const want = args?.where?.accountId
    return CANONICALS.filter((c) => want === undefined || c.accountId === want)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any)

  vi.mocked(prisma.invoiceLineItem.findMany).mockImplementation((async (args: {
    where?: { invoice?: { accountId?: string; invoiceDate?: { gte?: Date } } }
  }) => {
    const want = args?.where?.invoice?.accountId
    const since = args?.where?.invoice?.invoiceDate?.gte
    return LINES.filter(
      (l) =>
        (want === undefined || l.accountId === want) &&
        (since === undefined || l.invoice.invoiceDate >= since)
    ).sort((a, b) => a.invoice.invoiceDate.getTime() - b.invoice.invoiceDate.getTime())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any)
})

/* ── Tests ────────────────────────────────────────────────────────────── */

describe("prices adapter · account scoping", () => {
  it("names our own worst mover, not a larger one from another account", async () => {
    const s = await getPriceSections(OURS)
    if (!hasData(s.headline)) throw new Error("headline did not load")

    const worst = s.headline.data.cells.find((c) => c.label === "Costs you most")
    expect(worst?.delta).toContain("house tomato")
  })

  it("never renders another account's ingredient anywhere on the page", async () => {
    const s = await getPriceSections(OURS)
    expect(JSON.stringify(s)).not.toContain("rival truffle")
  })

  it("counts only our own catalogue in the movers total", async () => {
    const s = await getPriceSections(OURS)
    if (!hasData(s.headline)) throw new Error("headline did not load")

    const packVaries = s.headline.data.cells.find((c) => c.label === "Pack shape varies")
    expect(packVaries?.delta).toContain("of 1")
  })

  it("scopes the other account's page to that account", async () => {
    const s = await getPriceSections(THEIRS)
    expect(JSON.stringify(s)).not.toContain("house tomato")
  })
})
