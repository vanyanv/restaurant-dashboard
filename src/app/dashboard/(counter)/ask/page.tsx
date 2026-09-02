import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { getAskSectionPromises } from "@/lib/counter/adapters/ask"
import { CounterAskClient } from "./counter-ask-client"
import { counterToday } from "@/lib/counter/today"

/**
 * Counter Ask — `P.ask` at line 4504 of `docs/counter/counter-prototype.html`.
 *
 * `src/lib/counter/nav.ts:44` has pointed the rail at `/dashboard/ask` since
 * the rail was built and no such route has ever existed: clicking Ask 404'd.
 * This is that route.
 *
 * ## THE CONVERSATION IS IN THE URL, AND THAT IS THE WHOLE POINT
 *
 * Three query keys, each doing one job:
 *
 *   - `?q=how+were+sales+last+week` seeds a NEW thread. It is what an inbound
 *     link carries — the ⌘K palette's "Open in Ask", a `[data-askabout]` chip
 *     — and `askHref()` (`src/lib/counter/ask-context.ts`) builds it, carrying
 *     the store and the window so a link opened next week re-reads the window
 *     it was asked about rather than whatever "yesterday" means on the day it
 *     is opened.
 *   - `?c=` IS the thread, once one exists. The client replaces the address
 *     with it the moment `POST /api/chat` names the conversation, so what an
 *     owner sends a manager is the whole exchange and not its first line.
 *   - `?cq=` is what the conversation rail is SEARCHED for — read here, passed
 *     to the adapter, and deliberately not `q`: one is a question for the
 *     model, the other a string to find among threads already answered.
 *
 * ## IT HOLDS A CONVERSATION (K-R4 belongs to the palette, not to this page)
 *
 * The prototype's Ask page holds a conversation: a `.convs` rail of threads, a
 * prior question above the current one, a second turn still streaming. This
 * page shipped without any of it and said why — there was no thread store. The
 * reason expired quietly: `POST /api/chat` has taken a `conversationId` and
 * written a `Conversation` on every Ask since it was built, and by the time
 * anyone checked, 40 of the account's 47 stored threads held exactly one
 * question and one answer because nothing ever sent the id back. It does now.
 * The ⌘K palette still answers exactly one question — that is K-R4, and it is
 * a rule about the palette.
 *
 * ## Route shape
 *
 * The Analytics page's, exactly: resolve the session, flatten `searchParams`,
 * resolve ONE `today`, hand plain serialisable props to a client island. It
 * imports no Prisma and no server action, and branches on no `SectionData`
 * status — `npm run tokens` fails the build on either.
 *
 * ## Two payloads, not one
 *
 * The LIVE answer is streamed from `POST /api/chat` to the CLIENT, by
 * `useAsk`, after the page has painted, and needs no Suspense boundary: what
 * one would buy — the shell, the head and the reader's own question first — is
 * what already happens.
 *
 * HISTORY is different and is server-rendered, through `getAskSectionPromises`
 * and so through per-section Suspense like every other Counter page: the rail
 * of past threads, and the stored turns of the one named by `?c=`.
 */
export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sp = await searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value)
  }

  // Resolved once, here, and passed to the island — a moving `new Date()`
  // re-evaluated in two places could disagree about which calendar day
  // "today" is, and this page prints the window it is answering about.
  const today = counterToday()

  // The switcher's list, shared with every other Counter page rather than
  // re-queried: the store named in the question's scope sentence must be the
  // store the rail says is selected.
  const stores = await getOverviewStores()

  /*
   * NOT AWAITED — one promise per section, unwrapped inside `Section` on the
   * client, the same shape every other Counter page uses. The page's own
   * answer still streams from `POST /api/chat` after paint; these two are the
   * history beside it.
   *
   * The rail exists at all because the reason it did not is now false: this
   * page's own note said "there is no thread store behind it", and
   * `POST /api/chat` has been writing a conversation on every Ask ever since.
   * See `@/lib/counter/adapters/ask`.
   */
  const sections = getAskSectionPromises({
    accountId: session.user.accountId,
    conversationId: params.get("c"),
    // `?cq=` — what the rail is filtered to. A SECOND query key beside `?q=`,
    // rather than reusing it, because they are two different things typed into
    // two different boxes: `q` is a question for the model, `cq` is a string
    // to find among threads already answered. One key doing both would make a
    // rail search re-ask the model.
    query: params.get("cq"),
  })

  return (
    <CounterAskClient
      sections={sections}
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses
      // the RSC boundary with its prototype stripped.
      params={params.toString()}
      stores={stores}
      today={today}
    />
  )
}
