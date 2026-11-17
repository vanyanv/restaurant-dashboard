import type { ReactNode } from "react"

/**
 * The one plain sentence a "Made Plain" page opens with.
 *
 * Shared block: replaces `.say`'s sentence, `.lede`, `.pl-lead`, `.iv-lede`,
 * `.iv-say`, `.ck-plain`, `.pp-say` and `.rs-lead`. Wrap the figures that
 * matter in `<b>`; nothing else is styled.
 */
export function Answer({ children }: { children: ReactNode }) {
  return <p className="cu-answer">{children}</p>
}
