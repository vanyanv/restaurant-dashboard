// Keeps CanonicalIngredientEmbedding in sync with CanonicalIngredient writes
// that happen outside the hand-run backfill script (scripts/backfill-embeddings.ts).
// Both paths must produce byte-identical text for the same ingredient —
// buildCanonicalIngredientText is the single shared source for that text so
// the backfill script and the live write path can never drift.

import { createHash } from "node:crypto"

import { prisma } from "@/lib/prisma"
import { embed, toVectorLiteral } from "@/lib/chat/embeddings"

export function buildCanonicalIngredientText(
  name: string,
  category: string | null,
  aliases: string[],
): string {
  const cleanedAliases = Array.from(
    new Set(
      aliases
        .map((a) => a?.trim())
        .filter((a): a is string => !!a && a.toLowerCase() !== name.toLowerCase()),
    ),
  ).slice(0, 12)
  const cat = category ? ` [${category.trim()}]` : ""
  const ali = cleanedAliases.length > 0
    ? ` · aliases: ${cleanedAliases.join(", ")}`
    : ""
  return `${name}${cat}${ali}`
}

export function snapshotHash(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/**
 * Write or refresh one canonical's embedding row. Idempotent: re-running with
 * unchanged text is a no-op, so callers never pay for a redundant embed.
 * Never throws — an embedding failure must not fail the mutation that
 * triggered it.
 */
export async function syncCanonicalEmbedding(
  canonicalId: string
): Promise<"written" | "unchanged" | "skipped"> {
  try {
    const ci = await prisma.canonicalIngredient.findUnique({
      where: { id: canonicalId },
      select: {
        id: true, ownerId: true, accountId: true, name: true, category: true,
        aliases: { select: { rawName: true } },
      },
    })
    if (!ci) return "skipped"

    const text = buildCanonicalIngredientText(
      ci.name, ci.category, ci.aliases.map((a) => a.rawName)
    )
    const hash = snapshotHash(text)

    const existing = await prisma.$queryRawUnsafe<Array<{ contentSnapshot: string }>>(
      `SELECT "contentSnapshot" FROM "CanonicalIngredientEmbedding"
        WHERE "canonicalIngredientId" = $1`,
      canonicalId,
    )
    if (existing[0]?.contentSnapshot === hash) return "unchanged"

    const vec = await embed(text)
    await prisma.$executeRawUnsafe(
      `DELETE FROM "CanonicalIngredientEmbedding" WHERE "canonicalIngredientId" = $1`,
      canonicalId,
    )
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CanonicalIngredientEmbedding"
         (id, "canonicalIngredientId", "ownerId", "accountId", "category", "name",
          "contentSnapshot", embedding, "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7::vector, NOW())`,
      canonicalId, ci.ownerId, ci.accountId, ci.category, ci.name, hash,
      toVectorLiteral(vec),
    )
    return "written"
  } catch (e) {
    console.warn("[syncCanonicalEmbedding] failed:", e)
    return "skipped"
  }
}
