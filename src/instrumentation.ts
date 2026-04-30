/**
 * Next 15 instrumentation hook. Runs once per server process start.
 * Attaches Node-side handlers for uncaught errors so they land in
 * ErrorEvent instead of disappearing into stderr.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  const { recordError } = await import("@/lib/monitoring/errors")

  process.on("uncaughtException", (err) => {
    void recordError({
      source: "uncaught",
      message: err.message,
      stack: err.stack,
    })
  })

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    void recordError({
      source: "uncaught",
      message: err.message,
      stack: err.stack,
    })
  })
}
