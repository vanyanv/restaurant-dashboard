import { getRedis } from "@/lib/cache/redis"
import { stableKey } from "@/lib/cache/cached"
import { logger } from "@/lib/logger"
import { createHash } from "node:crypto"

/**
 * THE SAME QUESTION, ASKED AGAIN, ANSWERED WITHOUT THE MODEL.
 *
 * ## Why the key is what it is
 *
 * A turn costs 15-19 seconds and a model call. Two readers asking "how were
 * sales last week?" on the same Monday are asking about identical rows, and
 * the second one has been paying full price for an answer that had already
 * been computed.
 *
 * The key is `(account, question, scope, dataAsOf)`:
 *
 * - **account** first and non-negotiable. An answer is built from one
 *   tenant's rows; serving it to another is the worst bug this file could
 *   have, so the account id is in the key rather than assumed from context.
 * - **question**, normalised for whitespace and case only. Not stemmed and
 *   not embedded: "sales last week" and "sales this week" are one edit apart
 *   and must never collide, so near-matching is deliberately not attempted.
 * - **scope**, because the same words mean different things on different
 *   pages and stores — `describeAskContext` exists for that reason.
 * - **dataAsOf**, the newest sync stamp across the tools the turn may read.
 *   This is what makes the entry self-invalidating: Otter backfills closed
 *   windows, so an answer must expire when the DATA changes, not when a timer
 *   says so. A backfill moves `MAX(syncedAt)`, the key changes, and the old
 *   entry is simply never looked up again.
 *
 * ## What is never cached
 *
 * An answer whose tools do not all report an `asOf` (`everyToolStamped`).
 * Without a stamp there is no moment that could invalidate the entry, so no
 * TTL is honest — the proposal's own rule, enforced at store time against the
 * tools the turn actually read.
 *
 * Failed, stopped and empty turns are not stored either: a cache that can
 * serve a failure has turned one bad minute into a permanent answer.
 *
 * ## Why a TTL as well
 *
 * `dataAsOf` handles correctness; the TTL handles everything the stamp cannot
 * see — a prompt change, a tool's logic changing, a model swap. Twelve hours
 * is longer than the sync cadence, so in practice entries almost always die
 * by their key changing rather than by expiry.
 */

const PREFIX = "chat:answer"
const TTL_SECONDS = 12 * 60 * 60

/** One tool call, as much of it as the client needs to rebuild the answer. */
export interface CachedToolCall {
  toolName: string
  input: unknown
  output: unknown
}

export interface CachedAnswer {
  /** The assistant's prose, exactly as it streamed. */
  text: string
  /**
   * Every tool call including `fileReturn` — the filed return IS the answer's
   * structure (verdict, figures, follow-ups), so replaying without it would
   * serve a cached answer that renders as loose prose.
   */
  toolCalls: CachedToolCall[]
  /** What the original turn cost, so the footer does not claim this one was free. */
  costUsd: number | null
  /** When the answer was first computed, for the footer's "answered earlier". */
  storedAt: string
}

/**
 * Whitespace and case only.
 *
 * Anything cleverer risks collapsing two questions that differ by the one word
 * that mattered, and a wrong cached answer is worse than a slow correct one.
 */
function normaliseQuestion(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ")
}

export function answerCacheKey(input: {
  accountId: string
  question: string
  pageId: string | null
  dataAsOf: string | null
}): string {
  const material = stableKey({
    q: normaliseQuestion(input.question),
    page: input.pageId ?? "",
    asOf: input.dataAsOf ?? "",
  })
  // Hashed because a question is arbitrary user text and keys are a shared
  // namespace; the account id stays in the clear so a tenant's entries can be
  // seen and dropped without decoding anything.
  const digest = createHash("sha256").update(material).digest("hex").slice(0, 32)
  return `${PREFIX}:${input.accountId}:${digest}`
}

export async function readCachedAnswer(key: string): Promise<CachedAnswer | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    const hit = await redis.get<CachedAnswer>(key)
    if (!hit || typeof hit.text !== "string" || !Array.isArray(hit.toolCalls)) return null
    return hit
  } catch (err) {
    // A cache that cannot be read is a slow turn, never a failed one.
    logger.warn("[chat] answer cache read failed", err)
    return null
  }
}

export async function writeCachedAnswer(key: string, value: CachedAnswer): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.set(key, value, { ex: TTL_SECONDS })
  } catch (err) {
    logger.warn("[chat] answer cache write failed", err)
  }
}
