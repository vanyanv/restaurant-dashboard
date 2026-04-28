/**
 * The "no edition yet" state — shown when a route's cron has never written a
 * good run for the current scope. Editorial tone: not a spinner, not a
 * progress bar; a short Fraunces-italic line that explains what is happening
 * and when the next refresh runs.
 */
export function EmptyEdition({
  cadence,
}: {
  /** Plain-language cadence — e.g. "every hour", "every two hours". */
  cadence: string
}) {
  return (
    <section className="inv-panel">
      <div className="space-y-3 py-6">
        <p className="font-display text-[26px] italic leading-[1.15] text-(--ink)">
          No edition yet.
        </p>
        <p className="max-w-[58ch] font-sans text-[14px] leading-[1.55] text-(--ink-muted)">
          The next refresh runs {cadence}. Until then, this page has no
          briefing — the analyst has not filed copy for this scope yet.
        </p>
      </div>
    </section>
  )
}
