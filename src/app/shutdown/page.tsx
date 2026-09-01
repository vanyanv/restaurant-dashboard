import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { CounterShutdownClient } from "./counter-shutdown-client"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Service shut down",
  robots: { index: false },
}

/**
 * The shutdown notice — `P.shutdown`.
 *
 * ## Why it can be previewed, and why the preview needs a session
 *
 * This page used to `redirect("/")` whenever `SERVICE_SHUTDOWN_AT` was unset,
 * which is correct for a stranger and made the page impossible to look at:
 * the one screen that replaces the entire product could only be seen by
 * arming the gate that replaces the entire product. The fidelity suite could
 * not measure it for the same reason, and neither could anyone reviewing the
 * copy.
 *
 * So `?preview=1` renders it for a SIGNED-IN reader. The session is the whole
 * safeguard: a stranger who guesses the URL still gets bounced to `/`, so
 * nobody is told the service has stopped while it is running. The preview says
 * plainly that nothing is shut down, so even the person who asked for it
 * cannot mistake it for the real thing.
 */
export default async function ShutdownPage({
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
        <CounterShutdownClient sinceLabel={null} days={null} preview />
        <span hidden data-perf-ready="/shutdown" />
      </>
    )
  }

  const since = new Date(`${shutdownAt}T00:00:00`)
  const days = Math.max(0, Math.floor((Date.now() - since.getTime()) / 86_400_000))
  const sinceLabel = since.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  return (
    <>
      <CounterShutdownClient sinceLabel={sinceLabel} days={days} preview={false} />
      <span hidden data-perf-ready="/shutdown" />
    </>
  )
}
