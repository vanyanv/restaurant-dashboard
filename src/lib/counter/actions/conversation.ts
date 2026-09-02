"use server"

import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { chatPrisma } from "@/lib/chat/prisma-chat"
import {
  ConversationAccessError,
  MAX_CONVERSATION_TITLE,
  deleteConversation,
  getConversation,
  normalizeConversationTitle,
  setConversationTitle,
} from "@/lib/chat/conversation"

/**
 * NAMING AND DISCARDING A THREAD, from the Counter Ask rail.
 *
 * `PATCH` and `DELETE` on `/api/chat/conversations/[id]` have both existed
 * since the editorial chat drawer was built, and neither was reachable from
 * Ask: the rail could open a thread and nothing else. So an account
 * accumulated threads — 47 by the time this was written, every title written
 * by the model, none of them removable — and the only way to tidy one was the
 * "delete everything" button on a different surface.
 *
 * ## Why a server action and not that route
 *
 * The rail is a client island inside a Server Component page, and every other
 * mutation the Counter pages make goes through `src/lib/counter/actions/*`
 * — `acceptClusterMatch`, `logWaste`, `answerDecision`. A `fetch` to our own
 * origin would work and would be the odd one out; more to the point, it would
 * put the reader's session cookie on a round trip the framework can make
 * without one, and `router.refresh()` afterwards would still be the thing that
 * updates the rail.
 *
 * The RULE about a title is not duplicated: both doors call
 * `normalizeConversationTitle`. Two bounds on one field is how the API accepts
 * a title the rail will not, and neither owner ever finds out.
 *
 * ## Ownership is checked here, not trusted from the client
 *
 * `getConversation` and `deleteConversation` both throw
 * `ConversationAccessError` on a thread that is missing or on another account,
 * and an id arrives from `?c=` — which is to say, from the address bar. The
 * two failures are reported apart because they mean different things to a
 * reader: one thread is gone, the other was never theirs.
 */

type Result<T> = ({ ok: true } & T) | { ok: false; error: string }

/** Renames one thread. The rail's rows and the API's list read the same row. */
export async function renameAskThread(input: {
  id: string
  title: string
}): Promise<Result<{ title: string }>> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { ok: false, error: "Not signed in" }

  const title = normalizeConversationTitle(input.title)
  if (title === null) {
    return { ok: false, error: `A name is 1–${MAX_CONVERSATION_TITLE} characters` }
  }

  try {
    // Asserts the thread is on this account before anything is written.
    await getConversation(chatPrisma, session.user.accountId, input.id)
    await setConversationTitle(chatPrisma, input.id, title)
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
  return { ok: true, title }
}

/**
 * Deletes one thread, and everything under it.
 *
 * IRREVERSIBLE, and it takes the messages and their tool calls with it — which
 * now includes the filed returns a restored thread draws its figures from.
 * There is no archive and no undo, so the surface asks twice before calling
 * this; see `ThreadActions`.
 */
export async function deleteAskThread(input: { id: string }): Promise<Result<object>> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { ok: false, error: "Not signed in" }

  try {
    await deleteConversation(chatPrisma, session.user.accountId, input.id)
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
  return { ok: true }
}

/** The two access failures say different things to a reader; everything else
 *  is reported as itself rather than flattened into "something went wrong". */
function describe(err: unknown): string {
  if (err instanceof ConversationAccessError) {
    return err.code === "NOT_OWNED"
      ? "That conversation is not on this account"
      : "That conversation no longer exists"
  }
  return err instanceof Error ? err.message : "The change did not save"
}
