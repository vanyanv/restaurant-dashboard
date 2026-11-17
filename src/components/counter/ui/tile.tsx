import Link from "next/link"
import type { ReactNode } from "react"

/**
 * A small figure in a box that usually goes somewhere: "To ship 3 · 1 late",
 * "Selling, not costed 4". Shop, Menu items, Invoices and the Store checks
 * report each drew their own (`.sh-tile`, `.ck-rep__tile`); this is that one
 * block.
 *
 * `bad` marks the whole tile as the thing to look at (red edge and wash).
 * `tone` only colours the number, for a row of counts where several can be
 * good or bad at once. An `href` makes the tile a link.
 */
export type TileTone = "good" | "warn" | "bad"

export function Tile({
  label,
  value,
  sub,
  href,
  bad,
  tone,
}: {
  label?: string
  value: ReactNode
  sub?: ReactNode
  href?: string
  bad?: boolean
  tone?: TileTone
}) {
  const cls = `cu-tile${bad ? " cu-tile--bad" : ""}${tone ? ` cu-tile--tone-${tone}` : ""}`
  const body = (
    <>
      {label ? <span className="cu-tile__label">{label}</span> : null}
      <span className="cu-tile__value">{value}</span>
      {sub ? <span className="cu-tile__sub">{sub}</span> : null}
    </>
  )
  return href ? (
    <Link className={cls} href={href}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** Tiles side by side: four across on the desk, two on a phone. */
export function Tiles({ children }: { children: ReactNode }) {
  return <div className="cu-tiles">{children}</div>
}
