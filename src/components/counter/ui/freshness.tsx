"use client"

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, useTransition } from "react"
import { useRouter } from "next/navigation"
import { actMarks, DONE_MS, type ActState } from "./act"

const noop = () => () => {}

/**
 * Set while a refresh this block asked for is on its way. The refreshed
 * page often re-mounts the block (its section suspends again), so the new
 * copy reads this to know it is the answer and should say "Up to date".
 */
let refreshing = false

/** "8:14 am", in the viewer's own time. */
export function freshTime(ms: number): string {
  return new Date(ms)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(" AM", " am")
    .replace(" PM", " pm")
}

/**
 * How fresh the page's numbers are, with the way to get newer ones:
 * "Updated 8:14 am · Refresh".
 *
 * Counter pages do not update on their own while you read them (so nothing
 * moves under you and there is nothing to pause); this line says when the
 * figures on screen were fetched and lets you ask for them again. The time
 * is when this page's data reached the browser, set again when a refresh
 * finishes, never a guess at when a store last synced. Shown after mount
 * only, so the server's clock never mismatches the browser's.
 *
 * Shared block: sits under a Made Plain page's `Answer`.
 */
export function Freshness() {
  const router = useRouter()
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  const [at, setAt] = useState(() => Date.now())
  const [pending, start] = useTransition()
  const [state, setState] = useState<ActState>(() => (refreshing ? "done" : "idle"))
  const asked = useRef(false)
  useEffect(() => {
    refreshing = false
  }, [])

  // router.refresh() keeps the transition pending until the new figures have
  // rendered, so "done" is only said once they are on screen.
  const settled = useEffectEvent(() => {
    setAt(Date.now())
    setState("done")
  })
  useEffect(() => {
    if (pending || !asked.current) return
    asked.current = false
    refreshing = false
    settled()
  }, [pending])
  useEffect(() => {
    if (state !== "done") return
    const t = setTimeout(() => setState("idle"), DONE_MS)
    return () => clearTimeout(t)
  }, [state])

  const refresh = () => {
    asked.current = true
    refreshing = true
    start(() => router.refresh())
  }
  const shown: ActState = pending ? "busy" : state

  return (
    <p className="cu-fresh" aria-live="polite">
      <span>{mounted ? `Updated ${freshTime(at)}` : "Updated just now"}</span>
      <span aria-hidden="true"> · </span>
      <button {...actMarks(shown)} type="button" className="cu-fresh__go" disabled={pending} onClick={refresh}>
        {shown === "done" ? "✓ Up to date" : "Refresh"}
      </button>
    </p>
  )
}
