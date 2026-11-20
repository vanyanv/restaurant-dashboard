/*
 * The embedding row is replaced in ONE transaction. Before, the delete and
 * the insert ran separately, so a failed insert left the ingredient with no
 * embedding and invisible to vector search until its next edit.
 */
import { describe, it, expect, vi } from "vitest"

const tx = vi.fn(async (ops: unknown[]) => ops)
const exec = vi.fn((sql: string) => ({ sql }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    canonicalIngredient: {
      findUnique: vi.fn(async () => ({
        id: "c1", ownerId: "o1", accountId: "acct-A", name: "Beef", category: null, aliases: [],
      })),
    },
    $queryRawUnsafe: vi.fn(async () => []),
    $executeRawUnsafe: (sql: string) => exec(sql),
    $transaction: (ops: unknown[]) => tx(ops),
  },
}))
vi.mock("@/lib/chat/embeddings", () => ({
  embed: vi.fn(async () => [0.1]),
  snapshotHash: () => "h",
  toVectorLiteral: () => "[0.1]",
}))

import { syncCanonicalEmbedding } from "@/lib/ingredient-embedding-sync"

describe("syncCanonicalEmbedding", () => {
  it("deletes and inserts inside one $transaction", async () => {
    expect(await syncCanonicalEmbedding("c1")).toBe("written")
    expect(tx).toHaveBeenCalledTimes(1)
    const ops = tx.mock.calls[0][0] as Array<{ sql: string }>
    expect(ops).toHaveLength(2)
    expect(ops[0].sql).toMatch(/^DELETE/)
    expect(ops[1].sql).toMatch(/INSERT INTO "CanonicalIngredientEmbedding"/)
  })
})
