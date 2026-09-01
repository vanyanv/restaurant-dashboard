"use client"

import Link from "next/link"

/**
 * The 404, on a phone — `P.notfound.phone()`.
 *
 * Shorter than the desk's on purpose: one `.empty` and one button back to
 * Today. The desk offers three destinations because a desk reader arrived by
 * following a link and may have meant any of them; a phone reader arrived by
 * tapping, and the tab bar under this page is already the other four.
 */
export function CounterPhoneNotFoundClient() {
  return (
    <>
      <div className="empty" style={{ padding: "44px 12px" }}>
        <span className="t">Nothing here</span>
        <span className="s">The link may be old, or the record deleted.</span>
      </div>
      {/* `.mbtn`, outside the state and carrying no landmark class — the
          design's own shape. */}
      <Link className="mbtn mbtn--primary" href="/m">
        Back to Today
      </Link>
    </>
  )
}
