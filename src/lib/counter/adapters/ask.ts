import { cache } from "react"
import { chatPrisma } from "@/lib/chat/prisma-chat"
import { getConversation, searchConversations } from "@/lib/chat/conversation"
import { classify, guardSection, type StreamedSections } from "@/lib/counter/adapters/types"
import type { SectionData } from "@/lib/counter/section-data"

/**
 * The Ask page's own adapter. Today it answers one question: what has this
 * account already asked?
 *
 * ## Why this exists now and did not before
 *
 * The Ask page shipped without the prototype's `.convs` rail, and said why in
 * its own words: *"there is no thread store behind it: a sidebar of
 * conversations would be four buttons that cannot restore anything."*
 *
 * That was true when it was written and is not true now — and nothing
 * announced the change, which is the point worth recording. `POST /api/chat`
 * has been calling `createConversation` and `appendMessage` on every single
 * Ask since it shipped. Checked against the live database while building this:
 * **39 conversations**, with model-generated titles, timestamps and turn
 * counts, none of which any surface has ever displayed. The rail was not
 * waiting on a backend. The backend was already there and writing.
 *
 * ## The shape
 *
 * A `SectionData`, not a bare array, so the rail gets `Section`'s six states
 * for free — an account that has asked nothing gets `Empty`, and a failed
 * read gets `Failed` naming the rail rather than an empty box that looks like
 * "you have no history".
 */

/** One row of the `.convs` rail. */
export interface AskConversation {
  id: string
  /**
   * The model's own title for the thread, or `null` before it has written one
   * — `setConversationTitle` runs after the first turn, so a conversation
   * asked seconds ago legitimately has none. The rail says "Untitled"; it does
   * NOT fall back to the first question, which would silently disagree with
   * the title that lands a moment later.
   */
  title: string | null
  /** Turns in the thread — the rail's "· 2 turns". */
  turns: number
  /** Last activity, which is what the rail orders and dates by. */
  updatedAt: Date
}

/** One restored turn: what was asked, what came back, what it read. */
export interface AskTurn {
  id: string
  role: "user" | "assistant"
  text: string
  /** Tool names, for the "Read" row. Empty on a user turn. */
  read: string[]
}

export interface AskThread {
  id: string
  title: string | null
  turns: AskTurn[]
}

export interface AskSections {
  conversations: SectionData<AskConversation[]>
  /**
   * The thread being read, when `?c=` names one. `null` — not a missing
   * section — when nothing is selected: the page is then answering a live
   * question and there is no history to draw.
   */
  thread: SectionData<AskThread | null>
}

/**
 * `cache()`d for the same reason every other Counter read is: the page and any
 * other caller in one request should ask once. See `@/lib/account-stores`.
 */
const loadConversations = cache(
  async (accountId: string): Promise<AskConversation[]> => {
    // `searchConversations` with an empty query is the plain list, newest
    // first — the same call `GET /api/chat/conversations` makes, so the rail
    // and the API cannot disagree about what a conversation is.
    const rows = await searchConversations(chatPrisma, accountId, "", 40)
    return rows.map((c) => ({
      id: c.id,
      title: c.title,
      turns: c.messageCount,
      updatedAt: c.updatedAt,
    }))
  },
)

/**
 * A stored thread, rendered read-only.
 *
 * WHAT IS NOT HERE, AND WILL NOT BE. `ChatMessage` persists the prose and the
 * tool names; the `FiledReturn` — the verdict and the figures the strip was
 * built from — is not stored anywhere. So a restored turn shows the question,
 * the paragraph and what it read, and shows NO figures. Reconstructing a strip
 * by re-running the tools would be a different answer wearing an old
 * question's clothes, and re-asking the model would be a bill for something
 * the reader already read.
 */
const loadThread = cache(
  async (accountId: string, conversationId: string): Promise<AskThread | null> => {
    const detail = await getConversation(chatPrisma, accountId, conversationId)
    return {
      id: detail.id,
      title: detail.title,
      turns: detail.messages
        // Only the two roles a reader recognises. A `system` or `tool` row is
        // plumbing and has never been shown on any surface.
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id,
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          text: m.role === "user" ? questionFrom(m.content) : m.content,
          read: m.toolCalls
            .map((t) => t.toolName)
            // `fileReturn` reads nothing — the same exclusion the live "Read"
            // row makes in `toolNamesFrom`, so a restored turn and a fresh one
            // name the same sources.
            .filter((name) => name !== "fileReturn"),
        })),
    }
  },
)

/**
 * The question as the reader TYPED it, recovered from what was stored.
 *
 * `useAsk` sends `${context.sentence}.\n${question}` on the wire — "Answering
 * about Overview · All stores · Yesterday." in front of the words the reader
 * actually wrote — and `POST /api/chat` persists that whole string. The live
 * surface never shows the prefix back (its own note: "that plumbing is never
 * shown back to the reader"), and a restored turn must not either, or reading
 * your own history looks like the app talking to itself.
 *
 * Split on the FIRST newline only. The prefix is one sentence and contains
 * none; a question may well contain several, and taking the last line would
 * quietly truncate any question the reader wrapped.
 *
 * A stored message with no newline predates the scope sentence, or came from
 * another surface — it is already the bare question and is returned untouched.
 */
function questionFrom(stored: string): string {
  const nl = stored.indexOf("\n")
  if (nl === -1) return stored
  const rest = stored.slice(nl + 1).trim()
  // An empty tail would mean the prefix WAS the message; showing nothing is
  // worse than showing the raw string.
  return rest.length > 0 ? rest : stored
}

export function getAskSectionPromises(input: {
  accountId: string
  /** From `?c=` — the thread the reader opened, if any. */
  conversationId?: string | null
}): StreamedSections<AskSections> {
  return {
    conversations: guardSection(
      classify(() => loadConversations(input.accountId), {
        retryAction: "retryConversations",
        isEmpty: (rows) => rows.length === 0,
        // `no_match` rather than `pre_open` or `all_clear`: an account with no
        // history has asked nothing, which is the same shape as a filter that
        // matched nothing — not a store that has not opened, and certainly not
        // "all clear", which would read as reassurance about a question nobody
        // asked.
        emptyReason: "no_match",
      }),
      "retryConversations",
    ),
    thread: guardSection(
      classify(
        () =>
          input.conversationId
            ? loadThread(input.accountId, input.conversationId)
            : Promise.resolve(null),
        {
          retryAction: "retryThread",
          // A thread with no readable turns is empty; NOTHING SELECTED is not.
          // `null` is a real answer — "you are not reading a thread" — and
          // classifying it as empty would put an empty state over a live
          // question the reader is waiting on.
          isEmpty: (t) => t !== null && t.turns.length === 0,
          emptyReason: "no_match",
        },
      ),
      "retryThread",
    ),
  }
}
