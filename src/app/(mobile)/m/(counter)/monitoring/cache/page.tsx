import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { getCacheSectionPromises } from "@/lib/counter/adapters/monitoring-tabs"
import { CounterPhoneCacheClient } from "./counter-phone-cache-client"

export const dynamic = "force-dynamic"

/** See the adapter's docblock. No owner gate — the monitoring shell's note explains why. */
export default async function Page() {
  const session = await getServerSession(authOptions)
  if (!session) redirect("/login")

  const sections = getCacheSectionPromises()

  return (
    <>
      <CounterPhoneCacheClient sections={sections} />
      <span hidden data-perf-ready="/m/monitoring/cache" />
    </>
  )
}
