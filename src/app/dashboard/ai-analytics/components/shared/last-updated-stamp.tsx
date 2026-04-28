interface LastUpdatedStampProps {
  generatedAt: Date | null
  status: "OK" | "PARTIAL" | "FAILED" | null
  /** When true, the most recent attempted run was FAILED — we are showing
   * stale data. Adds a small red proofmark next to the stamp. */
  stale?: boolean
}

/**
 * Mono-typeset stamp for the page header: "LAST EDITION · 12 MIN AGO". Sits
 * to the right of the route nav. When the most recent cron failed we add a
 * red proofmark so the operator knows the figures are from the prior run.
 */
export function LastUpdatedStamp({
  generatedAt,
  status,
  stale,
}: LastUpdatedStampProps) {
  if (!generatedAt) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-faint)">
        Awaiting first edition
      </span>
    )
  }

  const relative = formatRelative(generatedAt)

  return (
    <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-(--ink-muted)">
      {stale ? (
        <span
          aria-label="Most recent refresh failed; showing prior edition"
          className="inline-block h-[6px] w-[6px] rotate-45 bg-(--accent)"
        />
      ) : null}
      <span>Last edition</span>
      <span className="text-(--ink-faint)">·</span>
      <span className="text-(--ink)">{relative}</span>
      {status === "PARTIAL" ? (
        <>
          <span className="text-(--ink-faint)">·</span>
          <span className="text-(--ink-faint)">edited</span>
        </>
      ) : null}
    </span>
  )
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  return `${days} d ago`
}
