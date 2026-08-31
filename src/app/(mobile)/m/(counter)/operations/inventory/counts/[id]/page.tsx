import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import {
  getCountSessionName,
  getCountSessionSectionPromises,
} from "@/lib/counter/adapters/stock-counts"
import { CounterPhoneCountSessionClient } from "./counter-phone-count-session-client"

export const dynamic = "force-dynamic"

/**
 * One count session, on a phone — `P.countsession.phone()`.
 *
 * This is where the count-list page's "Open the count" button lands a phone,
 * and where `/count/new` sends you after it opens a session. Until now
 * `/dashboard/operations/inventory/counts/<id>` had no phone route, so it was
 * the last inventory sub-path `proxy.ts` had to keep off the rewrite list.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const { id } = await params
  const named = await getCountSessionName(id, session.user.accountId)
  if (!named) notFound()

  const sections = getCountSessionSectionPromises({
    countId: id,
    accountId: session.user.accountId,
  })

  return (
    <>
      <CounterPhoneCountSessionClient title={named.name} sections={sections} />
      <span hidden data-perf-ready="/m/operations/inventory/counts/[id]" />
    </>
  )
}
