import Link from "next/link"
import type { ReactNode } from "react"

export type StatusTone = "good" | "warn" | "bad" | "wait" | "off"

type Look = {
  tone: StatusTone
  children: ReactNode
  /** Dot and words only, no fill: for a status inside a list row. */
  plain?: boolean
}

function cls(tone: StatusTone, plain?: boolean) {
  return `cu-status cu-status--${tone}${plain ? " cu-status--plain" : ""}`
}

/**
 * Status in words with a coloured dot. One look on every page and both
 * screen sizes.
 *
 * Shared block: replaces `.statuspill`, `.mtag`, `.pl-pill`, `.iv-pill`,
 * `.inv-pill`, `.pp-pill`, `.rs-pill`, `.st` and friends. `wait` is
 * "waiting on data": a dashed outline, never a colour that reads as good or
 * bad. `off` is settled and out of the way (rejected, closed).
 *
 * `href` makes it a link and `onClick` a button, with the same look.
 */
export function Status({
  tone,
  children,
  plain,
  href,
  onClick,
}: Look & { href?: string; onClick?: () => void }) {
  if (href !== undefined) {
    return (
      <Link className={cls(tone, plain)} href={href}>
        {children}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" className={cls(tone, plain)} onClick={onClick}>
        {children}
      </button>
    )
  }
  return <span className={cls(tone, plain)}>{children}</span>
}

/** A row of statuses that wraps. */
export function Statuses({ children }: { children: ReactNode }) {
  return <div className="cu-statuses">{children}</div>
}
