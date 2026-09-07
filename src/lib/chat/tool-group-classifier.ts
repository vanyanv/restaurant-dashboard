import { getChatOpenAIClient, CHAT_CLASSIFIER_MODEL } from "./openai-client"
import { TOOL_GROUPS, GROUP_HINTS, type ToolGroupName } from "./tool-groups"
import { logger } from "@/lib/logger"

/**
 * Which departments a question is about, when the page did not say.
 *
 * `activeToolsForPage` answers for every page in the rail. It cannot answer
 * for the one route whose own name is not a subject: a reader who opens Ask
 * from the rail and types "what did we spend with Sysco last month?" arrives
 * with `pageId: null`, and the route's only honest fallback is all 58 schemas
 * — the 21.9k-token turn this phase exists to remove.
 *
 * So one short call, no tools, no reasoning, picking from a fixed list of
 * department names. It reads the question and nothing else; it never sees the
 * database, and its output is matched against `TOOL_GROUPS` so an invented
 * name is dropped rather than trusted.
 *
 * ## Every failure degrades to slow, never to wrong
 *
 * A timeout, a network error, an unparseable reply, or an empty result all
 * return `null`, and `null` is "send everything" — exactly what the route did
 * before this file existed. The classifier can only ever make a turn faster or
 * leave it alone.
 */

/** The question is the only input, so it is also the whole cache key. */
const cache = new Map<string, ToolGroupName[] | null>()
const CACHE_MAX = 200

/**
 * Short on purpose. This call sits in front of the turn the reader is waiting
 * on, so a slow classifier is worse than no classifier — past this budget the
 * full tool set is the faster answer.
 */
const TIMEOUT_MS = 2_500

const GROUP_NAMES = Object.keys(TOOL_GROUPS) as ToolGroupName[]

function isGroupName(v: string): v is ToolGroupName {
  return (GROUP_NAMES as string[]).includes(v)
}

export async function classifyToolGroups(
  question: string,
): Promise<ToolGroupName[] | null> {
  const key = question.trim().toLowerCase()
  if (!key) return null
  if (cache.has(key)) return cache.get(key) ?? null

  let groups: ToolGroupName[] | null = null
  try {
    const client = getChatOpenAIClient()
    const res = await client.chat.completions.create(
      {
        model: CHAT_CLASSIFIER_MODEL,
        temperature: 0,
        max_tokens: 40,
        messages: [
          {
            role: "system",
            content:
              "You route a restaurant analytics question to the departments " +
              "that can answer it. The departments, and what each one can " +
              "reach:\n" +
              GROUP_NAMES.map((g) => `- ${g}: ${GROUP_HINTS[g]}`).join("\n") +
              "\n\nReply with a comma-separated list of one to three of " +
              "those names and NOTHING else. Pick every department the " +
              "question needs — a question comparing a delivery platform " +
              "against margin needs both. If you cannot tell, reply: unknown",
          },
          { role: "user", content: question },
        ],
      },
      { timeout: TIMEOUT_MS },
    )

    const raw = res.choices[0]?.message?.content?.trim().toLowerCase() ?? ""
    const picked = raw
      .split(",")
      .map((p) => p.trim())
      .filter(isGroupName)

    // Three is the same width `NAV_TOOL_GROUPS` gives a real page; more than
    // that is the classifier hedging its way back to the full menu.
    groups = picked.length > 0 ? [...new Set(picked)].slice(0, 3) : null
  } catch (err) {
    logger.warn("[chat] tool-group classifier failed; using all tools", err)
    groups = null
  }

  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, groups)
  return groups
}
