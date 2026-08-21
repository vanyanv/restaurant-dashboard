/**
 * Turns the AI SDK's raw `error.message` — usually a JSON error body or a bare
 * HTTP status — into a cause and one recovery.
 *
 * The rule this follows: name what happened and offer exactly one next move.
 * A generic failure toast is the most-cited anti-pattern in chat UI, because
 * it leaves the reader with nothing to do but retry blindly, and some of these
 * causes are not retryable at all — retrying an expired session or a thread
 * owned by someone else just fails again.
 */

export interface ChatErrorNotice {
  /** Mono caption at the top of the notice. */
  title: string
  /** One sentence in the interface's voice. Never an apology, never vague. */
  detail: string
  /** Label for the single recovery action, or null when retrying cannot help. */
  retryLabel: string | null
  /** What the retry should do — resend the turn, or drop the dead thread. */
  retryKind: "regenerate" | "new-thread" | null
}

export function describeChatError(raw: string | undefined | null): ChatErrorNotice {
  // A stack trace in the UI is noise; keep the first line only.
  const first = (raw ?? "").split("\n")[0].trim()
  const lower = first.toLowerCase()

  if (lower.includes("not_found") || lower.includes("not found") || lower.includes("404")) {
    return {
      title: "That thread is gone",
      detail: "It was deleted, or it never belonged to this account. Your question is still here.",
      retryLabel: "Ask in a new thread",
      retryKind: "new-thread",
    }
  }

  if (lower.includes("not_owned") || lower.includes("forbidden") || lower.includes("403")) {
    return {
      title: "No access to this thread",
      detail: "It belongs to a different account.",
      retryLabel: null,
      retryKind: null,
    }
  }

  if (lower.includes("unauthorized") || lower.includes("401")) {
    return {
      title: "Session expired",
      detail: "Sign in again and the question will still be here.",
      retryLabel: null,
      retryKind: null,
    }
  }

  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many")) {
    return {
      title: "Too many requests",
      detail: "The model is rate limited right now. A moment and it will go through.",
      retryLabel: "Try again",
      retryKind: "regenerate",
    }
  }

  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("504")) {
    return {
      title: "That took too long",
      detail: "The answer did not come back in time. A narrower range usually does.",
      retryLabel: "Try again",
      retryKind: "regenerate",
    }
  }

  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("econnrefused")) {
    return {
      title: "Lost the connection",
      detail: "The request did not reach the server.",
      retryLabel: "Try again",
      retryKind: "regenerate",
    }
  }

  return {
    title: "That did not go through",
    detail: first && first.length < 160 ? first : "The answer could not be produced.",
    retryLabel: "Try again",
    retryKind: "regenerate",
  }
}
