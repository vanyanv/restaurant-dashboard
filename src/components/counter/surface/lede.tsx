import type { ReactNode } from "react"

/**
 * The sans paragraph a section opens with — what the content below it is, said
 * once, before the figures start.
 *
 * The counterpart to `<Note>`, and it exists for the same reason: the
 * prototype writes this element inline and disagrees with itself about its
 * margin and its line-height, and our port added a second spelling of the size
 * token on top. See the note above `.ct-lede` in
 * `src/styles/counter-repairs.css` — this deviates from the prototype on
 * purpose.
 *
 * `--t-mid` and 1.55 are not props. A lede that wants a different size is a
 * different element, and the two that exist already have names: `<Note>` for
 * the mono caveat and `<Say>` for the verdict.
 */
export function Lede({ last, children }: {
  /** Nothing follows inside this section, so the bottom margin comes off. */
  last?: boolean
  children: ReactNode
}) {
  return <p className={last ? "ct-lede ct-lede--last" : "ct-lede"}>{children}</p>
}
