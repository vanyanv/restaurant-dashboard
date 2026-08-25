/**
 * This section is designed but not computed yet.
 *
 * The alternatives are worse: a zero reads as a measurement, and an absent
 * section reads as a design that never wanted it. Naming the owed work is the
 * only option that is honest about what the reader is not being shown.
 *
 * OUR sixth state — the prototype has five and no equivalent of this one, so
 * there is no `bodyNotComputed()` to port and this keeps its own treatment.
 * What DID change in the Section port is where it sits: `Section` now renders
 * it inside `.sec__body`, where the loading and failed bodies go, rather than
 * loose in a section that had no body element at all. It has never replaced
 * the section, and must not — the head is what tells a reader WHICH piece of
 * work is owed.
 */
export function Owed({ owed }: { owed: string }) {
  return (
    <div className="rounded-ct border border-dashed border-ct-line-strong bg-ct-chrome p-6 text-center">
      <p className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
        Not computed yet
      </p>
      <p className="mx-auto mt-2 max-w-prose text-ct-body text-ct-ink-2">
        {owed} — designed, not yet built. Nothing is shown rather than a figure that would be wrong.
      </p>
    </div>
  )
}
