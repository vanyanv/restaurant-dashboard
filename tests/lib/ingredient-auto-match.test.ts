// ingredient-auto-match — the auto-match ladder orchestration. These ten
// tests are the specification of the module's safety properties (see
// .superpowers/sdd/2026-07-28-ingredient-auto-match/task-9-brief.md): no
// auto-link on a near-tie, no auto-create ever, an LLM draft only accepted
// inside its own shortlist and above LLM_ACCEPT, suppression of undone
// pairs, shadow mode performing no side-effecting write, and one decision
// per group covering every line in it.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    invoice: { findMany: vi.fn() },
    ingredientMatchDecision: { findMany: vi.fn(), create: vi.fn() },
    canonicalIngredient: { findMany: vi.fn(), create: vi.fn() },
    ingredientAlias: { findMany: vi.fn(), upsert: vi.fn() },
    ingredientSkuMatch: { upsert: vi.fn() },
    invoiceLineItem: { updateMany: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  }
  prisma.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(prisma)
      : Promise.all(arg as Promise<unknown>[])
  )
  return { prisma }
})

vi.mock("@/lib/chat/embeddings", () => ({
  embedBatch: vi.fn(),
  toVectorLiteral: vi.fn((vec: number[]) => `[${vec.join(",")}]`),
}))

vi.mock("@/lib/ingredient-match-llm", () => ({
  adjudicate: vi.fn(),
}))

