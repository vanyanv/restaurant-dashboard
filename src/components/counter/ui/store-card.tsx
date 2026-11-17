import Link from "next/link"
import type { ReactNode } from "react"
import { Status, type StatusTone } from "./status"

export type StoreCardProps = {
  name: string
  status: { tone: StatusTone; label: string }
  figures: { label: string; value: string }[]
  note?: ReactNode
  href?: string
}

/**
 * One store at a glance: name, status in words, two or three figures, one
 * line of why.
 *
 * Shared block: replaces `.stcard` (desk), `.pstore`/`.prow` (phone),
 * `.pl-store`, `.iv-store`, `.ck-store` and `.cw-store`. Put them in a
 * `StoreCardGrid`: three across on the desk, stacked on the phone.
 */
export function StoreCard({ name, status, figures, note, href }: StoreCardProps) {
  const body = (
    <>
      <span className="cu-store__top">
        <span className="cu-store__name">{name}</span>
        <Status tone={status.tone}>{status.label}</Status>
      </span>
      <span className="cu-store__figs">
        {figures.map((f) => (
          <span key={f.label}>
            <span className="cu-store__k">{f.label}</span>
            <span className="cu-store__v">{f.value}</span>
          </span>
        ))}
      </span>
      {note ? <span className="cu-store__note">{note}</span> : null}
    </>
  )
  return href ? (
    <Link className="cu-card cu-store" href={href}>
      {body}
    </Link>
  ) : (
    <div className="cu-card cu-store">{body}</div>
  )
}

export function StoreCardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="cu-stores">
      <div className="cu-stores__in">{children}</div>
    </div>
  )
}
