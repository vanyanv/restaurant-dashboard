// The auto-match write-back (2026-11-20 audit): the learned SKU is upserted on
// the account key (accountId, vendorKey, sku), the tenancy identity, and a
// SUGGESTED decision is replaced inside one transaction so a failed create
// cannot leave the group with its old suggestion deleted and no new one.

import { beforeEach, describe, expect, it, vi } from "vitest"

const tx = vi.hoisted(() => ({
  invoiceLineItem: { updateMany: vi.fn() },
  ingredientSkuMatch: { upsert: vi.fn() },
  ingredientAlias: { upsert: vi.fn() },
  ingredientMatchDecision: { create: vi.fn() },
}))
const db = vi.hoisted(() => ({
  ingredientMatchDecision: { deleteMany: vi.fn((a: unknown) => ({ op: "delete", a })), create: vi.fn((a: unknown) => ({ op: "create", a })) },
  $transaction: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("@/lib/ingredient-cost", () => ({ recomputeCanonicalCost: vi.fn(async () => ({ status: "unchanged" })) }))

import { persistResolvedGroups } from "@/lib/ingredient-auto-match-persist"
import type { LineGroup } from "@/lib/ingredient-auto-match-core"

const group: LineGroup = {
  groupKey: "sysco::name::buns",
  vendorName: "Sysco",
  productName: "Buns",
  unit: "CS",
  sku: "123",
  storeId: "s1",
  lineItemIds: ["li_1"],
}

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (t: unknown) => Promise<unknown>)(tx) : arg
  )
})

describe("persistResolvedGroups", () => {
  it("upserts the learned SKU on the account key", async () => {
    await persistResolvedGroups({
      accountId: "acct-A",
      ownerId: "owner-2",
      shadow: false,
      resolved: [{ group, canonicalIngredientId: "ci_bun", layer: "auto-exact", confidence: 1, topScore: null, margin: null, candidates: null, model: null, reasoning: null }],
    })
    expect(tx.ingredientSkuMatch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId_vendorKey_sku: { accountId: "acct-A", vendorKey: "sysco", sku: "123" } },
      })
    )
  })

  it("replaces a SUGGESTED decision in one transaction: delete then create", async () => {
    const res = await persistResolvedGroups({
      accountId: "acct-A",
      ownerId: "owner-1",
      shadow: true,
      resolved: [],
      suggestions: [{ group, canonicalIngredientId: "ci_bun", layer: "suggest-vector", score: 0.8, reasoning: null, model: null, candidates: [] }],
    })
    expect(res.suggested).toBe(1)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    const ops = db.$transaction.mock.calls[0][0] as Array<{ op: string }>
    expect(ops.map((o) => o.op)).toEqual(["delete", "create"])
  })

  it("counts no suggestion when the transaction fails", async () => {
    db.$transaction.mockRejectedValueOnce(new Error("unique violation"))
    const res = await persistResolvedGroups({
      accountId: "acct-A",
      ownerId: "owner-1",
      shadow: true,
      resolved: [],
      suggestions: [{ group, canonicalIngredientId: "ci_bun", layer: "suggest-vector", score: 0.8, reasoning: null, model: null, candidates: [] }],
    })
    expect(res.suggested).toBe(0)
  })
})
