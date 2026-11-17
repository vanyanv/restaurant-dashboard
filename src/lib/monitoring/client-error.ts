import { createDedupe, ERROR_DEDUPE_MS } from "@/lib/monitoring/error-dedupe"

/**
 * Send a browser-side failure to the error log on Monitoring.
 *
 * Until this existed, a page that broke on a phone wrote to that phone's
 * browser console and nowhere else. Safe to call from anywhere in the
 * browser: it never throws, never waits, and sends at most `MAX_PER_LOAD`
 * reports per page load, each distinct one once per ten minutes.
 */
export const CLIENT_ERROR_ENDPOINT = "/api/telemetry/client-error"
const MAX_PER_LOAD = 10

const shouldSend = createDedupe(ERROR_DEDUPE_MS, 50)
let sent = 0

export interface ClientErrorReport {
  /** What caught it: "route", "global", "window", "rejection", or a component name. */
  kind: string
  message: string
  stack?: string | null
  /** Next's server-side reference, when the error came from a server render. */
  digest?: string | null
}

export function reportClientError(report: ClientErrorReport): void {
  try {
    if (typeof window === "undefined") return
    if (sent >= MAX_PER_LOAD) return
    const path = window.location.pathname
    const message = report.message || "(no message)"
    if (!shouldSend(`${report.kind}|${path}|${message}|${report.digest ?? ""}`)) return
    sent++
    const body = JSON.stringify({
      kind: report.kind.slice(0, 40),
      path,
      message: message.slice(0, 2000),
      stack: report.stack?.slice(0, 8000) ?? null,
      digest: report.digest ?? null,
    })
    const blob = new Blob([body], { type: "application/json" })
    if (navigator.sendBeacon?.(CLIENT_ERROR_ENDPOINT, blob)) return
    void fetch(CLIENT_ERROR_ENDPOINT, { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {})
  } catch {
    // Reporting must never add a second failure to the first.
  }
}

/** Test seam: forget what was sent. */
export function resetClientErrorReporter(): void {
  sent = 0
}
