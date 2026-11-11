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
  const split = !tone && !live ? splitLongNote(children) : null
  if (split) {
    cls.push("ct-note--plain")
    return (
      <div className={cls.join(" ")}>
        <p>{split.lead}</p>
        {split.rest && (
          <details className="ct-note__more">
            <summary>How this is worked out</summary>
            <p>{split.rest}</p>
          </details>
        )}
      </div>
    )
  }
  return (
    <p className={cls.join(" ")} {...(live ? { role: "status" } : {})}>
      {children}
    </p>
  )
}

/**
 * Above this many characters a note stops being a caption and becomes an
 * explanation. Owners read those on a phone in 11px mono, 8 to 15 lines deep,
 * between a figure and the table they came for (design review, 2026-11-11).
 */
const LONG_NOTE = 160

/**
 * A long plain-string note keeps its first sentence on screen, in the body
 * face, and folds the rest behind "How this is worked out". Short notes and
 * notes built from markup render exactly as before. A long note that is one
 * sentence keeps it whole, with nothing folded.
 */
export function splitLongNote(children: ReactNode): { lead: string; rest: string | null } | null {
  if (typeof children !== "string") return null
  const text = children.trim()
  if (text.length <= LONG_NOTE) return null
  const m = /^(.+?[.!?])\s+(?=[A-Z0-9"“(])/.exec(text)
  if (!m) return { lead: text, rest: null }
  const lead = m[1]
  const rest = text.slice(m[0].length).trim()
  return { lead, rest: rest.length > 0 ? rest : null }
}
