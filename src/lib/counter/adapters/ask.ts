import { cache } from "react"
import { chatPrisma } from "@/lib/chat/prisma-chat"
import { getConversation, searchConversations } from "@/lib/chat/conversation"
import { selectFiledReturn, type FiledReturn } from "@/lib/chat/return"
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
  /**
   * Turns ANSWERED — the rail's "· 2 turns".
   *
   * `answerCount`, not `messageCount`. A thread of one question and one answer
   * is two messages and ONE turn, and this rail printed the message count
   * under the word "turns" on both surfaces: measured against the live
   * database, 40 of 47 threads are exactly that shape, so almost every row in
   * the rail has been claiming twice the conversation it holds.
   */
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
  /**
   * The question this answer answers, so a restored turn can be handed to the
   * same `AskAnswerBody` a live one is. Empty on a user turn, and on an answer
   * with no question before it — a thread whose opening message failed to
   * persist.
   */
  question: string
  /**
   * THE STRIP THIS ANSWER SHOWED WHEN IT WAS LIVE — verdict, figures, deltas,
   * follow-ups — recovered rather than reconstructed. Null on a user turn, and
   * on an answer the model wrote without filing a return.
   *
   * See `filedFrom`. This is not a guess and costs no model call.
   */
  filed: FiledReturn | null
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
  async (accountId: string, query: string): Promise<AskConversation[]> => {
    /*
     * `searchConversations` is the same call `GET /api/chat/conversations`
     * makes, so the rail and the API cannot disagree about what a conversation
     * is — and its `q` searches TITLES AND THE TEXT OF EVERY TURN, which is
     * the whole reason it was written that way:
     *
     *   > Titles are auto-generated, so a thread the owner remembers by a
     *   > number in the answer ("the one where produce came out at twelve
     *   > thousand") is unreachable by title alone.
     *
     * The rail passed `""` and nothing else ever called it with a query, so
     * that capability has been sitting unreached behind a list of forty-odd
     * auto-generated titles. A blank query still degrades to the plain listing
     * — one code path, searched or not.
     */
    const rows = await searchConversations(chatPrisma, accountId, query, 40)
    return (
      rows
        /*
         * A QUESTION WITH NO ANSWER IS NOT A CONVERSATION.
         *
         * Six of the account's 47 threads hold one message and nothing else:
         * `POST /api/chat` writes the user's turn BEFORE it calls the model,
         * so a turn that fails leaves the question behind with no answer to
         * go with it. Those rows drew as "Untitled · 1 turn" and opened onto a
         * question the page could say nothing about.
         *
         * The cost, stated: a thread is invisible in the rail for the seconds
         * between the question being written and the answer landing. The rail
         * is server-rendered on navigation and the live turn is on screen
         * anyway, so the only reader who could notice is one watching their
         * own answer arrive — and they are watching the answer.
         */
        .filter((c) => c.answerCount > 0)
        .map((c) => ({
          id: c.id,
          title: c.title,
          turns: c.answerCount,
          updatedAt: c.updatedAt,
        }))
    )
  },
)

/**
 * THE FILED RETURN, RECOVERED FROM WHAT WAS ALREADY STORED.
 *
 * This adapter used to say, in its own words:
 *
 *   > `ChatMessage` persists the prose and the tool names; the `FiledReturn`
 *   > — the verdict and the figures the strip was built from — is not stored
 *   > anywhere.
 *
 * That was wrong, and wrong in the direction that costs the reader something:
 * `fileReturn` is a TOOL, every tool call is persisted with its arguments and
 * its result, and the result of `fileReturn` IS the `FiledReturn`. Counted in
 * the live database: 88 tool-call rows, **39 of them `fileReturn`** — one per
 * answered thread — each carrying the verdict, the figures with their deltas
 * and directions, and the follow-ups. The loader was reading those rows to
 * take `toolName` off them and discarding the rest.
 *
 * So re-opening your own thread showed prose with the numbers stripped out of
 * it, and a link sent to a manager was an answer with its figures missing.
 * Nothing is re-run and nothing is re-asked: the strip is the one that was
 * filed, read back.
 *
 * ONE PARSER, NOT TWO. `selectFiledReturn` already normalises this shape off a
 * live message part — it caps figures at three, drops a figure missing a value
 * or a label, and takes the LAST filing when the model corrected itself. A
 * stored row is handed to it as a settled part rather than parsed again here,
 * so a restored answer and a live one cannot disagree about what was filed.
 * `result` before `args`: `output` is what the live path reads, and `args` is
 * the fallback for a row written before the two were the same object.
 */
function filedFrom(
  calls: ReadonlyArray<{ toolName: string; args: unknown; result: unknown }>,
): FiledReturn | null {
  return selectFiledReturn(
    calls
      .filter((c) => c.toolName === "fileReturn")
      .map((c) => ({
        type: "tool-fileReturn",
        toolName: "fileReturn",
        state: "output-available",
        output: c.result ?? c.args,
      })),
  )
}

/**
 * A stored thread, rendered read-only.
 *
 * It now carries everything a live turn does — the question, the prose, the
 * sources AND the filed strip — so both surfaces render a restored turn
 * through the same `AskAnswerBody` as a fresh one. A second renderer for
 * "an answer you are reading again" is how two views of one answer come to
 * disagree about it.
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
        .map((m, i, rows) => {
          const isUser = m.role === "user"
          // The question an answer answers is the user row before it. Walked
          // backwards rather than assumed to be `i - 1`, so a thread with two
          // answers in a row (a retry that persisted twice) still attributes
          // each of them to a question the reader actually asked.
          let question = ""
          if (!isUser) {
            for (let j = i - 1; j >= 0; j--) {
              if (rows[j].role === "user") {
                question = questionFrom(rows[j].content)
                break
              }
            }
          }
          return {
            id: m.id,
            role: isUser ? ("user" as const) : ("assistant" as const),
            text: isUser ? questionFrom(m.content) : m.content,
            question,
            filed: isUser ? null : filedFrom(m.toolCalls),
            read: m.toolCalls
              .map((t) => t.toolName)
              // `fileReturn` reads nothing — the same exclusion the live "Read"
              // row makes in `toolNamesFrom`, so a restored turn and a fresh one
              // name the same sources.
              .filter((name) => name !== "fileReturn"),
          }
        }),
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
  /**
   * From `?cq=` — what the reader is looking for in the rail. Searched against
   * titles AND turn text; blank is the plain listing.
   */
  query?: string | null
}): StreamedSections<AskSections> {
  return {
    conversations: guardSection(
      classify(() => loadConversations(input.accountId, (input.query ?? "").trim()), {
        retryAction: "retryConversations",
        isEmpty: (rows) => rows.length === 0,
        // `no_match` rather than `pre_open` or `all_clear`: an account with no
        // history has asked nothing, which is the same shape as a search that
        // matched nothing — not a store that has not opened, and certainly not
        // "all clear", which would read as reassurance about a question nobody
        // asked. With `?cq=` live it is now literally the second of those, too.
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
