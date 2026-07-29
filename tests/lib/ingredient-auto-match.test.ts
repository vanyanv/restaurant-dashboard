// ingredient-auto-match — the auto-match ladder orchestration. These tests
// are the specification of the module's safety properties (see
// .superpowers/sdd/2026-07-28-ingredient-auto-match/task-9-brief.md, plus
// fix-round-1 review): no auto-link on a near-tie, no auto-create ever
// (globally enforced below, not just in one test), an LLM draft only
// accepted inside its own shortlist and above LLM_ACCEPT (NaN-safe),
// suppression enforced independently at L1/L2/L3, cross-store alias/
// canonical-name collisions treated as ambiguous rather than picked, shadow
// mode performing no side-effecting write, and one decision per group
// covering every line in it.
//
// The $transaction mock hands the callback a SEPARATE `txMocks` object
// (not `prisma` itself) so a test can tell an in-transaction write from an
// out-of-transaction one — e.g. moving the decision `create` outside the
// transaction would show up as a call to `prisma.ingredientMatchDecision
// .create` instead of `txMocks.ingredientMatchDecision.create`, and fail
// the assertions below.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const txMocks = vi.hoisted(() => ({
  invoiceLineItem: { updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  ingredientSkuMatch: { upsert: vi.fn(), deleteMany: vi.fn() },
  ingredientAlias: { upsert: vi.fn(), deleteMany: vi.fn() },
  ingredientMatchDecision: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  recipeIngredient: { count: vi.fn() },
  stockCountLine: { count: vi.fn() },
  canonicalIngredient: { delete: vi.fn() },
  canonicalIngredientEmbedding: { deleteMany: vi.fn() },
}))

vi.mock("@/lib/prisma", () => {
  const prisma: Record<string, unknown> = {
    invoice: { findMany: vi.fn() },
    ingredientMatchDecision: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    canonicalIngredient: { findMany: vi.fn(), create: vi.fn() },
    ingredientAlias: { findMany: vi.fn(), upsert: vi.fn() },
    ingredientSkuMatch: { upsert: vi.fn() },
    invoiceLineItem: { updateMany: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  }
  prisma.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: unknown) => Promise<unknown>)(txMocks)
      : Promise.all(arg as Promise<unknown>[])
  )
  return { prisma }
})

vi.mock("@/lib/chat/embeddings", () => ({
  embedBatch: vi.fn(),
  toVectorLiteral: vi.fn((vec: number[]) => `[${vec.join(",")}]`),
}))

vi.mock("@/lib/ingredient-match-llm", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ingredient-match-llm")>(
    "@/lib/ingredient-match-llm"
  )
  return { ...actual, adjudicate: vi.fn() }
})

vi.mock("@/lib/ingredient-cost", () => ({
  recomputeCanonicalCost: vi.fn(),
}))

