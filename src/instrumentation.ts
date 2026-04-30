/**
 * Next 15 instrumentation hook. Runs once per server process start.
 * Attaches Node-side handlers for uncaught errors so they land in
 * ErrorEvent instead of disappearing into stderr.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { attachNodeErrorHandlers } = await import("@/lib/monitoring/node-handlers")
  attachNodeErrorHandlers()
}
