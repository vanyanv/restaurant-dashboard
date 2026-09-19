// operations adapter — one page, one scope.
//
// The stock-count queries here scoped to `getScopedStores(accountId, storeId)`
// from the first day. The seven invoice-side queries beside them filtered on
// `accountId` alone, so picking Hollywood off the store switcher left the
// invoice spend, the review count, the unmatched-line count, the ingredient
// spend, the packaging spend and the vendor count reading account-wide —
// beside a stock-count figure that was Hollywood's. Nothing on the page said
// which number was which.
//
// The filter is deliberately NOT applied when no store is picked: `Invoice`
// carries a nullable `storeId`, so an `IN (...)` on the all-stores view would
// drop every invoice never assigned to one.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: { count: vi.fn(), aggregate: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    canonicalIngredient: { findFirst: vi.fn() },
    recipe: { count: vi.fn(), findFirst: vi.fn() },
    stockCount: { findMany: vi.fn() },
    stockCountLine: { count: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))
vi.mock("@/lib/account-stores", () => ({ getScopedStores: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { getScopedStores } from "@/lib/account-stores"
import { getOperationsSectionPromises } from "@/lib/counter/adapters/operations"

const range = { start: new Date(2026, 7, 18), end: new Date(2026, 7, 24) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getScopedStores).mockResolvedValue([{ id: "holly", name: "Hollywood" }] as never)
  vi.mocked(prisma.invoice.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.invoice.aggregate).mockResolvedValue({ _sum: { totalAmount: 0 } } as never)
  vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.canonicalIngredient.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.recipe.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.recipe.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.stockCount.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.stockCountLine.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ n: 0, spend: 0 }] as never)
})

async function load(storeId: string | null) {
  const s = getOperationsSectionPromises({
    storeId,
    accountId: "acct_1",
    range,
    today: new Date(2026, 7, 24),
  })
  await Promise.all([s.headline, s.work, s.areas])
}

/** Every `where` a Prisma invoice query was called with, this load. */
function invoiceWheres(): Array<Record<string, unknown>> {
  return [
    ...vi.mocked(prisma.invoice.count).mock.calls,
    ...vi.mocked(prisma.invoice.aggregate).mock.calls,
    ...vi.mocked(prisma.invoice.findFirst).mock.calls,
    ...vi.mocked(prisma.invoice.findMany).mock.calls,
  ].map((c) => (c[0] as { where: Record<string, unknown> }).where)
}

/**
 * The SQL text of every raw query this load ran, with its interpolated
 * fragments spliced back in — the store filter arrives as a `Prisma.sql`
 * VALUE, so it is not in the template's own strings.
 */
function rawSql(): string[] {
  const text = (v: unknown): string => {
    if (Array.isArray(v)) return v.join("?")
    if (v && typeof v === "object" && "strings" in v) {
      const frag = v as { strings: string[]; values: unknown[] }
      return frag.strings.map((str, i) => str + (i < frag.values.length ? text(frag.values[i]) : "")).join("")
    }
    return ""
  }
  return vi.mocked(prisma.$queryRaw).mock.calls.map((c) => {
    const strings = c[0] as unknown as string[]
    const values = c.slice(1)
    return strings.map((str, i) => str + (i < values.length ? text(values[i]) : "")).join("")
  })
}

describe("operations — a picked store scopes the invoice side too", () => {
  it("puts the store on every Prisma invoice query", async () => {
    await load("holly")
    const wheres = invoiceWheres()
    expect(wheres).toHaveLength(4)
    for (const w of wheres) {
      expect(w.accountId).toBe("acct_1")
      expect(w.storeId).toEqual({ in: ["holly"] })
    }
  })

  it("puts it on the raw invoice-line queries too", async () => {
    await load("holly")
    const sql = rawSql()
    expect(sql).toHaveLength(3)
    for (const text of sql) expect(text).toContain('i."storeId" IN')
  })
})

describe("operations — no store picked stays account-wide", () => {
  it("does not filter on a nullable column the all-stores view needs to keep", async () => {
    await load(null)
    for (const w of invoiceWheres()) {
      expect(w.accountId).toBe("acct_1")
      expect(w.storeId).toBeUndefined()
    }
    for (const text of rawSql()) expect(text).not.toContain('i."storeId" IN')
  })
})
