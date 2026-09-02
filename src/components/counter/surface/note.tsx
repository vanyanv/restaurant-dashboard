import type { ReactNode } from "react"

/**
 * The mono line a section sets beside its figures — the caveat, the count, the
 * sentence about what the panel above does not say.
 *
 * It exists because the element has no spacing rule — not in our sheet and not
 * in the prototype, which answers the question inline on 34 of its 63 `p.mono`s
 * and gives eight different answers. Our tree inherited that and reached 157
 * call sites at eighteen values. Consolidating them is a deliberate deviation
 * from the prototype, argued in full above `.ct-note` in
 * `src/styles/counter-repairs.css`; read that before changing the value. The spacing lives there, in CSS, beside the rest of the
 * system's spacing; this component's only job is to be the one thing that
 * applies it, so the next note cannot quietly become the nineteenth value.
 *
 * The flags name the note's RELATIONSHIP to the surrounding content, never a
 * pixel amount. A caller who wants "a bit more air" is describing a layout
 * problem the section has, not a property of the note. Boolean flags rather
 * than a `place="..."` union to match `<Section bare>` and `<Drill wide>`,
 * which is the shape every other Counter primitive uses for the same idea.
 */
export function Note({
  tight,
  flush,
  lede,
  bare,
  measure,
  tone,
  live,
  children,
}: {
  /** The note IS a bare section's content, sat under the heading rather than after a body. */
  tight?: boolean
  /** The section is `pad={false}`; the note supplies the padding `.sec__body` would have. */
  flush?: boolean
  /** The note introduces the content below it rather than closing the content above. */
  lede?: boolean
  /** Something around the note already spaces it. */
  bare?: boolean
  /** The note runs to prose, so cap it at a readable line length. */
  measure?: boolean
  /**
   * The note reports an OUTCOME rather than a caveat. Without this a failed
   * save and the standing note occupy the same slot in the same colour, and a
   * reader who just pressed Save cannot tell which one they are looking at.
   */
  tone?: "bad" | "good"
  /**
   * The note's content changes in answer to something the reader just did, so
   * announce the change. `role="status"` is announced politely on update;
   * without it a failure is silent to a screen reader, which is the half of
   * this defect no screenshot shows.
   */
  live?: boolean
  children: ReactNode
}) {
  const cls = ["mono", "ct-note"]
  // At most one is ever set. Fixed precedence rather than a union type so the
  // call sites read like their siblings; a caller that sets two gets the first
  // deterministically instead of whichever the cascade happened to prefer.
  if (tight) cls.push("ct-note--tight")
  else if (flush) cls.push("ct-note--flush")
  else if (lede) cls.push("ct-note--lede")
  else if (bare) cls.push("ct-note--bare")
  if (measure) cls.push("ct-note--measure")
  if (tone) cls.push(`ct-note--${tone}`)
  return (
    <p className={cls.join(" ")} {...(live ? { role: "status" } : {})}>
      {children}
    </p>
  )
}
