import type { ReactNode } from "react"

/**
 * Everything that is not the answer, folded at the bottom of the page.
 *
 * Shared block: replaces `.iv-fold`, `.rs-fold`, `.ck-logfold` and
 * `.ckp-more`. A native `<details>`, so it opens with the keyboard and
 * needs no script.
 */
export function Fold({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details className="cu-fold" open={defaultOpen}>
      <summary>{summary}</summary>
      <div className="cu-fold__in">{children}</div>
    </details>
  )
}
