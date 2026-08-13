"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

const ENDPOINT = "/api/telemetry/page-view"

type Entry = { path: string; enteredAt: number; flushed: boolean }

/**
 * Records what the user actually looked at, and for how long.
 *
 * Deliberately client-side rather than middleware: middleware fires on RSC
 * prefetches, so <Link> hover would inflate visit counts with pages nobody
 * opened, and it could not measure dwell at all. Dwell is the whole point —
 * "opened /pnl 40 times" and "opened /pnl 40 times and bounced in 2s" are
 * opposite findings.
 */
export function PageViewTracker({ enabled }: { enabled: boolean }) {
  const pathname = usePathname()
  const current = useRef<Entry | null>(null)

  useEffect(() => {
    if (!enabled || !pathname) return

    flush(current.current)
    current.current = { path: pathname, enteredAt: Date.now(), flushed: false }

    const onHide = () => {
      if (document.visibilityState === "hidden") flush(current.current)
    }
    const onPageHide = () => flush(current.current)

    document.addEventListener("visibilitychange", onHide)
    window.addEventListener("pagehide", onPageHide)
    return () => {
      flush(current.current)
      document.removeEventListener("visibilitychange", onHide)
      window.removeEventListener("pagehide", onPageHide)
    }
  }, [pathname, enabled])

  return null
}

/** Idempotent per entry: pagehide followed by unmount must write once, and
 * React strict-mode's double effect must not double-count. */
function flush(entry: Entry | null): void {
  if (!entry || entry.flushed) return
  entry.flushed = true

  const payload = JSON.stringify({
    path: entry.path,
    enteredAt: entry.enteredAt,
    dwellMs: Date.now() - entry.enteredAt,
  })

  try {
    // sendBeacon survives unload; fetch+keepalive is the fallback.
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }))
      return
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Tracking must never break navigation.
  }
}
