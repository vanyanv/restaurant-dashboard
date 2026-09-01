"use client"

import type { ReactNode } from "react"

/** How long the `prefer-desktop` cookie holds, matching the editorial switch. */
const PREFER_DESKTOP_SECONDS = 60 * 60 * 24 * 7

/**
 * A phone control that hands the reader to a DESK route.
 *
 * ## Why this is not a `<Link>`
 *
 * It was one, on the phone store file, and it could not work: `src/proxy.ts`
 * redirects `/dashboard/**` back to the matching `/m/**` on a phone user
 * agent, so a link from `/m/stores/<id>` to `/dashboard/stores/<id>` lands
 * exactly where it started. The button looked like a handoff and was a
 * refresh. Setting `prefer-desktop` first is what the editorial
 * `SwitchToDesktopButton` has always done, and it is what makes the
 * destination reachable at all.
 *
 * A full page load rather than a client navigation, deliberately: the router
 * would not re-run the proxy, and the cookie only takes effect on a request
 * that reaches it.
 *
 * The cookie lasts a week and is the same one the editorial switch writes, so
 * a reader who uses either gets one desktop preference rather than two that
 * disagree.
 */
export function DeskHandoff({
  href,
  children,
  primary = true,
}: {
  href: string
  children: ReactNode
  primary?: boolean
}) {
  return (
    <button
      type="button"
      className={primary ? "mbtn mbtn--primary" : "mbtn"}
      onClick={() => {
        document.cookie = `prefer-desktop=1; Max-Age=${PREFER_DESKTOP_SECONDS}; Path=/; SameSite=Lax`
        window.location.href = href
      }}
    >
      {children}
    </button>
  )
}
