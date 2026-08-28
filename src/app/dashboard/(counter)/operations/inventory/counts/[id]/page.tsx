import { getServerSession } from "next-auth"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import {
  getCountSessionName,
  getCountSessionSectionPromises,
} from "@/lib/counter/adapters/stock-counts"
import { CounterCountSessionClient } from "./counter-count-session-client"

export const dynamic = "force-dynamic"

/** One count session — `P.countsession`. A record, so it reads no date control. */
export default async function CountSessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
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
      <CounterCountSessionClient title={named.name} sections={sections} />
      <span hidden data-perf-ready="/dashboard/operations/inventory/counts/[id]" />
    </>
  )
}
