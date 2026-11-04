/*
 * queryData builds its statement from allowlists. These pin the guarantees
 * the module note makes: the account filter is always there and bound, no
 * personal column exists, a money total is refused, names outside the
 * allowlist are rejected, and the statement runs read-only with a timeout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/chat/owner-scope", () => ({
  assertOwnerOwnsStores: vi.fn(),
  listOwnerStores: vi.fn(),
  renderStoreListForPrompt: vi.fn(),
}))

import { assertOwnerOwnsStores } from "@/lib/chat/owner-scope"
import { DATASETS, buildQuery, datasetCatalog, queryData } from "@/lib/chat/tools/query-data"
import type { ChatToolContext } from "@/lib/chat/tools/types"

const scope = { accountId: "acct-A", storeIds: null, from: null, to: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(assertOwnerOwnsStores).mockImplementation(async (_a, ids) => ids ?? ["s1"])
})

describe("buildQuery", () => {
  it("always binds the account, and counts modifiers by name", () => {
    const q = buildQuery(
      {
        dataset: "order_modifiers",
        groupBy: ["modifier"],
        aggregates: [{ fn: "count" }],
        filters: [{ column: "modifier", op: "contains", value: "onion" }],
        orderBy: [{ column: "count", dir: "desc" }],
        limit: 10,
      },
      { ...scope, storeIds: ["s1"], from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-31T00:00:00Z") },
    )
    expect(q.text).toContain(`s."accountId" = $1`)
    expect(q.values[0]).toBe("acct-A")
    expect(q.values).toContain("onion")
    expect(q.values).toContain("s1")
    expect(q.sql).toMatch(/GROUP BY m\."name"/)
    expect(q.text).toMatch(/LIMIT \$\d+$/)
    // One more than asked, to know whether the list was cut.
    expect(q.values[q.values.length - 1]).toBe(11)
    // No value is ever spliced into the text.
    expect(q.sql).not.toContain("onion")
  })

  it("refuses a sum or average of a money column", () => {
    expect(() => buildQuery({ dataset: "orders", aggregates: [{ fn: "sum", column: "total" }] }, scope)).toThrow(/refused/)
    expect(() => buildQuery({ dataset: "invoices", aggregates: [{ fn: "avg", column: "total" }] }, scope)).toThrow(/refused/)
    expect(() => buildQuery({ dataset: "orders", aggregates: [{ fn: "max", column: "total" }] }, scope)).not.toThrow()
  })

  it("rejects names outside the allowlist, including injection attempts", () => {
    expect(() => buildQuery({ dataset: "orders", columns: ["customerName"] }, scope)).toThrow(/unknown column/)
    expect(() => buildQuery({ dataset: "orders", columns: [`total" FROM "User" --`] }, scope)).toThrow(/unknown column/)
    expect(() => buildQuery({ dataset: "orders", columns: ["total"], orderBy: [{ column: "platform" }] }, scope)).toThrow(/orderBy/)
  })

  it("has no personal columns in any dataset", () => {
    const all = Object.values(DATASETS).flatMap((d) => [...Object.keys(d.columns), ...Object.values(d.columns).map((c) => c.sql)])
    for (const banned of ["customerName", "email", "phone", "pin", "deliveryAddress", "pdfBlob", "rawExtraction", "photo"]) {
      expect(all.some((x) => x.toLowerCase().includes(banned.toLowerCase())), banned).toBe(false)
    }
  })

  it("lists every dataset for describeSchema", () => {
    expect(datasetCatalog().map((d) => d.dataset)).toEqual(Object.keys(DATASETS))
  })
})

describe("queryData.execute", () => {
  function ctxWith(rows: unknown[]) {
    const tx = { $executeRawUnsafe: vi.fn(), $queryRaw: vi.fn().mockResolvedValue(rows) }
    const prisma = { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) }
    return { tx, ctx: { ownerId: "u1", accountId: "acct-A", prisma: prisma as never } as ChatToolContext }
  }

  it("runs read-only with a timeout, rounds numbers and reports truncation", async () => {
    const { tx, ctx } = ctxWith([
      { vendor: "Sysco", count: BigInt(4) },
      { vendor: "IFS", count: 2 },
    ])
    const out = await queryData.execute(
      { dataset: "invoices", groupBy: ["vendor"], aggregates: [{ fn: "count" }], limit: 1 },
      ctx,
    )
    expect(tx.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual([
      "SET TRANSACTION READ ONLY",
      "SET LOCAL statement_timeout = 5000",
    ])
    expect(out.rows).toEqual([{ vendor: "Sysco", count: 4 }])
    expect(out.truncated).toBe(true)
  })

  it("needs a date range for the order datasets and checks store ownership", async () => {
    const { ctx } = ctxWith([])
    await expect(queryData.execute({ dataset: "orders" }, ctx)).rejects.toThrow(/needs a dateRange/)
    await queryData.execute({ dataset: "ratings", storeIds: ["s9"] }, ctx)
    expect(assertOwnerOwnsStores).toHaveBeenCalledWith("acct-A", ["s9"])
  })
})
