// menu-item adapter — what the marketplaces actually took.
//
// Three cells on this page were stubbed and never finished, and each of them
// was wrong in the SAME branch: the one where commission data exists.
//
//   Kept        `d.feesRecorded ? money(d.revenue) : "—"`
//   Commission  `d.feesRecorded ? money(0) : FEES_ABSENT`
//   Net each    `d.feesRecorded ? money(price, { cents: true }) : FEES_ABSENT`
//
// So with fees on file the page printed Kept = Charged, Commission = $0.00 and
// Net each = the full gross price — the page asserting in dollars that Uber
// and DoorDash took nothing from this item. The comment directly above the
// "Kept" line forbade the exact expression the line used.
//
// `ItemData` had no per-item commission to print instead, so the fix is a
// figure, not a branch: the marketplace's cut at the store's CONTRACT rate,
// which is the same rule `computeStorePnL` charges the COM_UBER and COM_DD
// lines at. One rule for "what does this marketplace take", so an item's fee
// and the range's fee cannot disagree.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    otterMenuItem: { findMany: vi.fn() },
    dailyCogsItem: { aggregate: vi.fn() },
    otterItemMapping: { findFirst: vi.fn() },
    otterOrder: { count: vi.fn() },
    otterSubItemMapping: { findMany: vi.fn() },
    recipe: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { getMenuItemSectionPromises } from "@/lib/counter/adapters/menu-item"
import { hasData } from "@/lib/counter/section-data"

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const range = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 19) }

/** The schema's own defaults: 21% on Uber, 25% on DoorDash. */
const HOLLY = { id: "holly", name: "Hollywood", uberCommissionRate: 0.21, doordashCommissionRate: 0.25 }
/** A second store on a different contract — the reason the query groups by store. */
const GLENDALE = { id: "gln", name: "Glendale", uberCommissionRate: 0.3, doordashCommissionRate: 0.25 }

/**
 * `$queryRaw` is called four times in one `Promise.all`, in a fixed order:
 * channel rows, modifier rows, the name spread, and nothing else raw. This
 * answers them positionally.
 */
function rawAnswers(channelRows: unknown[]) {
  const answers = [channelRows, [], [{ name: "Smash Burger", house: true, market: true }]]
  let i = 0
  vi.mocked(prisma.$queryRaw).mockImplementation((() => {
    const next = answers[i] ?? []
    i += 1
    return Promise.resolve(next)
  }) as never)
}

function setup(channelRows: unknown[], stores = [HOLLY]) {
  vi.mocked(getScopedStores).mockResolvedValue(stores as never)
  vi.mocked(prisma.otterMenuItem.findMany).mockResolvedValue([
    {
      itemName: "Smash Burger",
      category: "Burgers",
      date: new Date(Date.UTC(2026, 7, 18)),
      fpQuantitySold: 40,
      tpQuantitySold: 60,
      fpTotalSales: 400,
      tpTotalSales: 600,
    },
  ] as never)
  vi.mocked(prisma.dailyCogsItem.aggregate).mockResolvedValue({
    _sum: { lineCost: 300, salesRevenue: 1000, qtySold: 100 },
  } as never)
  vi.mocked(prisma.otterItemMapping.findFirst).mockResolvedValue({ recipeId: "r1" } as never)
  vi.mocked(prisma.otterOrder.count).mockResolvedValue(12 as never)
  vi.mocked(prisma.recipe.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.otterSubItemMapping.findMany).mockResolvedValue([] as never)
  rawAnswers(channelRows)
}

async function load() {
  const s = getMenuItemSectionPromises({
    slug: "smash-burger",
    range,
    storeId: null,
    accountId: "acct_1",
  })
  return {
    headline: await s.headline,
    channels: await s.channels,
  }
}

const cell = (headline: Awaited<ReturnType<typeof load>>["headline"], label: string) => {
  if (!hasData(headline)) throw new Error("headline")
  return headline.data.cells.find((c) => c.label === label)
}

const row = (channels: Awaited<ReturnType<typeof load>>["channels"], key: string) => {
  if (!hasData(channels)) throw new Error("channels")
  return channels.data.rows.find((r) => r.key === key)
}

beforeEach(() => {
  vi.clearAllMocks()
})

/* ── The cut ──────────────────────────────────────────────────────────── */

