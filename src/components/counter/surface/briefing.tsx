import type { ReactNode } from "react"

export type BriefingLine = {
  key: string
  /** The bolded first clause — what the line is about. */
  lead: ReactNode
  /** The rest of the sentence. */
  body: ReactNode
  /** The right-hand figure, or null when the line has no number to show. */
  figure: string | null
}

/**
 * `.briefline` — the numbered week briefing.
 *
 * The gutter number is the line's POSITION, taken from the array, never a
 * counter that skips lines without figures.
 */
export function Briefing({ lines }: { lines: BriefingLine[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div className="briefline" key={l.key}>
          <span className="g">{i + 1}</span>
          <p>
            {l.lead}
            {l.body}
          </p>
          {l.figure === null ? null : <span className="n">{l.figure}</span>}
        </div>
      ))}
    </>
  )
}
