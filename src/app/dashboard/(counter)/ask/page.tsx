import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { getAskSectionPromises } from "@/lib/counter/adapters/ask"
import { CounterAskClient } from "./counter-ask-client"

/**
 * Counter Ask — `P.ask` at line 4504 of `docs/counter/counter-prototype.html`.
 *
 * `src/lib/counter/nav.ts:44` has pointed the rail at `/dashboard/ask` since
 * the rail was built and no such route has ever existed: clicking Ask 404'd.
 * This is that route.
 *
 * ## THE QUESTION IS IN THE URL, AND THAT IS THE WHOLE POINT
 *
 * `?q=how+were+sales+last+week` is what makes this a PAGE rather than a second
 * ⌘K palette. An answer at a URL is a link an owner can send to a manager, or
 * paste back to themselves next Monday, and the window and the store travel in
 * the same query string, so the link re-reads the same numbers rather than
 * whatever "yesterday" means on the day it is opened. `askHref()`
 * (`src/lib/counter/ask-context.ts`) builds it, and the palette's "Open in
 * Ask" now uses it too — one shape, from both directions.
 *
 * ## ONE TURN, HONESTLY (K-R4)
 *
 * The prototype's Ask page holds a conversation: a `.convs` rail of four
 * threads, a prior-question banner, a second turn still streaming, a
 * `.turnfoot` with what the turn cost. None of that is here, and none of it is
 * faked. A conversation needs history — a thread, a conversation id, turns
 * persisted and re-read — and that is the next sub-project. A page that
 * answers ONE question from a URL is the honest first version of it: asking a
 * follow-up navigates to a new `?q=`, so every answer this page has ever shown
 * is still a link, and nothing on screen claims a memory the backend is not
 * yet keeping.
 *
 * ## Route shape
 *
 * The Analytics page's, exactly: resolve the session, flatten `searchParams`,
 * resolve ONE `today`, hand plain serialisable props to a client island. It
 * imports no Prisma and no server action, and branches on no `SectionData`
 * status — `npm run tokens` fails the build on either.
 *
 * There is no `get*SectionPromises` call and so no per-section Suspense. That
 * is not a lapse from the streaming standard: this page has no server-rendered
 * sections at all. Its one payload is an answer that is streamed from
 * `POST /api/chat` to the CLIENT, by `useAsk`, after the page has painted —
 * the reader sees the shell, the head and their own question first, exactly
 * what a Suspense boundary would be there to give them.
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
  const today = new Date()

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
