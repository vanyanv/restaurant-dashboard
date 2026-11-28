import type { Instrumentation } from "next"

/**
 * Next instrumentation hook. Runs once per server process start.
 *
 * Three things land in `ErrorEvent` (the error log on Monitoring) from here:
 *   - uncaught process errors (`attachNodeErrorHandlers`),
 *   - every request Next itself caught failing — a page that would not
 *     render, a server action or API route that threw (`onRequestError`),
 *   - a single section of a page that failed while the rest still showed
 *     (`guardSection` reports through the recorder installed below).
 * Before this, the last two went only to Vercel's runtime log, which keeps an
 * hour on the current plan, so a page that broke overnight left no trace.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { attachNodeErrorHandlers } = await import("@/lib/monitoring/node-handlers")
  attachNodeErrorHandlers()

  const [{ recordError }, { installServerErrorRecorder }, { createDedupe, ERROR_DEDUPE_MS }] =
    await Promise.all([
      import("@/lib/monitoring/errors"),
      import("@/lib/monitoring/server-error-hook"),
      import("@/lib/monitoring/error-dedupe"),
    ])
  const shouldRecord = createDedupe(ERROR_DEDUPE_MS)
  installServerErrorRecorder((report) => {
    const where = report.route ?? String(report.metadata?.section ?? "")
    const digest = String(report.metadata?.digest ?? "")
    if (!shouldRecord(`${report.source}|${where}|${report.message}|${digest}`)) return
    return recordError(report)
  })
}

const ROUTE_SOURCE = {
  render: "render",
  route: "api",
  action: "server-action",
  proxy: "proxy",
} as const

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { reportServerError } = await import("@/lib/monitoring/server-error-hook")
  const err = error instanceof Error ? error : new Error(String(error))
  await reportServerError({
    source: ROUTE_SOURCE[context.routeType] ?? "render",
    // A TV's token is in these two paths and is its only credential: keep it out of the error log.
    route: (request.path.split("?")[0] ?? request.path).replace(/^\/api\/tv\/(c|beat)\/[^/]+/, "/api/tv/$1/:token"),
    method: request.method,
    message: err.message,
    stack: err.stack ?? null,
    metadata: {
      routePath: context.routePath,
      routerKind: context.routerKind,
      digest: (err as Error & { digest?: string }).digest ?? null,
    },
  })
}
