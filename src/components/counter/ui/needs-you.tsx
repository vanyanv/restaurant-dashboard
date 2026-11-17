import type { ReactNode } from "react"

export type NeedsYouGroup = {
  key: string
  /** What needs doing, e.g. "2 invoices need a store". */
  what: ReactNode
  /** One line of why or how much. */
  why?: ReactNode
  /** The one fix button for the whole group. */
  action?: ReactNode
}

/**
 * "Needs you", folded into a few groups with one fix button each, and
 * collapsed by default (owner, 2026-11-03: low-priority information).
 *
 * Shared block: replaces `.queue` (desk), `.mlist` (phone), `.pl-todos`,
 * `.iv-tasks`, `.iv-needs`, `.mi-needs`, `.pp-needs` and `.sh-queue`.
 * Renders nothing when there are no groups.
 */
export function NeedsYou({
  groups,
  defaultOpen = false,
  title = "need you",
}: {
  groups: NeedsYouGroup[]
  defaultOpen?: boolean
  /** Words after the count: "3 things need you". */
  title?: string
}) {
  if (groups.length === 0) return null
  const noun = groups.length === 1 ? "thing" : "things"
  const verb = title === "need you" && groups.length === 1 ? "needs you" : title
  return (
    <details className="cu-card cu-needs" open={defaultOpen}>
      <summary>
        <span>
          <span className="cu-needs__n">{groups.length}</span>
          {noun} {verb}
        </span>
      </summary>
      {groups.map((g) => (
        <div className="cu-needs__g" key={g.key}>
          <span className="cu-needs__what">{g.what}</span>
          {g.why ? <span className="cu-needs__why">{g.why}</span> : null}
          {g.action ? <span className="cu-needs__act">{g.action}</span> : null}
        </div>
      ))}
    </details>
  )
}
