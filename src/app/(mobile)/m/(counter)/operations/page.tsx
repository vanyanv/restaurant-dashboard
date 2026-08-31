import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getOperationsSectionPromises } from "@/lib/counter/adapters/operations"
import { CounterPhoneOperationsClient } from "./counter-phone-operations-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/**
 * Operations, on a phone — `P.operations.phone()`.
 *
 * Calls `getOperationsSectionPromises`, the same function the desk calls.
 */
export default async function MobileOperationsPage({
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

  const today = counterToday()
  const counterParams = readCounterParams(params, today)

  const sections = getOperationsSectionPromises({
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    range: counterParams.range,
    today,
  })

  return (
    <>
      <CounterPhoneOperationsClient sections={sections} />
      <span hidden data-perf-ready="/m/operations" />
    </>
  )
}
