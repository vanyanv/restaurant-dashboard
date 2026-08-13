/**
 * Pure helpers for the page-view write path. No Prisma, no session — these
 * are the parts worth testing without a database, and the parts the API
 * route must not trust the client to have done.
 */

export const MAX_DWELL_MS = 4 * 60 * 60 * 1000
export const MAX_PATH_LEN = 200

const FUTURE_SKEW_MS = 5 * 60 * 1000
const PAST_SKEW_MS = 24 * 60 * 60 * 1000

/** Route bases whose next segment is dynamic, with the placeholder to use.
 * Needed because not every id is id-shaped — a P&L period is `2026-08`. */
const DYNAMIC_BASES: ReadonlyArray<readonly [string, string]> = [
  ["/dashboard/orders", "[id]"],
  ["/dashboard/invoices", "[id]"],
  ["/dashboard/pnl", "[storeId]"],
  ["/m/orders", "[id]"],
  ["/m/invoices", "[id]"],
  ["/m/pnl", "[storeId]"],
]

/** cuid, uuid, or a bare integer. */
const ID_SEGMENT =
  /^(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i

/** Strip query, hash and trailing slash. */
function bare(path: string): string {
  const cut = path.split(/[?#]/)[0] ?? ""
  if (cut.length > 1 && cut.endsWith("/")) return cut.slice(0, -1)
  return cut
}

/**
 * Collapse dynamic segments so visit counts group across detail pages.
 * `/dashboard/orders/clx.../items` -> `/dashboard/orders/[id]/items`.
 */
export function normalizeRoute(path: string): string {
  const clean = bare(path)
  for (const [base, placeholder] of DYNAMIC_BASES) {
    if (clean.startsWith(base + "/")) {
      const rest = clean.slice(base.length + 1).split("/")
      rest[0] = placeholder
      // Also collapse nested id segments under known bases
      for (let i = 1; i < rest.length; i++) {
        if (ID_SEGMENT.test(rest[i])) {
          rest[i] = "[id]"
        }
      }
      return [base, ...rest].join("/").slice(0, MAX_PATH_LEN)
    }
  }
  return clean
    .split("/")
    .map((seg) => (ID_SEGMENT.test(seg) ? "[id]" : seg))
    .join("/")
    .slice(0, MAX_PATH_LEN)
}

/** Only app surfaces are tracked. Guards against a hostile body naming
 * an arbitrary path, and against tracking auth or marketing routes. */
export function isTrackablePath(path: string): boolean {
  const clean = bare(path)
  return (
    clean === "/dashboard" ||
    clean.startsWith("/dashboard/") ||
    clean === "/m" ||
    clean.startsWith("/m/")
  )
}

/** A tab left open all weekend is not engagement. Null means "unknown",
 * which query code excludes from sums rather than counting as zero. */
export function clampDwell(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms)) return null
  if (ms < 0) return 0
  return Math.min(Math.round(ms), MAX_DWELL_MS)
}

/** The client supplies this, so it is a hint, not a fact. */
export function resolveEnteredAt(clientEpochMs: number, nowMs: number): Date {
  if (!Number.isFinite(clientEpochMs)) return new Date(nowMs)
  if (clientEpochMs > nowMs + FUTURE_SKEW_MS) return new Date(nowMs)
  if (clientEpochMs < nowMs - PAST_SKEW_MS) return new Date(nowMs)
  return new Date(clientEpochMs)
}