vi.mock("@/lib/auth-scope", () => ({ getAuthScope: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { prisma } from "@/lib/prisma"
import { embedBatch } from "@/lib/chat/embeddings"
import { adjudicate, MAX_CASES_PER_REQUEST } from "@/lib/ingredient-match-llm"
import { recomputeCanonicalCost } from "@/lib/ingredient-cost"
import { getAuthScope } from "@/lib/auth-scope"
import { autoResolveUnmatchedLines } from "@/lib/ingredient-auto-match"
import { buildGroupKey } from "@/lib/ingredient-auto-match-core"
import { THRESHOLDS } from "@/lib/ingredient-match-scoring"
import { undoAutoMatch } from "@/app/actions/ingredient-auto-match-actions"

const SCOPE = { accountId: "acct-1", ownerId: "owner-1" }

type Candidate = { canonicalIngredientId: string; name: string; score: number }
type CapturedCase = { caseId: string; candidates: Array<{ name: string; score: number }> }

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

function echoAdjudicate(confidence: number) {
  return async ({ cases }: { cases: Array<{ caseId: string; candidates: Array<{ name: string }> }> }) => ({
    drafts: cases.map((c) => ({
      caseId: c.caseId,
      matchName: c.candidates[0]?.name ?? null,
      confidence,
      reasoning: "test draft",
    })),
    model: "gpt-5.4-nano",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ingredientMatchDecision.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.ingredientMatchDecision.create).mockResolvedValue({} as never)
  vi.mocked(prisma.ingredientMatchDecision.findFirst).mockResolvedValue(null as never)
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
  vi.mocked(getAuthScope).mockResolvedValue(SCOPE as never)

  vi.mocked(txMocks.invoiceLineItem.updateMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(txMocks.invoiceLineItem.findMany).mockResolvedValue([] as never)
  vi.mocked(txMocks.invoiceLineItem.count).mockResolvedValue(0 as never)
  vi.mocked(txMocks.ingredientSkuMatch.upsert).mockResolvedValue({} as never)
  vi.mocked(txMocks.ingredientSkuMatch.deleteMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(txMocks.ingredientAlias.upsert).mockResolvedValue({} as never)
  vi.mocked(txMocks.ingredientAlias.deleteMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(txMocks.ingredientMatchDecision.create).mockResolvedValue({} as never)
  vi.mocked(txMocks.ingredientMatchDecision.update).mockResolvedValue({} as never)
  vi.mocked(txMocks.ingredientMatchDecision.delete).mockResolvedValue({} as never)
  vi.mocked(txMocks.recipeIngredient.count).mockResolvedValue(0 as never)
  vi.mocked(txMocks.stockCountLine.count).mockResolvedValue(0 as never)
  vi.mocked(txMocks.canonicalIngredient.delete).mockResolvedValue({} as never)
  vi.mocked(txMocks.canonicalIngredientEmbedding.deleteMany).mockResolvedValue({ count: 0 } as never)
})

// Global, not per-test: proves the no-auto-create property holds across
// EVERY scenario below, not just the one test that used to assert it.
afterEach(() => {
  expect(prisma.canonicalIngredient.create).not.toHaveBeenCalled()
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
    expect(result.failed).toBe(0)
    expect(txMocks.invoiceLineItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["li-1"] } },
        data: expect.objectContaining({ canonicalIngredientId: "canon-1", matchSource: "auto-vector" }),
      })
    )
    expect(txMocks.ingredientMatchDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPLIED" }) })
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

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoVector).toBe(0)
    expect(result.leftForReview).toBe(1)
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
  })

  it("3. FLOOR is load-bearing: a lone top score just below FLOOR takes the raw-shortlist ('new') path, not the sorted-shortlist ('ambiguous') path", async () => {
    // If FLOOR did not gate this (e.g. it were deleted or lowered), this
    // exact fixture would classify as "ambiguous" instead of "new", and the
    // shortlist sent to the adjudicator would be classifyCandidates' own
    // SORTED candidates (highest score first) instead of the orchestrator's
    // raw candidates.slice(0, SHORTLIST) (input order). The two candidates
    // below are deliberately given in ascending-score order, so the two
    // paths produce observably different shortlist orders.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Exotic Truffle Oil" }] }),
    ] as never)
    const candidates: Candidate[] = [
      { canonicalIngredientId: "canon-2", name: "Chili Oil", score: 0.2 },
      { canonicalIngredientId: "canon-1", name: "Regular Oil", score: THRESHOLDS.FLOOR - 0.001 },
    ]
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue(candidates as never)

    let captured: CapturedCase[] = []
    vi.mocked(adjudicate).mockImplementation(async ({ cases }) => {
      captured = cases as CapturedCase[]
      return { drafts: [], model: "gpt-5.4-nano" }
    })

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.leftForReview).toBe(1)
    expect(captured).toHaveLength(1)
    // Raw input order (Chili Oil first) — NOT sorted-descending (which
    // would put Regular Oil, the higher score, first).
    expect(captured[0].candidates.map((c) => c.name)).toEqual(["Chili Oil", "Regular Oil"])
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
    vi.mocked(adjudicate).mockImplementation(echoAdjudicate(0.9) as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoLlm).toBe(1)
    expect(result.leftForReview).toBe(0)
    expect(result.llmCalls).toBe(1)
    expect(txMocks.invoiceLineItem.updateMany).toHaveBeenCalledWith(
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
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
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
    vi.mocked(adjudicate).mockImplementation(echoAdjudicate(THRESHOLDS.LLM_ACCEPT - 0.01) as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoLlm).toBe(0)
    expect(result.leftForReview).toBe(1)
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
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

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoLlm).toBe(0)
    expect(result.leftForReview).toBe(2)
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
  })

  it("8a. L1 suppression: a suppressed exact-name pair is not linked at L1", async () => {
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
    // Falls through to L2 with an empty pantry (no embedding candidates); L3
    // is skipped by the "any undo history" rule (8c covers that rule
    // directly) — either way canon-1 must never get linked by any layer.
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([] as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.leftForReview).toBe(1)
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
  })

  it("8b. L2 suppression: a suppressed candidate is filtered out before scoring, not merely blocked after winning", async () => {
    // Nothing in this fixture's product name matches a canonical/alias
    // exactly, so L1 does not apply. canon-1 would be the clear vector
    // winner (above HIGH, ample margin) if it weren't suppressed; because
    // filtering happens before classifyCandidates, the pool the group
    // actually gets scored against is empty, so it must NOT auto-link.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Vitco Frying Oil 35lb" }] }),
    ] as never)
    const groupKey = buildGroupKey("Sysco", "Vitco Frying Oil 35lb")
    vi.mocked(prisma.ingredientMatchDecision.findMany).mockResolvedValue([
      { groupKey, canonicalIngredientId: "canon-1" },
    ] as never)
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { canonicalIngredientId: "canon-1", name: "Frying Oil Shortening", score: 0.9 },
    ] as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoVector).toBe(0)
    expect(result.leftForReview).toBe(1)
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
  })

  it("8c. L3 gate: any UNDONE history for a group routes it away from a second LLM swing entirely", async () => {
    // The undone pairing names a DIFFERENT canonical than anything in
    // today's candidates — proving this is a groupKey-level gate ("this
    // product already burned a human correction"), not just a repeat of
    // the specific-pair check 8a/8b already cover. The adjudicator mock
    // would accept and link if it were ever called with this group's case.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Grnd Beef Fine 73/27" }] }),
    ] as never)
    const groupKey = buildGroupKey("Sysco", "Grnd Beef Fine 73/27")
    vi.mocked(prisma.ingredientMatchDecision.findMany).mockResolvedValue([
      { groupKey, canonicalIngredientId: "canon-99" },
    ] as never)
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { canonicalIngredientId: "canon-1", name: "Ground Beef 73/27", score: 0.6 },
      { canonicalIngredientId: "canon-2", name: "Chuck Roll", score: 0.55 },
    ] as never)
    vi.mocked(adjudicate).mockImplementation(echoAdjudicate(0.95) as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(adjudicate).not.toHaveBeenCalled()
    expect(result.autoLlm).toBe(0)
    expect(result.leftForReview).toBe(1)
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
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
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
    expect(txMocks.ingredientSkuMatch.upsert).not.toHaveBeenCalled()
    expect(txMocks.ingredientAlias.upsert).not.toHaveBeenCalled()
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
    expect(txMocks.ingredientMatchDecision.create).toHaveBeenCalledTimes(1)
    expect(txMocks.ingredientMatchDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          linkedLineItemIds: expect.arrayContaining(["li-1", "li-2"]),
          linkedLineItemCount: 2,
        }),
      })
    )
    expect(txMocks.invoiceLineItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: expect.arrayContaining(["li-1", "li-2"]) } } })
    )
  })

  it("11. a name matching more than one canonical (case-insensitive collision) is treated as ambiguous, not picked, at L1", async () => {
    // "Ground Beef" and "ground beef" coexist because CanonicalIngredient's
    // per-account uniqueness is case-sensitive in Postgres. Flattening this
    // into a single name->id map would silently pick one; it must instead
    // fall through to L2 and get scored.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Ground Beef" }] }),
    ] as never)
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "canon-fresh", name: "Ground Beef" },
      { id: "canon-frozen", name: "ground beef" },
    ] as never)
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([] as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoExact).toBe(0)
    expect(result.leftForReview).toBe(1)
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
  })

  it("12. a raw name aliased to different canonicals in different stores is treated as ambiguous, not picked, at L1", async () => {
    // IngredientAlias is unique per (storeId, rawName), not per account —
    // Hollywood aliasing "CHKN BRST 40#" to the fresh canonical and
    // Glendale aliasing the same string to the frozen canonical is a
    // legitimate, expected state. Cross-store L1 lookup must not flatten
    // that into a last-write-wins single id.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({
        storeId: "store-glendale",
        lineItems: [{ id: "li-1", productName: "CHKN BRST 40#" }],
      }),
    ] as never)
    vi.mocked(prisma.ingredientAlias.findMany).mockResolvedValue([
      { rawName: "CHKN BRST 40#", canonicalIngredientId: "canon-fresh" },
      { rawName: "CHKN BRST 40#", canonicalIngredientId: "canon-frozen" },
    ] as never)
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([] as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoExact).toBe(0)
    expect(result.leftForReview).toBe(1)
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
  })

  it("13. an embedBatch failure degrades pending groups to review, keeps L1 results, and never throws", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({
        lineItems: [
          { id: "li-1", productName: "Kosher Salt" }, // resolves at L1
          { id: "li-2", productName: "Exotic Truffle Oil" }, // would need L2
        ],
      }),
    ] as never)
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "canon-1", name: "Kosher Salt" },
    ] as never)
    vi.mocked(embedBatch).mockRejectedValue(new Error("OpenAI embeddings timed out"))

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.autoExact).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.leftForReview).toBe(1)
    expect(txMocks.invoiceLineItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["li-1"] } } })
    )
  })

  it("14. a write-back transaction failure for one group increments `failed` and does not discard the rest of the batch", async () => {
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Kosher Salt" }] }),
      invoiceWith({ lineItems: [{ id: "li-2", productName: "Black Pepper" }] }),
    ] as never)
    vi.mocked(prisma.canonicalIngredient.findMany).mockResolvedValue([
      { id: "canon-1", name: "Kosher Salt" },
      { id: "canon-2", name: "Black Pepper" },
    ] as never)
    let call = 0
    vi.mocked(prisma.$transaction).mockImplementation(async (arg: unknown) => {
      call++
      if (call === 1) throw new Error("db blip")
      return typeof arg === "function"
        ? (arg as (tx: unknown) => Promise<unknown>)(txMocks)
        : Promise.all(arg as Promise<unknown>[])
    })

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.failed).toBe(1)
    expect(result.autoExact).toBe(1)
    expect(result.leftForReview).toBe(1)
  })

  it("15. counts real adjudicate() request chunks (MAX_CASES_PER_REQUEST/request) instead of hardcoding 1", async () => {
    const lineItems = Array.from({ length: MAX_CASES_PER_REQUEST + 5 }, (_, i) => ({
      id: `li-${i}`,
      productName: `Ambiguous Product ${i}`,
    }))
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([invoiceWith({ lineItems })] as never)
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { canonicalIngredientId: "canon-1", name: "Some Candidate", score: 0.6 },
    ] as never)
    vi.mocked(adjudicate).mockResolvedValue({ drafts: [], model: "gpt-5.4-nano" } as never)

    const result = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(result.llmCalls).toBe(2)
  })

  it("16. the alias lookup is scoped by BOTH store.accountId and canonicalIngredient.accountId (tenant isolation)", async () => {
    // Constrained by store.accountId alone, a mis-parented alias row (its
    // canonicalIngredient belonging to a DIFFERENT account than its store)
    // could still resolve an invoice line to another tenant's canonical.
    // Both constraints must be present in the same query.
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", productName: "Kosher Salt" }] }),
    ] as never)

    await autoResolveUnmatchedLines(SCOPE, ["inv-1"])

    expect(prisma.ingredientAlias.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          store: { accountId: SCOPE.accountId },
          canonicalIngredient: { accountId: SCOPE.accountId },
        }),
      })
    )
  })
})

