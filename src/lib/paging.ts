/**
 * Bounds for caller-supplied paging.
 *
 * ## Why these exist
 *
 * A server action is a POST endpoint with a stable id, and a chat tool's
 * arguments are written by a language model. Both hand `limit` and `page`
 * straight to Prisma's `take` and `skip`, and TypeScript's `limit?: number`
 * is erased at runtime — so `{ limit: 1_000_000 }` fetched a million rows and
 * `{ page: -5 }` produced a negative `skip`, which Prisma rejects with an
 * error the caller then sees as a broken page.
 *
 * Neither is a security hole: every one of these queries is already scoped by
 * `accountId`, so the worst case is a caller straining their own tenant. It is
 * a robustness and cost bound, which is why these clamp rather than throw —
 * a page size of 10,000 is a mistake to correct, not a request to refuse, and
 * refusing it would turn a stale bookmark into an error screen.
 *
 * ## Why a shared helper rather than a guard per call site
 *
 * There were eight sites and they disagreed: some defaulted, none bounded.
 * A clamp that lives in one place is a clamp that cannot be forgotten at the
 * ninth.
 */

/** Above this, a "page" is a table scan wearing a page's clothes. */
export const MAX_PAGE_SIZE = 200

/**
 * A caller's page size, bounded to `[1, MAX_PAGE_SIZE]`.
 *
 * `fallback` is the caller's own default, so each site keeps the page size it
 * was written for; this only decides what happens at the edges. A non-finite
 * or non-integer value (`NaN`, `Infinity`, `2.5`) falls back rather than
 * being coerced — Prisma's `take` requires an integer, and silently flooring
 * 2.5 would hide a caller bug.
 */
export function pageSize(value: unknown, fallback: number, max = MAX_PAGE_SIZE): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback
  if (value < 1) return 1
  return Math.min(value, max)
}

/**
 * A caller's 1-based page number, floored at 1.
 *
 * There is no upper bound: a page past the end is a legitimate request that
 * returns nothing, and capping it would silently show the wrong page instead.
 * The floor matters because `(page - 1) * limit` goes negative below 1, and
 * Prisma rejects a negative `skip`.
 */
export function pageNumber(value: unknown, fallback = 1): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback
  return Math.max(1, value)
}
