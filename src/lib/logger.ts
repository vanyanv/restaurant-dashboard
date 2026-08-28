/**
 * The application logger.
 *
 * ## `error` and `warn` reach production; `info` and `debug` do not
 *
 * That split is the whole point of this module, and it used to be the other
 * way round by accident: every level was wrapped in `if (isDev)`, so all four
 * were silent in production. The 49 `logger.error`/`logger.warn` call sites
 * are almost all RECOVERED failures — the Redis limiter falling back to
 * in-memory, a per-store Otter sync failing, an R2 delete failing, a chat turn
 * failing to persist — which is to say the failures that produce no stack
 * trace, no 500 and no user complaint. They are the only signal that the
 * system is degrading, and they were being discarded.
 *
 * `src/instrumentation.ts` captures UNCAUGHT errors into `ErrorEvent`, so the
 * monitoring dashboards looked healthy the whole time. Nothing was watching
 * the handled paths.
 *
 * `info` and `debug` stay dev-only deliberately: they are per-row and per-loop
 * traces in the sync code, and on Vercel every line is billed and retained.
 *
 * Vercel captures stderr/stdout per invocation, so `console.error` here is
 * enough to make a failure visible in the runtime log without any transport.
 */
const isDev = process.env.NODE_ENV !== "production"

export const logger = {
  /** Always emitted. A handled failure nobody can see is a failure nobody fixes. */
  error: (...args: unknown[]) => {
    console.error(...args)
  },
  /** Always emitted, for the same reason as `error`. */
  warn: (...args: unknown[]) => {
    console.warn(...args)
  },
  info: (...args: unknown[]) => {
    if (isDev) console.info(...args)
  },
  debug: (...args: unknown[]) => {
    if (isDev) console.debug(...args)
  },
}