// undoAutoMatch is the reverse of this file's write side (Task 10). These
// tests exercise it against the SAME mocked prisma module autoResolveUnmatchedLines
// uses, so the "full cycle" test below is a real end-to-end proof: what the
// ladder linked and learned is exactly what undo unlinks and un-teaches, and
// the resulting UNDONE row is what the ladder's own suppression check (8a/8b/8c
// above) reads on the very next run.
describe("undoAutoMatch — reverses what autoResolveUnmatchedLines did", () => {
  it("full cycle: link -> undo -> re-run does not re-link; lines unlinked, learned sku match gone, cost recomputed, status UNDONE", async () => {
    // --- Step A: the ladder auto-links li-1 via L2 vector match. --------
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-1", sku: "SKU1", productName: "Ground Beef 73/27" }] }),
    ] as never)
    const candidates: Candidate[] = [
      { canonicalIngredientId: "canon-1", name: "Ground Beef 73/27", score: 0.95 },
      { canonicalIngredientId: "canon-2", name: "Ground Beef 80/20", score: 0.8 },
    ]
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue(candidates as never)

    const linkResult = await autoResolveUnmatchedLines(SCOPE, ["inv-1"])
    expect(linkResult.autoVector).toBe(1)

    expect(txMocks.ingredientSkuMatch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          vendorName: "Sysco",
          sku: "SKU1",
          canonicalIngredientId: "canon-1",
        }),
      })
    )
    const createdDecision = vi.mocked(txMocks.ingredientMatchDecision.create).mock
      .calls[0][0].data as Record<string, unknown>
    expect(createdDecision.linkedLineItemIds).toEqual(["li-1"])

    // --- Step B: undo it. ------------------------------------------------
    const decisionRow = {
      id: "dec-1",
      accountId: SCOPE.accountId,
      status: "APPLIED",
      ...createdDecision,
    }
    vi.mocked(prisma.ingredientMatchDecision.findFirst).mockResolvedValue(
      decisionRow as never
    )
    // Simulate the DB post-link state: li-1 is now linked with matchSource
    // "auto-vector" — undo's own findMany (not the ladder's) reads this.
    vi.mocked(txMocks.invoiceLineItem.findMany).mockResolvedValue([
      { id: "li-1", matchSource: "auto-vector", invoice: { storeId: "store-1" } },
    ] as never)
    vi.mocked(txMocks.invoiceLineItem.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(txMocks.ingredientSkuMatch.deleteMany).mockResolvedValue({ count: 1 } as never)

    const undoResult = await undoAutoMatch("dec-1")

    expect(undoResult.unlinkedCount).toBe(1)
    expect(undoResult.learnedMatchRemoved).toBe(true)
    expect(undoResult.canonicalDeleted).toBe(false)
    expect(txMocks.invoiceLineItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["li-1"] } },
      data: { canonicalIngredientId: null, matchSource: null, matchedAt: null },
    })
    expect(txMocks.ingredientSkuMatch.deleteMany).toHaveBeenCalledWith({
      where: {
        accountId: SCOPE.accountId,
        vendorName: "Sysco",
        sku: "SKU1",
        canonicalIngredientId: "canon-1",
      },
    })
    expect(recomputeCanonicalCost).toHaveBeenCalledWith("canon-1")
    expect(txMocks.ingredientMatchDecision.update).toHaveBeenCalledWith({
      where: { id: "dec-1" },
      data: expect.objectContaining({ status: "UNDONE", undoneById: SCOPE.ownerId }),
    })

    // --- Step C: re-run the ladder against a fresh line for the same
    // (vendor, product) group — the UNDONE row must suppress it. ----------
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([
      invoiceWith({ lineItems: [{ id: "li-2", sku: "SKU1", productName: "Ground Beef 73/27" }] }),
    ] as never)
    vi.mocked(prisma.ingredientMatchDecision.findMany).mockResolvedValue([
      { groupKey: createdDecision.groupKey, canonicalIngredientId: "canon-1" },
    ] as never)
    // canon-1 is still the only vector hit — suppression must filter it out
    // before scoring (leaving an empty candidate pool), not merely block it
    // after it wins. With undo history on this group, L3 is also skipped
    // entirely, so the line has nowhere left to land but review.
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([candidates[0]] as never)

    const rerun = await autoResolveUnmatchedLines(SCOPE, ["inv-2"])

    expect(rerun.autoVector).toBe(0)
    expect(rerun.autoLlm).toBe(0)
    expect(rerun.leftForReview).toBe(1)
    expect(adjudicate).not.toHaveBeenCalled()
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["li-2"] } } })
    )
  })

  it("leaves a line a human manually re-confirmed after the auto-link untouched", async () => {
    const decisionRow = {
      id: "dec-2",
      accountId: SCOPE.accountId,
      status: "APPLIED",
      groupKey: buildGroupKey("Sysco", "Ground Beef 73/27"),
      vendorName: "Sysco",
      sku: "SKU1",
      productName: "Ground Beef 73/27",
      canonicalIngredientId: "canon-1",
      createdCanonical: false,
      linkedLineItemIds: ["li-1", "li-2"],
    }
    vi.mocked(prisma.ingredientMatchDecision.findFirst).mockResolvedValue(
      decisionRow as never
    )
    // li-1 is still exactly as the ladder left it; li-2 was manually
    // re-confirmed afterward (matchSource is no longer auto-*).
    vi.mocked(txMocks.invoiceLineItem.findMany).mockResolvedValue([
      { id: "li-1", matchSource: "auto-vector", invoice: { storeId: "store-1" } },
      { id: "li-2", matchSource: "sku", invoice: { storeId: "store-1" } },
    ] as never)
    vi.mocked(txMocks.invoiceLineItem.updateMany).mockResolvedValue({ count: 1 } as never)

    const result = await undoAutoMatch("dec-2")

    expect(txMocks.invoiceLineItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["li-1"] } },
      data: { canonicalIngredientId: null, matchSource: null, matchedAt: null },
    })
    expect(result.unlinkedCount).toBe(1)
  })

  it("undoing an already-UNDONE decision is a safe no-op, not a double-unlink", async () => {
    vi.mocked(prisma.ingredientMatchDecision.findFirst).mockResolvedValue({
      id: "dec-3",
      accountId: SCOPE.accountId,
      status: "UNDONE",
      groupKey: buildGroupKey("Sysco", "Ground Beef 73/27"),
      vendorName: "Sysco",
      sku: "SKU1",
      productName: "Ground Beef 73/27",
      canonicalIngredientId: "canon-1",
      createdCanonical: false,
      linkedLineItemIds: ["li-1"],
    } as never)

    const result = await undoAutoMatch("dec-3")

    expect(result.alreadyUndone).toBe(true)
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(txMocks.invoiceLineItem.updateMany).not.toHaveBeenCalled()
  })
})
