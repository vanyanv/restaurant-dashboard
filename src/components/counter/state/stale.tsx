/**
 * The sync failed, so these are the last good figures rather than current ones.
 * The reader needs both facts: the numbers are real, and they are not fresh.
 *
 * `timeZone: "UTC"` because every other stamp in this product states it —
 * `invoices`, `inventory`, `ingredient`, `vendor` and `monitoring-people` all
 * pass it, and this was the one place that did not. Left unstated, the zone is
 * whatever the RUNTIME is in, and `Section` is a server component, so this
 * rendered in the developer's local zone in dev and UTC on Vercel: the same
 * code with two different meanings, on the one element whose entire job is to
 * say when the figures are from.
 *
 * This makes the stamp CONSISTENT, not local to the restaurant. Those are
 * different problems: `src/lib/counter/adapters/settings.ts` records that the
 * owner's account carries `America/New_York` while every store is in Los
 * Angeles, so there is no single "the user's clock" to reach for yet. Picking
 * one here, in a banner, would be deciding that question in the wrong place.
 */
export function StaleBanner({ lastGoodAt }: { lastGoodAt: Date }) {
  const when = lastGoodAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })
  return (
    <div
      role="status"
      // `stalebanner` carries no style of its own; it is the hook the motion
      // block in `counter-repairs.css` uses to make this arrive rather than
      // appear — a figure that stopped being current is an operational change.
      className="stalebanner mb-3 flex items-baseline gap-2 rounded-ct-sm border border-ct-signal-line bg-ct-signal-wash px-3 py-2"
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
