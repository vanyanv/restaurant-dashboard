"use client"

import Link from "next/link"
import { Lede, usePageChrome } from "@/components/counter"

/**
 * No access — `P.forbidden`.
 *
 * The design's own words, and they are specific: "Monitoring is developer-only
 * … yours is an owner account." That sentence was a claim this product did not
 * keep until the `admin` segment got the gate that sends a reader here — see
 * `src/app/dashboard/(counter)/admin/layout.tsx`.
 *
 * `.empty` is hand-written for the same reason the 404's is, and that page's
 * client argues it at length: `state/Empty` is withheld from the barrel
 * because states belong to the builders, and here the empty state is the whole
 * page rather than a section's, with no `SectionData` behind it to resolve.
 *
 * WHAT THIS PAGE MUST NOT DO is name what was on the page you were refused.
 * The design says so in bold — "The page never says what was on it" — and the
 * gate honours it by passing nothing: no `?from=`, no breadcrumb, no title.
 * A refusal that leaks the thing it refused is not a refusal.
 */
export function CounterForbiddenClient({ email, roleLabel }: { email: string; roleLabel: string }) {
  usePageChrome({ leaf: "No access" })

  return (
    <>
      <div className="empty" style={{ padding: "52px 20px" }}>
        <span className="t">Monitoring is developer-only</span>
        <span className="s">
          You followed a link to a page your account cannot open. Nothing is wrong with
          your sign-in — this page is restricted to developer accounts, and yours is
          {roleLabel === "Owner" ? " an owner" : " a developer"} account.
        </span>
        <div className="btnrow" style={{ justifyContent: "center", marginTop: 10 }}>
          <Link className="btn btn--primary" href="/dashboard">
            Go to Overview
          </Link>
          {/* A mailto, like the shutdown notice's two actions. There is no
              request-access record in this product to write, and inventing one
              behind a button that looks like it already works would be worse
              than a link that plainly opens mail. */}
          <a
            className="btn"
            href={`mailto:demo@restaurantos.com?subject=${encodeURIComponent(
              "Access to monitoring",
            )}&body=${encodeURIComponent(`Signed in as ${email}.`)}`}
          >
            Ask Vardan for access
          </a>
        </div>
      </div>

      <div className="sec">
        <div className="sec__head">
          <h3>Why you are seeing this</h3>
          <span className="k">and not a blank page</span>
        </div>
        <div className="sec__body">
          <Lede last>
            Signing in returns you to whatever you were trying to reach. That is the
            right behaviour — and it means a link shared into the wrong hands lands here
            rather than nowhere. <b>The page never says what was on it.</b>
          </Lede>
        </div>
      </div>
    </>
  )
}
