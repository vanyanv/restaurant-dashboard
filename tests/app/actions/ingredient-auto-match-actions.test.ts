// ingredient-auto-match-actions — undoAutoMatch / listRecentAutoMatches.
// undoAutoMatch is the safety net the whole auto-match feature was approved
// on, so these tests pin its five ordered steps directly (see
// .superpowers/sdd/2026-07-28-ingredient-auto-match/task-10-brief.md):
// unlink only auto-* lines, un-teach the learned sku/alias, the defensive
// (currently unreachable) createdCanonical delete path, recomputeCanonicalCost,
// and status UNDONE — plus the already-UNDONE no-op and transaction
// atomicity of steps 1/2/5.
//
// The $transaction mock hands the callback a SEPARATE `txMocks` object (not
// `prisma` itself), same pattern as tests/lib/ingredient-auto-match.test.ts,
// so a test can tell an in-transaction write from an out-of-transaction one.

import { describe, it, expect, vi, beforeEach } from "vitest"

const txMocks = vi.hoisted(() => ({
  invoiceLineItem: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  ingredientSkuMatch: { deleteMany: vi.fn() },
  ingredientAlias: { deleteMany: vi.fn() },
  ingredientMatchDecision: { update: vi.fn(), delete: vi.fn() },
  recipeIngredient: { count: vi.fn() },
  stockCountLine: { count: vi.fn() },
  canonicalIngredient: { delete: vi.fn() },
  canonicalIngredientEmbedding: { deleteMany: vi.fn() },
}))

vi.mock("@/lib/auth-scope", () => ({ getAuthScope: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/ingredient-cost", () => ({ recomputeCanonicalCost: vi.fn() }))
vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    ingredientMatchDecision: { findFirst: vi.fn(), findMany: vi.fn() },
  }
  prisma.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(txMocks)
      : Promise.all(arg as Promise<unknown>[])
  )
  return { prisma }
})

import { getAuthScope } from "@/lib/auth-scope"
import { prisma } from "@/lib/prisma"
import { recomputeCanonicalCost } from "@/lib/ingredient-cost"
import {
  undoAutoMatch,
  listRecentAutoMatches,
} from "@/app/actions/ingredient-auto-match-actions"

const scope = { ownerId: "owner-1", accountId: "acct-A" }

function baseDecision(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "dec-1",
    accountId: "acct-A",
    groupKey: "sysco::name::ground beef 73/27",
    vendorName: "Sysco",
    sku: "SKU1",
    productName: "Ground Beef 73/27",
    layer: "auto-vector",
    confidence: 0.95,
    topScore: 0.95,
    margin: 0.2,
    reasoning: null,
    model: null,
    candidates: null,
    canonicalIngredientId: "canon-1",
    createdCanonical: false,
    linkedLineItemIds: ["li-1"],
    linkedLineItemCount: 1,
    status: "APPLIED",
    createdAt: new Date("2026-07-20"),
    undoneAt: null,
    undoneById: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthScope).mockResolvedValue(scope)
  vi.mocked(prisma.ingredientMatchDecision.findFirst).mockResolvedValue(
    baseDecision() as never
  )
  vi.mocked(prisma.ingredientMatchDecision.findMany).mockResolvedValue(
    [] as never
  )
  vi.mocked(recomputeCanonicalCost).mockResolvedValue({
    status: "updated",
    before: null,
    after: 3.5,
    unit: "lb",
  } as never)

  vi.mocked(txMocks.invoiceLineItem.findMany).mockResolvedValue([
    { id: "li-1", matchSource: "auto-vector", invoice: { storeId: "store-1" } },
  ] as never)
  vi.mocked(txMocks.invoiceLineItem.updateMany).mockResolvedValue({
    count: 1,
  } as never)
  vi.mocked(txMocks.invoiceLineItem.count).mockResolvedValue(0 as never)
  vi.mocked(txMocks.ingredientSkuMatch.deleteMany).mockResolvedValue({
    count: 1,
  } as never)
  vi.mocked(txMocks.ingredientAlias.deleteMany).mockResolvedValue({
    count: 1,
  } as never)
  vi.mocked(txMocks.ingredientMatchDecision.update).mockResolvedValue(
    {} as never
  )
  vi.mocked(txMocks.ingredientMatchDecision.delete).mockResolvedValue(
    {} as never
  )
  vi.mocked(txMocks.recipeIngredient.count).mockResolvedValue(0 as never)
  vi.mocked(txMocks.stockCountLine.count).mockResolvedValue(0 as never)
  vi.mocked(txMocks.canonicalIngredient.delete).mockResolvedValue(
    {} as never
  )
  vi.mocked(txMocks.canonicalIngredientEmbedding.deleteMany).mockResolvedValue(
    { count: 1 } as never
  )
})