vi.mock("@/lib/ingredient-cost", () => ({
  recomputeCanonicalCost: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { embedBatch } from "@/lib/chat/embeddings"
import { adjudicate } from "@/lib/ingredient-match-llm"
import { recomputeCanonicalCost } from "@/lib/ingredient-cost"
import { autoResolveUnmatchedLines } from "@/lib/ingredient-auto-match"
import { buildGroupKey } from "@/lib/ingredient-auto-match-core"
import { THRESHOLDS } from "@/lib/ingredient-match-scoring"

const SCOPE = { accountId: "acct-1", ownerId: "owner-1" }

type Candidate = { canonicalIngredientId: string; name: string; score: number }

function invoiceWith(overrides: {
  vendorName?: string
  storeId?: string | null
  lineItems: Array<{ id: string; sku?: string | null; productName: string; unit?: string | null }>
}) {
  return {
    vendorName: overrides.vendorName ?? "Sysco",
    storeId: overrides.storeId === undefined ? "store-1" : overrides.storeId,
    lineItems: overrides.lineItems.map((li) => ({
      id: li.id,
      sku: li.sku ?? null,
      productName: li.productName,
      unit: li.unit ?? "lb",
    })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ingredientMatchDecision.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ingredientMatchDecision.create).mockResolvedValue({} as never)
  vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.canonicalIngredient.create).mockResolvedValue({} as never)
  vi.mocked(prisma.ingredientAlias.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ingredientAlias.upsert).mockResolvedValue({} as never)
  vi.mocked(prisma.ingredientSkuMatch.upsert).mockResolvedValue({} as never)
  vi.mocked(prisma.invoiceLineItem.updateMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([] as never)
  vi.mocked(embedBatch).mockImplementation(
    (async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])) as never
  )
  vi.mocked(adjudicate).mockResolvedValue({ drafts: [], model: "gpt-5.4-nano" } as never)
  vi.mocked(recomputeCanonicalCost).mockResolvedValue({
    status: "unchanged",
    reason: "no-recipe-unit",
  } as never)
})

describe("autoResolveUnmatchedLines", () => {
  it("1. auto-links a group whose top vector score clears HIGH with margin >= MARGIN, matchSource auto-vector", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", sku: "SKU1", productName: "Ground Beef 73/27" }] }),
    ] as never)
    const candidates: Candidate[] = [
      { canonicalIngredientId: "canon-1", name: "Ground Beef 73/27", score: 0.95 },
      { canonicalIngredientId: "canon-2", name: "Ground Beef 80/20", score: 0.8 },
    ]
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue(candidates as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoVector).toBe(1)
    expect(result.leftForReview).toBe(0)
    expect(prisma.invoiceLineItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["li-1"] } },
        data: expect.objectContaining({ canonicalIngredientId: "canon-1", matchSource: "auto-vector" }),
      })
    )
  })

  it("2. a near-tie (margin below MARGIN) never auto-links, at any score", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Ground Beef 73/27" }] }),
    ] as never)
    // Both very high, but margin (0.005) is well under MARGIN (0.01).
    const candidates: Candidate[] = [
      { canonicalIngredientId: "canon-1", name: "Ground Beef 73/27", score: 0.99 },
      { canonicalIngredientId: "canon-2", name: "Ground Beef 80/20", score: 0.985 },
    ]
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue(candidates as never)
    vi.mocked(adjudicate).mockResolvedValue({ drafts: [], model: "gpt-5.4-nano" } as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoVector).toBe(0)
    expect(result.leftForReview).toBe(1)
    expect(prisma.invoiceLineItem.updateMany).not.toHaveBeenCalled()
  })

  it("3. every candidate below FLOOR leaves the group for review and creates no CanonicalIngredient", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Exotic Truffle Oil" }] }),
    ] as never)
    const candidates: Candidate[] = [
      { canonicalIngredientId: "canon-1", name: "Regular Oil", score: 0.3 },
      { canonicalIngredientId: "canon-2", name: "Chili Oil", score: 0.2 },
    ]
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue(candidates as never)
    vi.mocked(adjudicate).mockResolvedValue({ drafts: [], model: "gpt-5.4-nano" } as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.leftForReview).toBe(1)
    expect(prisma.canonicalIngredient.create).not.toHaveBeenCalled()
  })

  it("4. an LLM draft at confidence >= LLM_ACCEPT naming a canonical in the group's shortlist links as auto-llm", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Grnd Beef Fine 73/27" }] }),
    ] as never)
    const candidates: Candidate[] = [
      { canonicalIngredientId: "canon-1", name: "Ground Beef 73/27", score: 0.6 },
      { canonicalIngredientId: "canon-2", name: "Chuck Roll", score: 0.55 },
    ]
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue(candidates as never)
    vi.mocked(adjudicate).mockImplementation(async ({ cases }: { cases: Array<{ caseId: string; candidates: Array<{ name: string }> }> }) => ({
      drafts: cases.map((c) => ({
        caseId: c.caseId,
        matchName: c.candidates[0]?.name ?? null,
        confidence: 0.9,
        reasoning: "clear match",
      })),
      model: "gpt-5.4-nano",
    }) as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoLlm).toBe(1)
    expect(result.leftForReview).toBe(0)
    expect(prisma.invoiceLineItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ canonicalIngredientId: "canon-1", matchSource: "auto-llm" }),
      })
    )
  })

  it("5. an LLM draft naming a canonical NOT in the group's shortlist is rejected and left for review", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Grnd Beef Fine 73/27" }] }),
    ] as never)
    const candidates: Candidate[] = [
      { canonicalIngredientId: "canon-1", name: "Ground Beef 73/27", score: 0.6 },
      { canonicalIngredientId: "canon-2", name: "Chuck Roll", score: 0.55 },
    ]
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue(candidates as never)
    vi.mocked(adjudicate).mockImplementation(async ({ cases }: { cases: Array<{ caseId: string }> }) => ({
      drafts: cases.map((c) => ({
        caseId: c.caseId,
        matchName: "Frying Oil Shortening", // hallucinated / borrowed from elsewhere
        confidence: 0.95,
        reasoning: "confident but wrong list",
      })),
      model: "gpt-5.4-nano",
    }) as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoLlm).toBe(0)
    expect(result.leftForReview).toBe(1)
    expect(prisma.invoiceLineItem.updateMany).not.toHaveBeenCalled()
  })

  it("6. an LLM draft below LLM_ACCEPT is left for review", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Grnd Beef Fine 73/27" }] }),
    ] as never)
    const candidates: Candidate[] = [
      { canonicalIngredientId: "canon-1", name: "Ground Beef 73/27", score: 0.6 },
      { canonicalIngredientId: "canon-2", name: "Chuck Roll", score: 0.55 },
    ]
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue(candidates as never)
    vi.mocked(adjudicate).mockImplementation(async ({ cases }: { cases: Array<{ caseId: string; candidates: Array<{ name: string }> }> }) => ({
      drafts: cases.map((c) => ({
        caseId: c.caseId,
        matchName: c.candidates[0]?.name ?? null,
        confidence: THRESHOLDS.LLM_ACCEPT - 0.01,
        reasoning: "uncertain",
      })),
      model: "gpt-5.4-nano",
    }) as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoLlm).toBe(0)
    expect(result.leftForReview).toBe(1)
    expect(prisma.invoiceLineItem.updateMany).not.toHaveBeenCalled()
  })

  it("7. adjudicate returning [] (its failure mode) leaves every ambiguous group for review and throws nothing", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({
        lineItems: [
          { id: "li-1", productName: "Grnd Beef Fine 73/27" },
          { id: "li-2", productName: "Exotic Truffle Oil" },
        ],
      }),
    ] as never)
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { canonicalIngredientId: "canon-1", name: "Ground Beef 73/27", score: 0.6 },
    ] as never)
    vi.mocked(adjudicate).mockResolvedValue({ drafts: [], model: "gpt-5.4-nano" } as never)

    await expect(autoResolveUnmatchedLines(SCOPE, ["inv-1"])).resolves.not.toThrow()
    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoLlm).toBe(0)
    expect(result.leftForReview).toBe(2)
    expect(prisma.invoiceLineItem.updateMany).not.toHaveBeenCalled()
  })

  it("8. a (groupKey, canonicalIngredientId) pair with an UNDONE decision is never re-linked", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Kosher Salt" }] }),
    ] as never)
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "canon-1", name: "Kosher Salt" },
    ] as never)
    const groupKey = buildGroupKey("Sysco", "Kosher Salt")
    vi.mocked(prisma.ingredientMatchDecision.findMany).mockResolvedValue([
      { groupKey, canonicalIngredientId: "canon-1" },
    ] as never)
    // Falls through to L2 with an empty pantry (no embedding candidates), then
    // L3 abstains — the suppressed pair must never get linked by any layer.
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([] as never)
    vi.mocked(adjudicate).mockResolvedValue({ drafts: [], model: "gpt-5.4-nano" } as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.leftForReview).toBe(1)
    expect(prisma.invoiceLineItem.updateMany).not.toHaveBeenCalled()
    expect(prisma.ingredientMatchDecision.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ canonicalIngredientId: "canon-1" }) })
    )
  })

  it("9. mode: 'shadow' writes status SHADOW decisions and performs no line-item update, no sku/alias upsert, no cost recompute", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", sku: "SKU1", productName: "Kosher Salt" }] }),
    ] as never)
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "canon-1", name: "Kosher Salt" },
    ] as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"], { mode: "shadow" })

    expect(result.autoExact).toBe(1)
    expect(prisma.ingredientMatchDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SHADOW", canonicalIngredientId: "canon-1" }) })
    )
    expect(prisma.invoiceLineItem.updateMany).not.toHaveBeenCalled()
    expect(prisma.ingredientSkuMatch.upsert).not.toHaveBeenCalled()
    expect(prisma.ingredientAlias.upsert).not.toHaveBeenCalled()
    expect(recomputeCanonicalCost).not.toHaveBeenCalled()
  })

  it("10. one decision's linkedLineItemIds covers every line in its group", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Kosher Salt" }] }),
      invoiceWith({ lineItems: [{ id: "li-2", productName: "KOSHER SALT" }] }),
    ] as never)
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "canon-1", name: "Kosher Salt" },
    ] as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1", "inv-2"])

    expect(result.autoExact).toBe(2)
    expect(prisma.ingredientMatchDecision.create).toHaveBeenCalledTimes(1)
    expect(prisma.ingredientMatchDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          linkedLineItemIds: expect.arrayContaining(["li-1", "li-2"]),
          linkedLineItemCount: 2,
        }),
      })
    )
    expect(prisma.invoiceLineItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: expect.arrayContaining(["li-1", "li-2"]) } } })
    )
  })
})
