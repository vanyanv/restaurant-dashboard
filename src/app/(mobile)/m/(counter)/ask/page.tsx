import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getOverviewStores } from "@/lib/counter/adapters/overview"
import { CounterPhoneAskClient } from "./counter-phone-ask-client"

/**
 * Counter Ask — the phone. `P.ask.phone()` at line 4611 of
 * `docs/counter/counter-prototype.html`.
 *
 * `src/proxy.ts` now maps `/dashboard/ask` here on a phone user agent, so
 * this route IS Ask on a phone: before it, the rail's Ask and the palette's
 * "Open in Ask" both landed a phone reader on a desk page rendered at 390px.
 *
 * ## The same page, not a second one
 *
 * It is the desk route's near-copy on purpose, and the part that must stay
 * identical is all of it that decides anything: the question comes off `?q=`,
 * the scope off `readCounterParams` through `describeAskContext`, the answer
 * out of `useAsk` against the same `POST /api/chat`, and the answer is drawn
 * by the same `AskAnswerBody`. Two surfaces that each rendered their own
 * answer would be two products disagreeing about what an answer looks like,
 * and the link one of them sends would not be the answer the other shows.
 *
 * What differs is the shell and the strip — `.mchat`/`.manswer` instead of
 * `.chat`/`.ans`, `.mstrip` instead of `.strip` — which is the same set of
 * differences every other rebuilt route carries between its two surfaces.
 *
 * ## Route shape
 *
 * The phone Alerts page's, minus its owner gate: resolve the session, flatten
 * `searchParams`, resolve ONE `today`, hand plain serialisable props to a
 * client island. It imports no Prisma and no server action, and branches on no
 * `SectionData` status.
 *
 * There is no `get*SectionPromises` call and so no per-section Suspense — the
 * desk route's own note applies unchanged: this page has no server-rendered
 * sections at all. Its one payload is an answer streamed to the CLIENT after
 * the page has painted, and what a Suspense boundary would have bought (the
 * shell and the reader's own question first) is what already happens.
 *
 * No owner gate, deliberately, and the desk route has none either: every
 * figure in an answer comes from a tool that carries its own authorisation, so
 * a second copy of that decision here could only drift from the tools'.
 */
export default async function MobileAskPage({
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

  // The switcher's list, shared with the shell rather than re-queried
  // (`getOverviewStores` is `cache()`d, so this costs nothing): the store
  // named in the question's scope sentence must be the store `.mtop` says is
  // selected.
  const stores = await getOverviewStores()

  return (
    <CounterPhoneAskClient
      // PLAIN TEXT, not the URLSearchParams above: a class instance crosses
      // the RSC boundary with its prototype stripped.
      params={params.toString()}
      stores={stores}
      today={today}
    />
  )
}
