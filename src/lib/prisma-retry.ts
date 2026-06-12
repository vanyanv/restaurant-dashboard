/**
 * Retry wrapper for transient Postgres/Neon connection failures.
 *
 * Neon's serverless Postgres can take a few seconds to wake a suspended
 * compute; the *first* query in a cron run then dies with `ETIMEDOUT` (or a
 * Prisma `P1001/P1002/P1008/P1017`) even though a retry a second later
 * succeeds. See incidents #40 (jobRun.create) and #41 (otterStore.findMany).
 *
 * Only connection-level transients are retried — real query errors (unique
 * violations, missing columns, etc.) re-throw immediately so we don't paper
 * over genuine bugs.
 */

// Node socket errors + Prisma connection-init error codes.
const TRANSIENT_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "P1001", // Can't reach database server
  "P1002", // Database server reached but timed out
  "P1008", // Operations timed out
  "P1017", // Server has closed the connection
])

const TRANSIENT_MESSAGE =
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|can't reach database server|timed out|connection (?:closed|reset|terminated)|server has closed the connection/i

function isTransient(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const code = (err as { code?: unknown }).code
  if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true
  const message = err instanceof Error ? err.message : String(err)
  return TRANSIENT_MESSAGE.test(message)
}

export type PrismaRetryOpts = {
  /** Total attempts (default 3). */
  retries?: number
  /** Backoff base in ms; wait = baseMs * attempt (default 1000). */
  baseMs?: number
  /** Label for the retry log line. */
  label?: string
}

export async function withPrismaRetry<T>(
  fn: () => Promise<T>,
  opts: PrismaRetryOpts = {},
): Promise<T> {
  const retries = opts.retries ?? 3
  const baseMs = opts.baseMs ?? 1000
  let lastErr: unknown

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt >= retries || !isTransient(err)) throw err
      const backoff = baseMs * attempt
      const head = err instanceof Error ? err.message.split("\n")[0] : String(err)
      console.warn(
        `[prisma-retry]${opts.label ? ` ${opts.label}` : ""} transient DB error ` +
          `(attempt ${attempt}/${retries}), retrying in ${backoff}ms: ${head}`,
      )
      if (backoff > 0) await new Promise((r) => setTimeout(r, backoff))
    }
  }

  throw lastErr
}