describe("undoAutoMatch", () => {
  it("unlinks eligible lines, deletes the learned sku match, recomputes cost, and sets UNDONE — all inside the transaction except the recompute", async () => {
    const result = await undoAutoMatch("dec-1")

    expect(txMocks.invoiceLineItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["li-1"] } },
      data: { canonicalIngredientId: null, matchSource: null, matchedAt: null },
    })
    expect(txMocks.ingredientSkuMatch.deleteMany).toHaveBeenCalledWith({
      where: {
        accountId: "acct-A",
        vendorName: "Sysco",
        sku: "SKU1",
        canonicalIngredientId: "canon-1",
      },
    })
    expect(txMocks.ingredientMatchDecision.update).toHaveBeenCalledWith({
      where: { id: "dec-1" },
      data: expect.objectContaining({ status: "UNDONE", undoneById: "owner-1" }),
    })
    // recomputeCanonicalCost is NOT the tx client's — it's called on the
    // top-level module import, outside prisma.$transaction's callback.
    expect(recomputeCanonicalCost).toHaveBeenCalledWith("canon-1")

    expect(result).toEqual(
      expect.objectContaining({
        alreadyUndone: false,
        unlinkedCount: 1,
        learnedMatchRemoved: true,
        canonicalDeleted: false,
        costRecomputed: true,
      })
    )
  })

  it("deletes the learned alias instead of a sku match when the decision has no sku", async () => {
    vi.mocked(prisma.ingredientMatchDecision.findFirst).mockResolvedValue(
      baseDecision({ sku: null }) as never
    )

    await undoAutoMatch("dec-1")

    expect(txMocks.ingredientAlias.deleteMany).toHaveBeenCalledWith({
      where: {
        storeId: { in: ["store-1"] },
        rawName: "Ground Beef 73/27",
        canonicalIngredientId: "canon-1",
      },
    })
    expect(txMocks.ingredientSkuMatch.deleteMany).not.toHaveBeenCalled()
  })

  it("leaves a line alone if its matchSource is no longer auto-* (a human manually re-confirmed it since)", async () => {
    vi.mocked(prisma.ingredientMatchDecision.findFirst).mockResolvedValue(
      baseDecision({ linkedLineItemIds: ["li-1", "li-2"] }) as never
    )
    vi.mocked(txMocks.invoiceLineItem.findMany).mockResolvedValue([
      { id: "li-1", matchSource: "auto-vector", invoice: { storeId: "store-1" } },
      { id: "li-2", matchSource: "sku", invoice: { storeId: "store-1" } }, // manually reconfirmed
    ] as never)

    const result = await undoAutoMatch("dec-1")

    expect(txMocks.invoiceLineItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["li-1"] } },
      data: expect.anything(),
    })
    expect(result.unlinkedCount).toBe(1)
  })

  it("is a safe no-op on an already-UNDONE decision — no transaction, no double-unlink", async () => {
    vi.mocked(prisma.ingredientMatchDecision.findFirst).mockResolvedValue(
      baseDecision({ status: "UNDONE", undoneAt: new Date("2026-07-21") }) as never
    )

    const result = await undoAutoMatch("dec-1")

    expect(result.alreadyUndone).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(recomputeCanonicalCost).not.toHaveBeenCalled()
  })

  it("throws when the decision does not exist (or belongs to another account)", async () => {
    vi.mocked(prisma.ingredientMatchDecision.findFirst).mockResolvedValue(
      null as never
    )

    await expect(undoAutoMatch("missing")).rejects.toThrow(
      "Decision not found"
    )
  })

  it("createdCanonical defensive path: deletes the canonical + embedding + decision row when nothing else references it", async () => {
    vi.mocked(prisma.ingredientMatchDecision.findFirst).mockResolvedValue(
      baseDecision({ createdCanonical: true }) as never
    )

    const result = await undoAutoMatch("dec-1")

    expect(txMocks.ingredientMatchDecision.delete).toHaveBeenCalledWith({
      where: { id: "dec-1" },
    })
    expect(txMocks.canonicalIngredientEmbedding.deleteMany).toHaveBeenCalledWith({
      where: { canonicalIngredientId: "canon-1" },
    })
    expect(txMocks.canonicalIngredient.delete).toHaveBeenCalledWith({
      where: { id: "canon-1" },
    })
    // The row was removed, not updated — deleting the canonical below would
    // otherwise throw against its onDelete:Restrict FK.
    expect(txMocks.ingredientMatchDecision.update).not.toHaveBeenCalled()
    expect(result.canonicalDeleted).toBe(true)
    // Nothing left to recompute the cost of.
    expect(recomputeCanonicalCost).not.toHaveBeenCalled()
    expect(result.costRecomputed).toBe(false)
  })

  it("createdCanonical defensive path: keeps the canonical (unlink only) when still referenced by a recipe", async () => {
    vi.mocked(prisma.ingredientMatchDecision.findFirst).mockResolvedValue(
      baseDecision({ createdCanonical: true }) as never
    )
    vi.mocked(txMocks.recipeIngredient.count).mockResolvedValue(2 as never)

    const result = await undoAutoMatch("dec-1")

    expect(txMocks.canonicalIngredient.delete).not.toHaveBeenCalled()
    expect(txMocks.ingredientMatchDecision.delete).not.toHaveBeenCalled()
    expect(txMocks.ingredientMatchDecision.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "UNDONE" }) })
    )
    expect(result.canonicalDeleted).toBe(false)
    expect(result.canonicalKeptReason).toMatch(/recipes: 2/)
    // The canonical still exists, so the cost recompute still runs.
    expect(recomputeCanonicalCost).toHaveBeenCalledWith("canon-1")
  })

  it("an unlink of zero eligible lines still un-teaches the learned match and sets UNDONE", async () => {
    vi.mocked(txMocks.invoiceLineItem.findMany).mockResolvedValue([
      { id: "li-1", matchSource: "sku", invoice: { storeId: "store-1" } },
    ] as never)

    const result = await undoAutoMatch("dec-1")

    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
    expect(result.unlinkedCount).toBe(0)
    expect(txMocks.ingredientSkuMatch.deleteMany).toHaveBeenCalled()
    expect(txMocks.ingredientMatchDecision.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "UNDONE" }) })
    )
  })

  it("recomputeCanonicalCost failing does not roll back or throw out of the undo", async () => {
    vi.mocked(recomputeCanonicalCost).mockRejectedValue(new Error("db blip"))

    const result = await undoAutoMatch("dec-1")

    expect(result.costRecomputed).toBe(false)
    expect(result.alreadyUndone).toBe(false)
    expect(txMocks.ingredientMatchDecision.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "UNDONE" }) })
    )
  })
})

