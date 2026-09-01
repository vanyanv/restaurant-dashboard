"use client"

import { Wordmark } from "@/components/counter"

/**
 * The shutdown notice, on a phone — `P.shutdown.phone()`.
 *
 * One button rather than the desk's two: the design drops "Email us" here, and
 * it is right to — a phone reader who wants their books wants the one action,
 * and the address is in the mail client either way.
 */
export function CounterPhoneShutdownClient({
  sinceLabel,
  preview,
}: {
  sinceLabel: string | null
  preview: boolean
}) {
  return (
    <main className="ct-root ct-phone plogin">
      <div className="login__logo" style={{ marginBottom: 8 }}>
        <Wordmark />
      </div>
      <h2 className="mtitle" style={{ textAlign: "center" }}>
        {preview ? "Shutdown notice" : "Service shut down"}
      </h2>
      <p
        style={{
          textAlign: "center",
          fontSize: "var(--ct-t-body)",
          color: "var(--ink-2)",
          margin: 0,
        }}
      >
        {preview
          ? "Nothing is shut down. This is what everyone but the owner would see if it were."
          : `Stopped running on ${sinceLabel}. The data is still here.`}
      </p>
      <a
        className="mbtn mbtn--primary"
        href="mailto:chris@chrisneddys.com?subject=Export%20request"
      >
        Request an export
      </a>
      <p className="mono" style={{ textAlign: "center", margin: 0 }}>
        Owners can still sign in.
      </p>
    </main>
  )
}