describe("menu item — the marketplace's cut", () => {
  it("charges each channel at the store's own rate, never $0", async () => {
    setup([
      { storeId: "holly", platform: "ubereats", qty: 40, revenue: 1000 },
      { storeId: "holly", platform: "doordash", qty: 20, revenue: 400 },
    ])
    const { channels } = await load()
    // 21% of $1,000, and 25% of $400.
    expect(row(channels, "ubereats")?.commission).toBe("$210")
    expect(row(channels, "doordash")?.commission).toBe("$100")
  })

  it("nets each unit of what its own channel took", async () => {
    setup([{ storeId: "holly", platform: "ubereats", qty: 40, revenue: 1000 }])
    const { channels } = await load()
    // $1,000 less 21%, over 40 units — not the $25.00 gross price.
    expect(row(channels, "ubereats")?.price).toBe("$25.00")
    expect(row(channels, "ubereats")?.netEach).toBe("$19.75")
  })

  it("prices the house channel at nothing, because nothing is what it costs", async () => {
    setup([{ storeId: "holly", platform: "css-pos", qty: 10, revenue: 250 }])
    const { channels } = await load()
    expect(row(channels, "house")?.commission).toBe("$0")
    expect(row(channels, "house")?.netEach).toBe("$25.00")
  })

  it("says so rather than inventing a rate the account does not hold", async () => {
    setup([{ storeId: "holly", platform: "grubhub", qty: 10, revenue: 300 }])
    const { channels } = await load()
    // Grubhub has no rate column. A fee we cannot price is not a fee of zero.
    expect(row(channels, "grubhub")?.commission).toBe("no rate on file")
    expect(row(channels, "grubhub")?.netEach).toBe("no rate on file")
  })

  it("uses each store's own contract when two stores sell the same item", async () => {
    setup(
      [
        { storeId: "holly", platform: "ubereats", qty: 40, revenue: 1000 },
        { storeId: "gln", platform: "ubereats", qty: 40, revenue: 1000 },
      ],
      [HOLLY, GLENDALE],
    )
    const { channels } = await load()
    // 21% of Hollywood's $1,000 plus 30% of Glendale's — $510, not $420 and
    // not $600. Folding the platform before applying a rate would have priced
    // the whole $2,000 at whichever store came first.
    expect(row(channels, "ubereats")?.commission).toBe("$510")
  })
})

/* ── Kept ─────────────────────────────────────────────────────────────── */

describe("menu item — Kept", () => {
  it("is Charged less what the marketplaces took", async () => {
    setup([
      { storeId: "holly", platform: "css-pos", qty: 40, revenue: 400 },
      { storeId: "holly", platform: "ubereats", qty: 60, revenue: 600 },
    ])
    const { headline } = await load()
    expect(cell(headline, "Charged")?.value).toBe("$1,000")
    // $1,000 less 21% of the $600 that came through Uber.
    expect(cell(headline, "Kept")?.value).toBe("$874")
    expect(cell(headline, "Kept")?.delta).toBe("after commission")
  })

  it("withholds itself when any channel the item sold on has no rate", async () => {
    setup([
      { storeId: "holly", platform: "ubereats", qty: 60, revenue: 600 },
      { storeId: "holly", platform: "grubhub", qty: 40, revenue: 400 },
    ])
    const { headline } = await load()
    // Subtracting only Uber's cut would read as a bigger figure kept, which is
    // wrong in the flattering direction — the one a menu gets priced off.
    expect(cell(headline, "Kept")?.value).toBe("—")
    expect(cell(headline, "Kept")?.delta).toBe("no rate on file")
  })

  it("never equals Charged while a marketplace is in the mix", async () => {
    setup([{ storeId: "holly", platform: "doordash", qty: 40, revenue: 1000 }])
    const { headline } = await load()
    const charged = cell(headline, "Charged")?.value
    const kept = cell(headline, "Kept")?.value
    expect(kept).not.toBe(charged)
    expect(kept).toBe("$750")
  })

  it("withholds itself when the order feed has no row for this name at all", async () => {
    // The same false claim by a different route, and the one the rate guard
    // above lets through: `some` is false on an empty list and the sum of
    // nothing is 0, so Kept came out equal to Charged under the words "after
    // commission". `revenue` comes from the POS daily rollup matched by slug
    // while `byChannel` comes from the ORDER feed matched on the exact name,
    // and this file's own note exists because the two are known to disagree.
    setup([])
    const { headline } = await load()
    expect(cell(headline, "Charged")?.value).not.toBe("—")
    expect(cell(headline, "Kept")?.value).toBe("—")
    expect(cell(headline, "Kept")?.delta).toBe("no channel data")
    expect(cell(headline, "Kept")?.delta).not.toBe("after commission")
  })
})
