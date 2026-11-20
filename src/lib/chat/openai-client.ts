import OpenAI from "openai"

let cachedClient: OpenAI | null = null

export function getChatOpenAIClient(): OpenAI {
  if (cachedClient) return cachedClient
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set")
  cachedClient = new OpenAI({ apiKey, timeout: 60_000 })
  return cachedClient
}

/**
 * The CAREFUL model: a reasoning model, used when the owner picks "Careful"
 * in the dock. See `chatModelFor` for which turn gets which model.
 */
export const CHAT_ROUTING_MODEL =
  process.env.CHAT_ROUTING_MODEL ?? "gpt-5-mini"

/**
 * The QUICK model, which answers every turn that did not ask for Careful.
 *
 * gpt-4.1 since 2026-11-04 (owner's pick). Measured on the live database that
 * day, a Quick answer on gpt-5-mini took 11-14 s, of which the data tools were
 * under one second: the rest was two model calls, each preceded by hidden
 * reasoning the owner watched a spinner for. gpt-4.1 does not reason before it
 * acts, so each call starts writing almost at once. It was chosen over
 * gpt-4.1-mini for tool-choice accuracy (these answers carry money figures)
 * and over `minimal` effort on gpt-5-mini, which the note at the route's
 * `streamText` call records picking duplicate tools.
 *
 * Overridable without a code change: set `CHAT_QUICK_MODEL`.
 */
export const CHAT_QUICK_MODEL =
  process.env.CHAT_QUICK_MODEL ?? "gpt-4.1"

/** OpenAI's reasoning families: gpt-5*, and o1/o3/o4. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model)
}

/**
 * Which model answers a turn, and with what reasoning effort.
 *
 * One function so the route, the eval and the timing script cannot disagree
 * about what ships. `reasoningEffort` is null for a non-reasoning model: the
 * provider would only drop it with a warning.
 */
export function chatModelFor(effort: "quick" | "careful" | null | undefined): {
  model: string
  reasoningEffort: string | null
} {
  if (effort === "careful") {
    // One notch above Quick's old setting, never more: "high" on gpt-5-mini
    // was measured at over a minute on a four-tool question.
    return {
      model: CHAT_ROUTING_MODEL,
      reasoningEffort: isReasoningModel(CHAT_ROUTING_MODEL) ? "medium" : null,
    }
  }
  return {
    model: CHAT_QUICK_MODEL,
    reasoningEffort: isReasoningModel(CHAT_QUICK_MODEL) ? CHAT_REASONING_EFFORT : null,
  }
}

/**
 * How hard the routing model thinks before it acts. See the long note at the
 * `streamText` call in `src/app/api/chat/route.ts` for the measurements that
 * chose `low` — briefly: the unset default is `medium`, and medium cost the
 * owner roughly fifteen seconds a question for tool choices `low` made
 * identically.
 *
 * Only applied when `CHAT_QUICK_MODEL` is a reasoning model (it is not by
 * default since 2026-11-04); `chatModelFor` leaves it off otherwise.
 */
export const CHAT_REASONING_EFFORT =
  process.env.CHAT_REASONING_EFFORT ?? "low"
/**
 * The tool-group classifier (`tool-group-classifier.ts`). Small and
 * non-reasoning on purpose: it picks one to three names off a fixed list and
 * sits in front of a turn the reader is already waiting on, so its whole value
 * is being much cheaper than the 58 schemas it saves.
 *
 * gpt-4.1-mini, not gpt-4.1-nano. OpenAI retired nano: from at least
 * 2026-10-28 every call returned 404 `model_not_found`, the classifier's
 * catch turned that into "use all tools", and every Ask from the rail ran
 * on the full ~25k-token menu instead of a 9-13k one. Mini is still
 * non-reasoning (so `temperature` and `max_tokens` stay valid) and is the
 * model invoice reading already runs on. The title model below was on nano
 * too and failed the same way.
 */
export const CHAT_CLASSIFIER_MODEL =
  process.env.CHAT_CLASSIFIER_MODEL ?? "gpt-4.1-mini"

export const CHAT_TITLE_MODEL =
  process.env.CHAT_TITLE_MODEL ?? "gpt-4.1-mini"
export const CHAT_EMBEDDING_MODEL = "text-embedding-3-small"
export const CHAT_EMBEDDING_DIMS = 1536
