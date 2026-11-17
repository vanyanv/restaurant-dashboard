/**
 * A way for code that may also reach a browser bundle to report a server
 * error without importing Prisma.
 *
 * `guardSection` lives in `adapters/types.ts`, which client components import
 * for its types and helpers; a static import of `@/lib/monitoring/errors`
 * there would drag the database client toward the browser. Instead
 * `src/instrumentation.ts` installs the real recorder on `globalThis` when the
 * Node server starts, and this module only looks it up. In a browser, in the
 * edge runtime and in unit tests nothing is installed and a report is a no-op.
 */

export interface ServerErrorReport {
  source: "section" | "render" | "server-action" | "api" | "proxy"
  route?: string | null
  method?: string | null
  message: string
  stack?: string | null
  metadata?: Record<string, unknown> | null
}

type Recorder = (report: ServerErrorReport) => void | Promise<void>

const KEY = "__counterServerErrorRecorder__"

export function installServerErrorRecorder(recorder: Recorder): void {
  ;(globalThis as Record<string, unknown>)[KEY] = recorder
}

/**
 * Resolves once the report is written (or skipped). Never rejects. Callers on
 * a request's own path (`onRequestError`) await it so a serverless function is
 * not frozen mid-write; `guardSection` does not wait, the page comes first.
 */
export async function reportServerError(report: ServerErrorReport): Promise<void> {
  if (typeof window !== "undefined") return
  const recorder = (globalThis as Record<string, unknown>)[KEY] as Recorder | undefined
  if (!recorder) return
  try {
    await recorder(report)
  } catch {
    // Reporting must never break the page that is already failing.
  }
}
