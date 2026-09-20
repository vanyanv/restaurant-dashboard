import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"

/**
 * A DAILY DOLLAR CEILING, BECAUSE THE RATE LIMIT COUNTS THE WRONG THING.
 *
 * `/api/chat` is gated at 30 requests a minute. Every one of those is a billed
 * model call with a fifteen-step tool loop and `maxDuration = 300` behind it,
 * so the limiter's unit — a request — has no fixed price, and a client stuck
 * in a retry loop is inside the limit the whole time it is spending money.
 * `AiUsageEvent` has recorded the cost of every turn since the feature
 * shipped, and nothing has ever read it back at a moment when it could refuse.
 *
 * This is that read. It is a ceiling against a runaway, not a budget an owner
 * is meant to feel: the default is far above a day of ordinary use, and the
 * turn it stops gets a plain sentence rather than a 500.
 *
 * ## Why it fails open
 *
 * A database hiccup here would otherwise take the whole feature down to
 * protect a bill that is usually nowhere near the line. An unreadable ledger
 * means the cap does not know, and not knowing is not a reason to refuse.
 */

/** Dollars per account per LA business day. Overridable without a deploy. */
export const CHAT_DAILY_BUDGET_USD = Number(
  process.env.CHAT_DAILY_BUDGET_USD ?? "25",
)

/**
 * The ledger is read at most once a minute per account.
 *
 * The figure only moves when a turn finishes, and a turn takes seconds, so a
 * reading a minute old is off by at most the handful of turns one reader can
 * start in that time — far inside the headroom between ordinary use and the
 * cap. A read per turn would put an aggregate in front of every question to
 * answer "no" on almost none of them.
 */
const TTL_MS = 60_000
const cache = new Map<string, { at: number; spentUsd: number }>()

/** Dollars this account has spent on AI since midnight, LA time. */
export async function spentTodayUsd(accountId: string): Promise<number | null> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.spentUsd

  try {
    const rows = await prisma.$queryRaw<{ total: number | null }[]>`
      SELECT SUM(e."estimatedCostUsd")::float AS total
        FROM "AiUsageEvent" e
       WHERE e."occurredAt" >= date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles')
                               AT TIME ZONE 'America/Los_Angeles'
         AND (
           e."userId" IN (SELECT id FROM "User" WHERE "accountId" = ${accountId})
           OR e."storeId" IN (SELECT id FROM "Store" WHERE "accountId" = ${accountId})
         )
    `
    const spentUsd = Number(rows[0]?.total ?? 0)
    cache.set(accountId, { at: Date.now(), spentUsd })
    return spentUsd
  } catch (err) {
    logger.warn("[chat] daily spend read failed; cap not enforced this turn", err)
    return null
  }
}

export interface SpendCapVerdict {
  overBudget: boolean
  spentUsd: number | null
  budgetUsd: number
}

export async function checkDailyBudget(accountId: string): Promise<SpendCapVerdict> {
  const budgetUsd = CHAT_DAILY_BUDGET_USD
  // A cap set to zero or something unparseable is a misconfiguration, not an
  // instruction to refuse every question.
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return { overBudget: false, spentUsd: null, budgetUsd }
  }
  const spentUsd = await spentTodayUsd(accountId)
  return {
    overBudget: spentUsd !== null && spentUsd >= budgetUsd,
    spentUsd,
    budgetUsd,
  }
}

/** Drop the cached figure for one account — used by tests. */
export function resetSpendCapCache(): void {
  cache.clear()
}
