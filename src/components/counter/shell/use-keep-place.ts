"use client"

import { useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

/**
 * "Pick up where you left off", the half that lives in the browser. The
 * other half is the proxy sending a signed-out visitor to
 * `/login?callbackUrl=…` (see `src/lib/return-to.ts`).
 *
 * 1. Keeps the session alive while it is used. A JWT session is only renewed
 *    when `/api/auth/session` is read, and nothing on a Counter page reads it
 *    (no SessionProvider), so a busy owner still timed out on the fixed
 *    clock. One read a day per browser pushes the 30-day expiry forward.
 *
 * 2. On the phone, remembers the last page (path + store/date query) and,
 *    when the home-screen app is launched fresh, reopens it. iOS starts an
 *    installed app at the manifest's `start_url` (`/m`, Today) every time it
 *    was closed in the background, and already-installed icons keep the
 *    start URL they were added with, so this cannot be done in the manifest.
 *    "Fresh launch" = standalone display, on bare `/m`, and no mark in
 *    sessionStorage yet (which dies with the app). Tapping Today later in the
 *    same session finds the mark and stays on Today.
 */
const TOUCH_KEY = "ct-session-touched-at"
const PLACE_KEY = "ct-last-place"
const LAUNCH_KEY = "ct-launched"
const DAY_MS = 24 * 60 * 60 * 1000
const PLACE_MAX_AGE_MS = 7 * DAY_MS

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

function write(storage: () => Storage, key: string, value: string) {
  try {
    storage().setItem(key, value)
  } catch {
    /* private mode or blocked storage: nothing to keep */
  }
}

const local = () => window.localStorage
const session = () => window.sessionStorage

function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true
}

export function useKeepPlace(phone: boolean) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const query = searchParams.toString()

  // 1. Renew the session at most once a day.
  useEffect(() => {
    const last = Number(read(local, TOUCH_KEY) ?? 0)
    if (Date.now() - last < DAY_MS) return
    write(local, TOUCH_KEY, String(Date.now()))
    fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" }).catch(() => {})
  }, [])

  // 2a. Fresh launch of the home-screen app on Today: go back to the last page.
  useEffect(() => {
    if (!phone) return
    const launched = read(session, LAUNCH_KEY)
    write(session, LAUNCH_KEY, "1")
    if (launched || !isStandalone()) return
    if (window.location.pathname !== "/m" || window.location.search) return
    try {
      const saved = JSON.parse(read(local, PLACE_KEY) ?? "null") as { href?: string; at?: number } | null
      const href = saved?.href
      if (!href || !href.startsWith("/m/") || href.startsWith("/m/login")) return
      if (Date.now() - (saved.at ?? 0) > PLACE_MAX_AGE_MS) return
      router.replace(href, { scroll: false })
    } catch {
      /* unreadable entry: stay on Today */
    }
    // Once per mount; the shell does not remount between tabs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2b. Remember where the phone is now.
  useEffect(() => {
    if (!phone || !pathname || pathname.startsWith("/m/login")) return
    const href = query ? `${pathname}?${query}` : pathname
    write(local, PLACE_KEY, JSON.stringify({ href, at: Date.now() }))
  }, [phone, pathname, query])
}
