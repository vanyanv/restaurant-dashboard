"use client"

import { useEffect } from "react"
import { reportClientError } from "@/lib/monitoring/client-error"

/**
 * Catches browser errors no boundary sees — a failed save handler, a timer,
 * a promise nobody awaited — and sends them to the error log. Boundaries
 * (`RouteFailed`, `global-error`) report their own catches.
 */
export function ClientErrorListener() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      // Cross-origin script errors arrive as "Script error." with no detail; nothing to act on.
      if (!e.error && (!e.message || e.message === "Script error.")) return
      reportClientError({
        kind: "window",
        message: e.error instanceof Error ? e.error.message : e.message,
        stack: e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}:${e.colno}`,
      })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const r: unknown = e.reason
      // A navigation that cancels an in-flight request rejects with AbortError; not a fault.
      if (r instanceof DOMException && r.name === "AbortError") return
      reportClientError({
        kind: "rejection",
        message: r instanceof Error ? r.message : String(r),
        stack: r instanceof Error ? r.stack : null,
      })
    }
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)
    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [])
  return null
}
