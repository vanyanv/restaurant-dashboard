import type { EmptyReason } from "@/lib/counter/section-data"

/**
 * Two reasons, two different next steps (note 23). A pre-open store has no
 * sales because it has no customers — nothing is broken and there is nothing to
 * fix. A filter that matched nothing is a dead end the reader backs out of.
 * Rendering both as "No data" would hide which situation the reader is in.
 */
const COPY: Record<EmptyReason, { head: string; body: string }> = {
  pre_open: {
    head: "Not trading yet",
    body: "This store has no sales because it has no customers yet. Figures appear here once it opens.",
  },
  no_match: {
    head: "Nothing matched",
    body: "No rows fall inside the current filters and date range. Widen either to see figures.",
  },
}

export function Empty({ reason }: { reason: EmptyReason }) {
  const { head, body } = COPY[reason]
  return (
    <div className="rounded-ct border border-ct-line bg-ct-chrome p-6 text-center">
      <p className="text-ct-mid text-ct-ink">{head}</p>
      <p className="mx-auto mt-1 max-w-prose text-ct-body text-ct-ink-2">{body}</p>
    </div>
  )
}
