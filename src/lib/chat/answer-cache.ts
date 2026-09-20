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
 * The key is `(account, question, scope, page, effort, dataAsOf)`:
 *
 * - **account** first and non-negotiable. An answer is built from one
 *   tenant's rows; serving it to another is the worst bug this file could
 *   have, so the account id is in the key rather than assumed from context.
 * - **question**, normalised for whitespace and case only. Not stemmed and
 *   not embedded: "sales last week" and "sales this week" are one edit apart
 *   and must never collide, so near-matching is deliberately not attempted.
 * - **scope** — THE STORE AND THE WINDOW, and the reason this parameter
 *   exists at all. `useAsk` sends `${context.sentence}.\n${question}`, so the
 *   store and the range travel in that first line and the route strips it off
 *   before it classifies. It used to strip it off the key as well, which made
 *   "how were sales last week?" asked about Hollywood and the same words
 *   asked about Glendale one entry: same text, same page, same sync stamp.
 *   The second reader was served the first reader's store. The sentence IS
 *   the scope, so keying on it verbatim cannot drift from what travelled.
 * - **page**, because the same words mean different things on different
 *   pages — `describeAskContext` exists for that reason — and because the
 *   page decides which tools the turn could reach.
 * - **businessDay**, the LA date the question was asked on. The scope
 *   sentence names a range PRESET ("Yesterday", "Last 7 days"), not a
 *   window: `rangeLabel` returns the preset's name for everything but a
 *   custom range. So at 23:50 on Monday and 00:20 on Tuesday the whole key
 *   was identical -- same words, same store, same label -- and Sunday's
 *   answer was served as Monday's for anyone asking in that half hour. The
 *   only thing standing against it was `dataAsOf`, and the window straddling
 *   midnight is exactly when the day has just closed and the sync has not
 *   run. The date is cheap and kills the whole class: a relative range means
 *   a different window tomorrow, so an entry should not outlive the day.
 * - **effort**, because Quick and Careful are different compute budgets. A
 *   reader who picks Careful has asked for more thinking, and handing back
 *   the Quick answer the cache already had is not that.
 * - **dataAsOf**, the newest sync stamp across the tools the turn may read.
 *   This is what makes the entry self-invalidating: Otter backfills closed
 *   windows, so an answer must expire when the DATA changes, not when a timer
 *   says so. A backfill moves `MAX(syncedAt)`, the key changes, and the old
 *   entry is simply never looked up again.
 *
 * ## What is never looked up
 *
 * A FOLLOW-UP. Nothing in the key comes from the thread, so "and last month?"
 * carries no trace of the question it follows, and two threads that both
 * reach that phrase on the same page inside one sync window would share an
 * entry. Rather than hash the replayed history — which would make the key
 * depend on how much history a client happened to send — the route looks the
 * cache up only on the FIRST turn of a conversation, where the typed words
 * are the whole question. See `cacheEligible` in the route.
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
  /**
   * The context sentence the composer prepended, verbatim — it names the
   * store and the date range this question was asked under. Null only for a
   * caller that sends no scope at all, which is its own key space.
   */
  scope: string | null
  pageId: string | null
  /** The dock's Quick / Careful choice, or null for the route's default. */
  effort: string | null
  /**
   * The LA business date, `YYYY-MM-DD`. Required, because the scope sentence
   * carries a range LABEL rather than a window, and a label means a
   * different window tomorrow.
   */
  businessDay: string
  dataAsOf: string | null
}): string {
  const material = stableKey({
    q: normaliseQuestion(input.question),
    scope: input.scope ? normaliseQuestion(input.scope) : "",
    page: input.pageId ?? "",
    effort: input.effort ?? "",
    day: input.businessDay,
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
