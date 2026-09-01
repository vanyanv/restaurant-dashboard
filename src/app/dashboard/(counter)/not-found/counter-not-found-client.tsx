"use client"

import Link from "next/link"
import { usePageChrome } from "@/components/counter"

/**
 * The 404 — `P.notfound`.
 *
 * "A 404 that offers the three things people were probably looking for", and
 * the three are the design's own: Overview, Invoices, Ask.
 *
 * ## Why `.empty` is written here rather than reached for
 *
 * `state/Empty` is deliberately not exported from the Counter barrel — states
 * live in the builders (note 22), and a page that reached one directly would
 * be re-implementing state handling. This page is the exception that proves
 * the rule rather than a breach of it: the empty state is not a SECTION's
 * state here, it is the whole page, and there is no `SectionData` behind it to
 * resolve, fail or come back. There is nothing to build a state FROM.
 *
 * `Empty` would also be the wrong component if it could be used. It carries
 * three fixed reasons — `pre_open`, `no_match`, `all_clear` — none of which is
 * "this address has nothing at it", and its docblock records that its `.btn`
 * was dropped because it had nowhere to go. This page's three buttons have
 * somewhere to go, which is the entire point of it.
 */
export function CounterNotFoundClient() {
  usePageChrome({ leaf: "Not found" })

  return (
    <div className="empty" style={{ padding: "56px 20px" }}>
      <span className="t">There is nothing at that address</span>
      <span className="s">
        The link may be old, or the record may have been deleted. Here is where people
        usually meant to go.
      </span>
      <div className="btnrow" style={{ justifyContent: "center", marginTop: 10 }}>
        <Link className="btn btn--primary" href="/dashboard">
          Back to Overview
        </Link>
        <Link className="btn" href="/dashboard/invoices">
          Invoices
        </Link>
        <Link className="btn" href="/dashboard/ask">
          Ask the numbers
        </Link>
      </div>
    </div>
  )
}
