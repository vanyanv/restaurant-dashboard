// new-count adapter — the start-a-count page's account boundary.
//
// `loadNewCount` read `CanonicalIngredient` with no `where`, `StockCount` with
// no `where`, and grouped `StockCountLine` in raw SQL with no join to the
// account. `NewCountInput.storeId` narrowed the OPEN list in JS afterwards,
// which is why the leak was invisible: the open-count list looked right while
// `totalLines`, `everCounted`, `startedCounts`, `completedCounts` and
// `lastActivity` were all computed over every account in the database.
//
// `StockCount` reaches the boundary through its store (`store.accountId`);
// `CanonicalIngredient` carries `accountId` directly.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: { findMany: vi.fn() },
    stockCount: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from "@/lib/prisma"
import { getNewCountSections } from "@/lib/counter/adapters/new-count"
import { hasData } from "@/lib/counter/section-data"

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const OURS = "acct_ours"
const THEIRS = "acct_theirs"
const OUR_STORE = "store_ours"

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)

const CANONICALS = [
  {
    id: "ci_flour",
    accountId: OURS,
    name: "our flour",
    category: "Dry Goods",
    recipeUnit: "lb",
    _count: { recipeIngredients: 1 },
  },
  {
    id: "ci_salt",
    accountId: OURS,
    name: "our salt",
    category: "Dry Goods",
    recipeUnit: "lb",
    _count: { recipeIngredients: 1 },
  },
  {
    id: "ci_truffle",
    accountId: THEIRS,
    name: "rival truffle",
    category: "Produce",
    recipeUnit: "lb",
    _count: { recipeIngredients: 3 },
  },
]

const COUNTS = [
  {
    id: "sc_ours",
    accountId: OURS,
    storeId: OUR_STORE,
    status: "IN_PROGRESS",
    startedAt: daysAgo(5),
    completedAt: null,
    store: { name: "Hollywood" },
    _count: { lines: 0 },
  },
  {
    id: "sc_theirs_1",
    accountId: THEIRS,
    storeId: "store_theirs",
    status: "IN_PROGRESS",
    startedAt: daysAgo(2),
    completedAt: null,
    store: { name: "Rival Kitchen" },
    _count: { lines: 4 },
  },
  {
    id: "sc_theirs_2",
    accountId: THEIRS,
    storeId: "store_theirs",
    status: "COMPLETED",
    startedAt: daysAgo(1),
    completedAt: daysAgo(1),
    store: { name: "Rival Kitchen" },
    _count: { lines: 9 },
  },
]

/** One counted line per account, so "ever counted" is scoped too. */
const LAST_LINES = [
  { accountId: OURS, canonicalIngredientId: "ci_flour", lastAt: daysAgo(30) },
  { accountId: THEIRS, canonicalIngredientId: "ci_truffle", lastAt: daysAgo(3) },
]

const input = { storeId: null, targetStoreId: OUR_STORE }

beforeEach(() => {
  vi.mocked(prisma.canonicalIngredient.findMany).mockImplementation((async (args: {
    where?: { accountId?: string }
  }) => {
    const want = args?.where?.accountId
    return CANONICALS.filter((c) => want === undefined || c.accountId === want)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any)

  vi.mocked(prisma.stockCount.findMany).mockImplementation((async (args: {
    where?: { store?: { accountId?: string } }
  }) => {
    const want = args?.where?.store?.accountId
    return COUNTS.filter((c) => want === undefined || c.accountId === want)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any)

  // The raw GROUP BY has to reach the account through StockCount → Store. The
  // fake stands in for that join: the account id arriving as a bound parameter
  // is what proves the SQL carries the filter at all.
  vi.mocked(prisma.$queryRaw).mockImplementation(((
    _strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const want = values.find((v) => typeof v === "string" && v.startsWith("acct_"))
    return Promise.resolve(
      LAST_LINES.filter((l) => want === undefined || l.accountId === want)
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any)
})

/* ── Tests ────────────────────────────────────────────────────────────── */

describe("new-count adapter · account scoping", () => {
  it("counts only our own catalogue on the sheet", async () => {
    const s = await getNewCountSections({ ...input, accountId: OURS })
    if (!hasData(s.sheet)) throw new Error("sheet did not load")

    expect(s.sheet.data.meta).toContain("of 2")
    expect(s.sheet.data.rows).toHaveLength(2)
  })

  it("counts only our own sessions in the started/finished sentence", async () => {
    const s = await getNewCountSections({ ...input, accountId: OURS })
    if (!hasData(s.open)) throw new Error("open did not load")

    // One session, ours, still open — not the three rows in the table.
    expect(s.open.data.note).toContain("1 count has been started here and none finished")
  })

  it("never renders another account's ingredient or store", async () => {
    const s = await getNewCountSections({ ...input, accountId: OURS })
    const rendered = JSON.stringify(s)

    expect(rendered).not.toContain("rival truffle")
    expect(rendered).not.toContain("Rival Kitchen")
  })

  it("does not credit our ingredients with another account's count history", async () => {
    const s = await getNewCountSections({ ...input, accountId: OURS })
    if (!hasData(s.groups)) throw new Error("groups did not load")

    // Both of ours are Dry Goods, so that is the only group. The other
    // account's "Produce" must not appear as a category we are asked to count.
    expect(s.groups.data.groups).toHaveLength(1)

    // `ci_flour` was counted; `ci_salt` never was.
    expect(s.groups.data.groups[0]).toMatchObject({
      category: "Dry Goods",
      lines: 2,
      everCounted: 1,
    })
  })
})
