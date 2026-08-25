/**
 * `syncChip()`, prototype line 8702:
 *
 * ```
 * <span class="sync is-bad"><i aria-hidden="true"></i> Last sync failed 4h ago
 * <span class="sync">        <i aria-hidden="true"></i> Syncing…
 * <span class="sync">        <i aria-hidden="true"></i> Synced 12 min ago
 * ```
 *
 * The `<i>` is the dot — `.sync i` is a 6px circle painted `--good`, and the
 * `is-stale` / `is-bad` modifiers repaint it `--signal` / `--bad`. It is the
 * only piece of colour in the topbar, which is why it carries `aria-hidden` and
 * the state is also in the words beside it.
 *
 * The prototype's three states are demo states (`UI.state`). Ours are derived
 * from one fact the caller actually has — when the last sync SUCCEEDED — and
 * nothing here invents a duration: `syncing` is a caller assertion, and the
 * caller is expected to pass `at` for the other two. A topbar with no sync
 * source at all renders no chip rather than a green dot that means nothing.
 */

export type SyncState = "synced" | "syncing" | "failed"

function relative(at: Date, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60000))
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function SyncChip({
  state,
  at,
  now,
}: {
  state: SyncState
  /** When the last sync — successful or otherwise — happened. */
  at?: Date
  /** Resolved by the caller, once, so a re-render cannot move "12 min ago". */
  now: Date
}) {
  if (state === "syncing") {
    return (
      <span className="sync">
        <i aria-hidden="true" /> Syncing…
      </span>
    )
  }
  if (state === "failed") {
    return (
      <span className="sync is-bad">
        <i aria-hidden="true" /> Last sync failed{at ? ` ${relative(at, now)}` : ""}
      </span>
    )
  }
  return (
    <span className="sync">
      <i aria-hidden="true" /> Synced{at ? ` ${relative(at, now)}` : ""}
    </span>
  )
}
