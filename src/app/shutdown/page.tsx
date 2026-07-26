import { redirect } from "next/navigation"
import { Fraunces } from "next/font/google"
import "@/styles/editorial-tokens.css"
import "@/styles/editorial-auth.css"

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
})

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Service shut down",
  robots: { index: false },
}

export default function ShutdownPage() {
  const shutdownAt = process.env.SERVICE_SHUTDOWN_AT
  if (!shutdownAt) {
    redirect("/")
  }

  const since = new Date(`${shutdownAt}T00:00:00`)
  const days = Math.max(
    0,
    Math.floor((Date.now() - since.getTime()) / 86_400_000)
  )
  const sinceLabel = since.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  return (
    <div
      className={`${fraunces.variable} editorial-surface`}
      style={{ minHeight: "100vh" }}
    >
      <div className="missing-dispatch full-bleed">
        <span className="brand-seal" aria-hidden="true">
          <span className="brand-seal__mark">C·N</span>
        </span>
        <div className="dispatch-issue">ChrisnEddys · Final dispatch</div>
        <div className="dispatch-rule" aria-hidden="true" />
        <div className="dispatch-bracket" aria-hidden="true">
          <span>&#x2e27;</span>
          <span>&#x2e28;</span>
        </div>
        <div className="dispatch-number">503</div>
        <h1 className="dispatch-title">
          This service has been <em>shut down</em>.
        </h1>
        <p className="dispatch-caption">
          Out of service since {sinceLabel} — {days}{" "}
          {days === 1 ? "day" : "days"} and counting.
        </p>
      </div>
    </div>
  )
}
