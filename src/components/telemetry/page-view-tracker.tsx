"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import {
  stepTracker,
  type TrackerEntry,
  type TrackerEvent,
} from "@/lib/monitoring/page-view"

const ENDPOINT = "/api/telemetry/page-view"

/**
 * Records what the user actually looked at, and for how long.
 *
 * Deliberately client-side rather than middleware: middleware fires on RSC
 * prefetches, so <Link> hover would inflate visit counts with pages nobody
 * opened, and it could not measure dwell at all. Dwell is the whole point —
 * "opened /pnl 40 times" and "opened /pnl 40 times and bounced in 2s" are
 * opposite findings.
 *
 * All the lifecycle rules live in `stepTracker`, which is pure and tested.
 * What remains here is listeners, a ref, and a fire-and-forget POST.
 */
export function PageViewTracker({ enabled }: { enabled: boolean }) {
  const pathname = usePathname()
  const current = useRef<TrackerEntry | null>(null)

  useEffect(() => {
    if (!enabled || !pathname) return

    const step = (event: TrackerEvent) => {
      const { next, emit } = stepTracker(
        current.current,
        event,
        pathname,
        Date.now(),
      )
      current.current = next
      if (emit) send(emit)
    }

    step("navigate")

    const onVisibility = () =>
      step(document.visibilityState === "hidden" ? "hide" : "show")
    const onPageHide = () => step("hide")
    // A bfcache restore fires pageshow without a visibilitychange, and the page
    // may have sat in the cache for hours — start a fresh measured view.
    const onPageShow = () => step("show")

    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", onPageHide)
    window.addEventListener("pageshow", onPageShow)
    return () => {
      step("unmount")
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", onPageHide)
      window.removeEventListener("pageshow", onPageShow)
    }
  }, [pathname, enabled])

  return null
}

/** Best effort in every direction: tracking must never break navigation, and
 * a dropped beacon is an acceptable loss. */
function send(payload: {
  path: string
  enteredAt: number
  dwellMs: number
}): void {
  const body = JSON.stringify(payload)
  try {
    // sendBeacon survives unload; fetch+keepalive is the fallback.
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))
      return
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Swallowed on purpose.
  }
}
