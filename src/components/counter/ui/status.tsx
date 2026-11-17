import type { ReactNode } from "react"

export type StatusTone = "good" | "warn" | "bad" | "wait"

/**
 * Status in words with a coloured dot. One look on every page and both
 * screen sizes.
 *
 * Shared block: replaces `.statuspill`, `.mtag`, `.pl-pill`, `.iv-pill`,
 * `.inv-pill`, `.pp-pill`, `.rs-pill` and friends. `wait` is "waiting on
 * data": a dashed outline, never a colour that reads as good or bad.
 */
export function Status({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`cu-status cu-status--${tone}`}>{children}</span>
}
