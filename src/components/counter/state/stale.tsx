/**
 * The sync failed, so these are the last good figures rather than current ones.
 * The reader needs both facts: the numbers are real, and they are not fresh.
 */
export function StaleBanner({ lastGoodAt }: { lastGoodAt: Date }) {
  const when = lastGoodAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  return (
    <div
      role="status"
      className="mb-3 flex items-baseline gap-2 rounded-ct-sm border border-ct-signal-line bg-ct-signal-wash px-3 py-2"
    >
      <span className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-signal-ink">
        Last good run
      </span>
      <span className="text-ct-cap text-ct-ink-2">
        {when} — the sync has not succeeded since, so the figures below are not current.
      </span>
    </div>
  )
}
