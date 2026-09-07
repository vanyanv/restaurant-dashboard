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
  }
}
