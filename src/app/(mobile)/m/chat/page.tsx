import { permanentRedirect } from "next/navigation"

/**
 * `/m/chat` — a redirect shim onto `/m/ask`, and the last pre-Counter screen
 * on the phone.
 *
 * What was here was the editorial chat: its own full-height fixed shell, its
 * own composer, its own conversation list, and `MobileChatClient` under it.
 * It outlived the Counter rebuild for one stated reason, repeated in three
 * files — "the phone's Counter Ask has no thread history and `/m/chat` does".
 *
 * That stopped being true and the comments did not move. Measured on
 * 2026-09-04 at `/m/ask`:
 *
 *     What you have asked · 2 THREADS
 *     analyzing platform sales costs · Today
 *     food cost analysis for september 2 · Yesterday
 *
 * and at `/m/ask?c=<id>`, the thread itself — the question, the answer, the
 * sources it read, its follow-up chips, and Rename and Delete beside the
 * title. History landed with `getAskSectionPromises`, which is the same
 * loader the desk's rail uses, and `urlConversationId` has read `?c=` since.
 * So the two surfaces were the same feature twice, and the older one was the
 * one an owner reached from `/dashboard/chat` on a phone.
 *
 * ## The id carries
 *
 * `Conversation.id` is one table, so a `?c=` on this route names the same
 * thread on the other. A shim that dropped it would turn every shared link to
 * a phone conversation into a landing on the empty state, which is worse than
 * the page it replaces.
 *
 * No session check: this resolves to a redirect and nothing else, and `/m/ask`
 * carries the gate a line later. The owner gate this page used to make was
 * `hasOwnerAccess`, which accepts both roles this product has — see
 * `/m/ask`'s own docblock, which notes it drops it for that reason.
 */
export default async function MobileChatRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams

  const carried = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") carried.set(key, value)
  }
  const qs = carried.toString()

  permanentRedirect(qs ? `/m/ask?${qs}` : "/m/ask")
}
