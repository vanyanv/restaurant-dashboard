"use client"

import Link from "next/link"

/**
 * No access, on a phone — `P.forbidden.phone()`.
 *
 * Two sentences and one button, where the desk has a whole section explaining
 * itself. The design makes the same cut on the 404, and it is the right one:
 * a phone reader tapped something, and the explanation of how sign-in returns
 * you to the link you followed is a desk reader's question.
 */
export function CounterPhoneForbiddenClient({ roleLabel }: { roleLabel: string }) {
  return (
    <>
      <div className="empty" style={{ padding: "40px 12px" }}>
        <span className="t">Not yours to open</span>
        <span className="s">
          Monitoring is developer-only. Your account is
          {roleLabel === "Owner" ? " an owner" : " a developer"} account.
        </span>
      </div>
      <Link className="mbtn mbtn--primary" href="/m">
        Go to Today
      </Link>
    </>
  )
}
