"use client"

import { Wordmark } from "@/components/counter"

/**
 * The shutdown notice — `P.shutdown`.
 *
 * "Live in production today: everyone but the owner lands here", which is the
 * prototype's own note and the reason this page is written as though a
 * customer is reading it rather than a developer.
 *
 * Both buttons are `mailto:` links, and that is not a shortcut. The page's own
 * copy is "the data is still here and can be exported on request" — ON
 * REQUEST is a person writing to a person, and there is no export endpoint
 * behind it to pretend otherwise. A `mailto` does exactly what the sentence
 * says it does, which is the test every other button in this product has had
 * to pass tonight.
 */
export function CounterShutdownClient({
  sinceLabel,
  days,
  preview,
}: {
  sinceLabel: string | null
  days: number | null
  preview: boolean
}) {
  return (
    <main className="ct-root login" style={{ gridTemplateColumns: "1fr" }}>
      <div className="login__form" style={{ maxWidth: 540 }}>
        <div className="login__logo">
          <Wordmark />
          <span className="cap">Operations</span>
        </div>

        <h1>{preview ? "This is the shutdown notice" : "This service has been shut down"}</h1>
        <p className="sub">
          {preview ? (
            <>
              Nothing is shut down. This is what everyone but the owner would see if it
              were, and it is here so the notice can be read before it is needed rather
              than after.
            </>
          ) : (
            <>
              Chris Neddy&rsquo;s Operations stopped running on <b>{sinceLabel}</b>. Nothing
              is lost — the data is still here and can be exported on request.
            </>
          )}
        </p>

        <div className="loginstat" style={{ marginTop: 6 }}>
          <div>
            <span className="k">Status</span>
            <span className="v">{preview ? "Running" : "Stopped"}</span>
          </div>
          <div>
            <span className="k">Stopped</span>
            <span className="v">{sinceLabel ?? "Not scheduled"}</span>
          </div>
          <div>
            <span className="k">Export</span>
            <span className="v">On request</span>
          </div>
        </div>

        <div className="btnrow" style={{ justifyContent: "center" }}>
          <a
            className="btn btn--primary"
            href="mailto:chris@chrisneddys.com?subject=Export%20request"
          >
            Request an export
          </a>
          <a className="btn" href="mailto:chris@chrisneddys.com?subject=Chris%20N%20Eddy%27s%20Operations">
            Email us
          </a>
        </div>

        <p className="mono" style={{ textAlign: "center", margin: "4px 0 0" }}>
          {days !== null && days > 0
            ? `Owners can still sign in to retrieve their books · ${days} ${days === 1 ? "day" : "days"} since`
            : "Owners can still sign in to retrieve their books."}
        </p>
      </div>
    </main>
  )
}
