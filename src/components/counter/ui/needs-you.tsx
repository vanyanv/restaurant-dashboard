import type { ReactNode } from "react"

export type NeedsYouGroup = {
  key: string
  /** What needs doing, e.g. "2 invoices need a store". */
  what: ReactNode
  /** One line of why or how much. */
  why?: ReactNode
  /** The fix: a Button, or a ButtonRow. */
  action?: ReactNode
}

/**
 * "Needs you", folded into a few groups with one fix button each, and
 * collapsed by default (owner, 2026-11-03: low-priority information).
 *
 * Shared block: replaces `.queue` (desk), `.mlist` (phone), `.pl-todos`,
 * `.iv-tasks`, `.iv-needs`, `.mi-needs`, `.pp-needs` and `.sh-queue`.
 * Renders nothing when there are no groups.
 *
 * A page whose Needs you already sits in a folding `Section` uses the parts
 * instead: `NeedsYouList` and `NeedsYouItem`, which draw the same rows with
 * no fold of their own.
 */
export function NeedsYou({
  groups,
  defaultOpen = false,
}: {
  groups: NeedsYouGroup[]
  defaultOpen?: boolean
}) {
  if (groups.length === 0) return null
  const words = groups.length === 1 ? "thing needs you" : "things need you"
  return (
    <details className="cu-card cu-needs" open={defaultOpen}>
      <summary>
        <span>
          <span className="cu-needs__n">{groups.length}</span>
          {words}
        </span>
      </summary>
      <NeedsYouList>
        {groups.map((g) => (
          <NeedsYouItem key={g.key} what={g.what} why={g.why}>
            {g.action}
          </NeedsYouItem>
        ))}
      </NeedsYouList>
    </details>
  )
}

/** The rows of a Needs you list. `numbered` puts 1, 2, 3 beside them. */
export function NeedsYouList({ children, numbered }: { children: ReactNode; numbered?: boolean }) {
  return <ol className={`cu-needs__list${numbered ? " cu-needs__list--n" : ""}`}>{children}</ol>
}

/**
 * One row: what, why, and the fix underneath (desk: beside it when it is a
 * single button). `bad` marks a row that is wrong rather than waiting.
 */
export function NeedsYouItem({
  what,
  why,
  bad,
  leaving,
  children,
}: {
  what: ReactNode
  why?: ReactNode
  bad?: boolean
  /** The fix was just tapped: the row slides away (see `useLeaving`). */
  leaving?: boolean
  children?: ReactNode
}) {
  return (
    <li
      className={`cu-needs__g${bad ? " cu-needs__g--bad" : ""}${leaving ? " is-leaving" : ""}`}
      aria-hidden={leaving || undefined}
      inert={leaving || undefined}
    >
      <span className="cu-needs__what">{what}</span>
      {why ? <div className="cu-needs__why">{why}</div> : null}
      {children ? <div className="cu-needs__act">{children}</div> : null}
    </li>
  )
}

/**
 * The line a fix leaves behind: "✓ Saved to Glendale" or what went wrong.
 * `onUndo` adds an Undo right after it, for a fix that has a way back.
 */
export function Notice({
  tone,
  children,
  onUndo,
}: {
  tone: "good" | "bad"
  children: ReactNode
  onUndo?: () => void
}) {
  return (
    <span className={`cu-notice cu-notice--${tone}`} role={tone === "bad" ? "alert" : "status"}>
      {tone === "good" ? "✓ " : null}
      {children}
      {onUndo ? (
        <button type="button" className="cu-notice__undo" onClick={onUndo}>
          Undo
        </button>
      ) : null}
    </span>
  )
}
