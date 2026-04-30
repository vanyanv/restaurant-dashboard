import { recordError } from "@/lib/monitoring/errors"

const flag = "__monitoring_hooked__" as const

export function attachNodeErrorHandlers() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((process as any)[flag]) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process as any)[flag] = true

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
