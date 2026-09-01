import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { CounterPhoneShutdownClient } from "./counter-phone-shutdown-client"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Service shut down",
  robots: { index: false },
}

/**
 * `P.shutdown.phone()`, and it lives under `/shutdown` rather than `/m`
 * deliberately.
 *
 * `P.shutdown` is `bare: true` on both surfaces — no rail, no topbar, no tab
 * bar — and every route under `/m` inherits `(mobile)/m/layout.tsx`, which
 * renders the phone tab bar. A shut-down service showing five tabs into the
 * product it just stopped serving is the wrong page. Nesting has no opt-out in
 * the App Router, so the route sits outside that segment instead.
 *
 * Same preview rule as its desk twin — see that page's note.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const shutdownAt = process.env.SERVICE_SHUTDOWN_AT
  const sp = await searchParams
  const wantsPreview = sp.preview === "1"

  if (!shutdownAt) {
    if (!wantsPreview) redirect("/")
    const session = await getServerSession(authOptions)
    if (!session) redirect("/")
    return (
      <>
        <CounterPhoneShutdownClient sinceLabel={null} preview />
        <span hidden data-perf-ready="/shutdown/phone" />
      </>
    )
  }

  const since = new Date(`${shutdownAt}T00:00:00`)
  const sinceLabel = since.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  return (
    <>
      <CounterPhoneShutdownClient sinceLabel={sinceLabel} preview={false} />
      <span hidden data-perf-ready="/shutdown/phone" />
    </>
  )
}
