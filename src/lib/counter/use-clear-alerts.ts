"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { clearAlerts, undoClearAlerts } from "@/lib/counter/actions/alert"
import type { ClearAlertsScope } from "@/app/actions/alerts/inbox-actions"

/** How long "Cleared 12 · Undo" stays up after a clear. */
const UNDO_MS = 10_000

export type ClearAlertsState =
  | { step: "idle" }
  | { step: "confirm" }
  | { step: "saving" }
  | { step: "cleared"; ids: string[]; at: string }
  | { step: "failed" }

/**
 * "Clear all" on Needs you, shared by the desk and the phone so the two make
 * the same decision in the same three steps: ask, confirm, then offer Undo.
 *
 * The desk passes the ids behind the rows it shows, so its confirm counts
 * exactly what is cleared. The phone draws six rows of a longer list, so it
 * passes its store and the server re-derives the open rows; its count is the
 * inbox's own open tally, not the six.
 */
export function useClearAlerts(scope: ClearAlertsScope) {
  const router = useRouter()
  const [state, setState] = useState<ClearAlertsState>({ step: "idle" })
  const [, startTransition] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => stopTimer, [])

  const ask = () => {
    stopTimer()
    setState({ step: "confirm" })
  }
  const cancel = () => setState({ step: "idle" })

  /*
   * A thrown action (a dropped connection, a database error) lands on
   * "failed" like a refused one, never on a "Saving…" with no way out.
   */
  const confirm = () => {
    setState({ step: "saving" })
    startTransition(async () => {
      try {
        const r = await clearAlerts(scope)
        if (!r.ok) {
          setState({ step: "failed" })
          return
        }
        setState({ step: "cleared", ids: r.ids, at: r.at })
        timer.current = setTimeout(() => setState({ step: "idle" }), UNDO_MS)
      } catch {
        setState({ step: "failed" })
      }
      // The list, the strip and the rail's count all read the same column.
      router.refresh()
    })
  }

  const undo = () => {
    if (state.step !== "cleared") return
    const { ids, at } = state
    stopTimer()
    setState({ step: "saving" })
    startTransition(async () => {
      try {
        const r = await undoClearAlerts(ids, at)
        setState(r.ok ? { step: "idle" } : { step: "failed" })
      } catch {
        setState({ step: "failed" })
      }
      router.refresh()
    })
  }

  return { state, ask, cancel, confirm, undo }
}

/** "Clear 12?" or "Clear 12, including 3 critical?" */
export function clearQuestion(total: number, critical: number): string {
  return critical > 0 ? `Clear ${total}, including ${critical} critical?` : `Clear ${total}?`
}
