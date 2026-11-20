import Link from "next/link"
import type { ReactNode } from "react"
import { Status, type StatusTone } from "./status"

export type StoreCardProps = {
  name: string
  status: { tone: StatusTone; label: string }
  figures: { label: string; value: string }[]
  note?: ReactNode
  href?: string
  /** Pressing the card does something on this page (e.g. scopes it to the store). */
  onClick?: () => void
  /**
   * The next few figures an owner goes looking for. With these the card opens
   * in place instead of leaving the row, so two stores can be open side by
   * side; `href`/`onClick` become one button inside the opened part.
   */
  more?: { label: string; value: string }[]
  /** Words for that button, e.g. "Show only Hollywood". */
  moreAction?: string
}

/**
 * One store at a glance: name, status in words, two or three figures, one
 * line of why.
 *
 * Shared block: replaces `.stcard` (desk), `.pstore`/`.prow` (phone),
 * `.pl-store`, `.iv-store`, `.ck-store` and `.cw-store`. Put them in a
 * `StoreCardGrid`: three across on the desk, stacked on the phone.
 *
 * With `more`, the card is a native `<details>`: it opens with the keyboard,
 * needs no script, and slides open the way a `Fold` does.
 */
export function StoreCard({ name, status, figures, note, href, onClick, more, moreAction }: StoreCardProps) {
  const body = (
    <>
      <span className="cu-store__top">
        <span className="cu-store__name">{name}</span>
        <Status tone={status.tone}>{status.label}</Status>
      </span>
      {figures.length > 0 ? (
        <span className="cu-store__figs">
          {figures.map((f) => (
            <span key={f.label}>
              <span className="cu-store__k">{f.label}</span>
              <span className="cu-store__v">{f.value}</span>
            </span>
          ))}
        </span>
      ) : null}
      {note ? <span className="cu-store__note">{note}</span> : null}
    </>
  )
  if (more && more.length > 0) {
    const action = moreAction ?? `Open ${name}`
    return (
      <details className="cu-card cu-store cu-store--opens">
        <summary className="cu-store__sum">
          {body}
          <span className="cu-store__hint" aria-hidden />
        </summary>
        <div className="cu-store__more">
          <dl className="cu-store__rows">
            {more.map((m) => (
              <div key={m.label}>
                <dt>{m.label}</dt>
                <dd>{m.value}</dd>
              </div>
            ))}
          </dl>
          {onClick ? (
            <button type="button" className="cu-btn cu-store__go" onClick={onClick}>
              {action}
            </button>
          ) : href ? (
            <Link className="cu-btn cu-store__go" href={href}>
              {action}
            </Link>
          ) : null}
        </div>
      </details>
    )
  }
  if (onClick) {
    return (
      <button type="button" className="cu-card cu-store" onClick={onClick}>
        {body}
      </button>
    )
  }
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
