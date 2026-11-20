import type { ReactNode } from "react"

/**
 * ONE secondary thing, folded: "How this is worked out", the full statement,
 * edit history. Not "the rest of the page" — more than two blocks inside a
 * Fold fails `npm run tokens` (`fold-holds-a-page`); give them a `Tabs` tab
 * instead. See DESIGN.md "Page layout".
 *
 * Shared block: replaces `.iv-fold`, `.rs-fold`, `.ck-logfold` and
 * `.ckp-more`. A native `<details>`, so it opens with the keyboard and
 * needs no script.
 */
export function Fold({
  summary,
  children,
  defaultOpen = false,
  id,
}: {
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  /** So a button elsewhere on the page can open it (see `openFold`). */
  id?: string
}) {
  return (
    <details className="cu-fold" open={defaultOpen} id={id}>
      <summary>{summary}</summary>
      <div className="cu-fold__in">{children}</div>
    </details>
  )
}

/** Opens the fold with this id and brings it into view. */
export function openFold(id: string) {
  const el = document.getElementById(id)
  if (!(el instanceof HTMLDetailsElement)) return
  el.open = true
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })
}
