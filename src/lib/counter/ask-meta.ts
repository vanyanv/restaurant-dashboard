/**
 * What a turn cost and where it was recorded — one shape, two sources.
 *
 * `POST /api/chat` stamps this on the assistant message as metadata at
 * `finish` (see `messageMetadata` in the route); `adapters/ask.ts` reads the
 * same fields back off `ChatTurn` + `AiUsageEvent` for a thread opened from
 * the rail. The footer under an answer prints these and nothing it estimated
 * itself: a turn with no usage row prints no cost (D2).
 */
export interface AskTurnMeta {
  /** The `ChatTurn` row this answer became — what a thumb writes to. */
  chatTurnId: string | null
  costUsd: number | null
  durationMs: number | null
  /** `ChatTurn.feedback` as stored: `up`, `down:<reason>`, or nothing yet. */
  feedback: string | null
  /**
   * Served from the answer cache rather than computed by the model.
   *
   * The footer says so. Without it a cached turn reads as "$0.000 · 0.2s",
   * which is true of THIS turn and invites the reader to conclude the model
   * got cheaper — the answer was simply already known.
   */
  cached: boolean
  /** When the answer this turn replayed was first written, ISO. Cached turns only. */
  cachedAt: string | null
  /** Tools that came back with an error this turn — the sources the answer could not read. */
  failed: string[]
  /**
   * Why each of them did not come back, by tool name.
   *
   * The route has always persisted `ChatTurn.toolErrors` as
   * `{ toolName: message }`, and this shape kept only `Object.keys` of it — so
   * a timeout, a permission error and a bad argument all reached the reader as
   * the same three words, "did not come back". The message is already on the
   * row; it was being thrown away one step before the screen.
   */
  failedReasons: Record<string, string>
}

/**
 * One short clause for why a source is missing.
 *
 * Raw provider errors are long and often name internals, so the common shapes
 * are named in the reader's terms and anything unrecognised is trimmed rather
 * than hidden — an unfamiliar error the reader can quote to someone beats a
 * familiar sentence that says nothing.
 */
export function failureClause(raw: string | undefined): string {
  const m = (raw ?? "").trim()
  if (!m) return "did not come back"
  if (/timeout|timed out|ETIMEDOUT|AbortError/i.test(m)) return "timed out"
  if (/not owned|unauthori|forbidden|permission/i.test(m)) return "not available on this account"
  if (/rate.?limit|429/i.test(m)) return "rate limited"
  if (/invalid|validation|expected|must be/i.test(m)) return "was called with arguments it rejected"
  return m.length > 90 ? `${m.slice(0, 89).trimEnd()}…` : m
}

/** Reads the route's metadata off a UI message; `null` if it never landed. */
export function readAskTurnMeta(metadata: unknown): AskTurnMeta | null {
  if (!metadata || typeof metadata !== "object") return null
  const m = metadata as Record<string, unknown>
  if (typeof m.chatTurnId !== "string") return null
  return {
    chatTurnId: m.chatTurnId,
    costUsd: typeof m.costUsd === "number" ? m.costUsd : null,
    durationMs: typeof m.durationMs === "number" ? m.durationMs : null,
    feedback: typeof m.feedback === "string" ? m.feedback : null,
    cached: m.cached === true,
    cachedAt: typeof m.cachedAt === "string" ? m.cachedAt : null,
    failed: Array.isArray(m.failed) ? m.failed.filter((t): t is string => typeof t === "string") : [],
    failedReasons: readFailedReasons(m.failedReasons),
  }
}

/** `{ toolName: message }` off metadata or a `ChatTurn.toolErrors` row. */
export function readFailedReasons(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [tool, message] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof message === "string" && message.trim()) out[tool] = message
  }
  return out
}
