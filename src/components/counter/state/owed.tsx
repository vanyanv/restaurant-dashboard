/**
 * This section is designed but not computed yet.
 *
 * The alternatives are worse: a zero reads as a measurement, and an absent
 * section reads as a design that never wanted it. Naming the owed work is the
 * only option that is honest about what the reader is not being shown.
 *
 * THE `owed` STRING IS SHOWN TO THE OWNER AS IT IS. Write it as a plain,
 * complete sentence about what is missing and, where there is one, what fixes
 * it: "No hours from Harri for these dates yet." Never a table or model name;
 * put that in a code comment beside the string. Until 2026-11-11 this rendered
 * "<owed> — designed, not yet built", and owners read database names such as
 * "HarriPositionDaily carries no row" on Labor and COGS.
 *
 * OUR sixth state — the prototype has five and no equivalent of this one, so
 * there is no `bodyNotComputed()` to port and this keeps its own treatment.
 *
 * IT BRINGS NO PADDING AND NO BOX OF ITS OWN. It renders inside `.sec__body`,
 * where the loading and failed bodies go, and `.sec__body` is already
 * `padding:13px 15px`. The first version wrapped the text in a dashed,
 * chrome-filled `p-6` panel, which put a second 24px inset inside the first and
 * — on an Overview where three of six sections are owed — made the thing the
 * page CANNOT show the loudest element on it. Compare `.failed`, the state
 * nearest to this one: `padding:6px 0`, no border, no fill. This follows it.
 *
 * Deliberately NOT given the `.empty` class, even though it is the same kind of
 * absence. `.empty` is a fidelity landmark, and `e2e/fidelity/landmarks.ts`
 * counts one: three owed sections would report as three EXTRA `.empty`
 * landmarks — a measurement of our data gap, reported as a DOM defect.
 */
export function Owed({ owed }: { owed: string }) {
  return (
    <div>
      <p className="font-ct-mono text-ct-micro uppercase tracking-wider text-ct-ink-3">
        Not available yet
      </p>
      <p className="mt-1.5 max-w-[52ch] text-ct-body text-ct-ink-2">{owed}</p>
    </div>
  )
}
