"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { toneStyle, type Tone } from "./tone"
import { useFreshKeys } from "@/components/counter/motion/use-fresh-keys"

export type QueueItem = {
  key: string
  tone: Tone
  lead: string
  unit?: string
  title: string
  body: ReactNode
} & (
  | /** A row whose act is a page action (a client handler). */
  { act: string; onAct: () => void; href?: never }
  | /** A row whose act is a destination. */
  { act: string; href: string; onAct?: never }
  | { act?: undefined; onAct?: undefined; href?: never }
) & {
  decide?: ReactNode
}

/**
 * The queue of what needs the reader.
 *
 * Rows stagger in on mount (the generated sheet's own `.qitem` rule). A row
 * that ARRIVES while the page is up is a different thing from a row that was
 * rendered: it is the one operational change a normal day has, so it rises
 * with the bad cool-down and its lead lands (`is-new`, tier 2). `useFreshKeys`
 * tells the two apart, and `scope` is what makes a range change, which
 * replaces every row, count as the reader's own act and ring at nothing.
 * Callers that never change data while mounted may leave `scope` alone.
 */
export function Queue({ items, scope = "" }: { items: QueueItem[]; scope?: string }) {
  const fresh = useFreshKeys(
    items.map((i) => i.key),
    scope,
  )
  return (
    <div className="queue">
      {items.map((i) => (
        <div className={fresh.has(i.key) ? "qitem is-new" : "qitem"} key={i.key}>
          <span className="lead" style={toneStyle(i.tone)}>
            {i.lead}
            {i.unit ? <em>{i.unit}</em> : null}
          </span>
          <div>
            <b>{i.title}</b>
            <p>{i.body}</p>
            {i.act && i.href ? (
              <Link className="do" href={i.href}>
                {i.act}
              </Link>
            ) : i.act ? (
              <button className="do" type="button" onClick={i.onAct}>
                {i.act}
              </button>
            ) : null}
            {i.decide}
          </div>
        </div>
      ))}
    </div>
  )
}
