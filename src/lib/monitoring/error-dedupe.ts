/**
 * Keeps one broken thing from writing one error row per page view.
 *
 * A section whose query throws fails on every visit, and a page that crashes
 * on a phone crashes on every reload. The first one is the news; the next
 * hundred are the same news. `shouldRecord` answers yes once per key per
 * window and no after that, so the error log stays readable and a loop cannot
 * fill the table.
 *
 * In-memory and per process on purpose: a cold start forgets and records the
 * error again, which is the right trade for a log nobody can read if it is
 * flooded. No imports, so the client reporter and the server hooks share it.
 */
export function createDedupe(windowMs: number, maxKeys = 500) {
  const seen = new Map<string, number>()
  /** `commit: false` only asks; the key is not taken until a call commits it. */
  return function shouldRecord(key: string, now = Date.now(), commit = true): boolean {
    const last = seen.get(key)
    if (last !== undefined && now - last < windowMs) return false
    if (!commit) return true
    if (seen.size >= maxKeys) {
      for (const [k, at] of seen) if (now - at >= windowMs) seen.delete(k)
      if (seen.size >= maxKeys) seen.clear()
    }
    seen.set(key, now)
    return true
  }
}

/** Ten minutes: long enough to fold a reload loop, short enough to show a fault that keeps happening. */
export const ERROR_DEDUPE_MS = 10 * 60_000