describe("listRecentAutoMatches", () => {
  it("defaults to a 7-day window and includes SHADOW rows", async () => {
    const now = new Date("2026-07-29T12:00:00Z")
    vi.setSystemTime(now)

    await listRecentAutoMatches()

    expect(prisma.ingredientMatchDecision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: "acct-A",
          createdAt: { gte: new Date("2026-07-22T12:00:00Z") },
        }),
      })
    )
    // SUGGESTED is excluded unconditionally: those rows linked nothing, so
    // listing them as activity would report work the ladder declined to do.
    // SHADOW is still included by default — during a shadow trial it is the
    // whole point of the surface.
    const call = vi.mocked(prisma.ingredientMatchDecision.findMany).mock
      .calls[0][0] as { where: Record<string, unknown> }
    expect(call.where.status).toEqual({ not: "SUGGESTED" })

    vi.useRealTimers()
  })

  it("excludes SHADOW rows only when the caller opts in", async () => {
    await listRecentAutoMatches(30, { excludeShadow: true })

    expect(prisma.ingredientMatchDecision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { notIn: ["SHADOW", "SUGGESTED"] },
        }),
      })
    )
  })

  it("maps candidates, reasoning, layer, confidence, topScore, and margin through for the undo UI", async () => {
    vi.mocked(prisma.ingredientMatchDecision.findMany).mockResolvedValue([
      {
        ...baseDecision(),
        reasoning: "closest name match, high confidence",
        candidates: [{ id: "canon-2", name: "Ground Beef 80/20", score: 0.8 }],
        canonicalIngredient: { name: "Ground Beef 73/27" },
      },
    ] as never)

    const rows = await listRecentAutoMatches()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(
      expect.objectContaining({
        layer: "auto-vector",
        confidence: 0.95,
        topScore: 0.95,
        margin: 0.2,
        reasoning: "closest name match, high confidence",
        candidates: [{ id: "canon-2", name: "Ground Beef 80/20", score: 0.8 }],
        canonicalIngredientName: "Ground Beef 73/27",
      })
    )
  })

  it("returns [] when unauthenticated, without querying prisma", async () => {
    vi.mocked(getAuthScope).mockResolvedValue(null)

    const rows = await listRecentAutoMatches()

    expect(rows).toEqual([])
    expect(prisma.ingredientMatchDecision.findMany).not.toHaveBeenCalled()
  })
})
