import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { readCounterParams } from "@/lib/counter/url-state"
import { getPackagingSectionPromises } from "@/lib/counter/adapters/packaging"
import { CounterPhonePackagingClient } from "./counter-phone-packaging-client"
import { counterToday } from "@/lib/counter/today"

export const dynamic = "force-dynamic"

/** Packaging, on a phone — `P.packaging.phone()`. */
export default async function MobilePackagingPage({
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

  const sections = getPackagingSectionPromises({
    storeId: counterParams.storeId,
    accountId: session.user.accountId,
    range: counterParams.range,
  })

  return (
    <>
      <CounterPhonePackagingClient sections={sections} />
      <span hidden data-perf-ready="/m/operations/packaging" />
    </>
  )
}
