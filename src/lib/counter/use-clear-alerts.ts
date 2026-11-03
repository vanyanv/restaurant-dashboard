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
  | { step: "cleared"; ids: string[] }
  | { step: "failed" }

/**
 * "Clear all" on Needs you, shared by the desk and the phone so the two make
 * the same decision in the same three steps: ask, confirm, then offer Undo.
 *
 * The scope is the reader's current view (store, and on the desk the severity,
 * source and search filters). The server re-derives the open rows from it
 * rather than trusting a list of ids from the page, because the page holds a
 * capped window (100 rows on the desk, six on the phone) and "all" has to mean
 * all of them.
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

  const confirm = () => {
    setState({ step: "saving" })
    startTransition(async () => {
      const r = await clearAlerts(scope)
      if (!r.ok) {
        setState({ step: "failed" })
        return
      }
      setState({ step: "cleared", ids: r.ids })
      timer.current = setTimeout(() => setState({ step: "idle" }), UNDO_MS)
      // The list, the strip and the rail's count all read the same column.
      router.refresh()
    })
  }

  const undo = () => {
    if (state.step !== "cleared") return
    const ids = state.ids
    stopTimer()
    setState({ step: "saving" })
    startTransition(async () => {
      const r = await undoClearAlerts(ids)
      setState(r.ok ? { step: "idle" } : { step: "failed" })
      router.refresh()
    })
  }

  return { state, ask, cancel, confirm, undo }
}

/** "Clear 12?" or "Clear 12, including 3 critical?" */
export function clearQuestion(total: number, critical: number): string {
  return critical > 0 ? `Clear ${total}, including ${critical} critical?` : `Clear ${total}?`
}
