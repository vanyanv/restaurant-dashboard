import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"

/**
 * Shared sort affordances for the dashboard's sortable tables.
 *
 * Every table had rolled its own, and all of them shared two defects: a static
 * bidirectional `ArrowUpDown` that never showed the direction, and "which
 * column is sorted" encoded only as ink versus caption ink. Neither reached
 * assistive tech either — `aria-sort` appeared nowhere in the codebase.
 */

export type SortDirection = false | "asc" | "desc" | null | undefined

/** `aria-sort` value for a column header cell. */
export function ariaSort(
  dir: SortDirection,
): "ascending" | "descending" | "none" {
  return dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"
}

/** Screen-reader phrasing for a sort control's current state. */
export function sortLabel(label: string, dir: SortDirection): string {
  const state =
    dir === "asc"
      ? "sorted ascending"
      : dir === "desc"
        ? "sorted descending"
        : "not sorted"
  return `${label} — ${state}, activate to sort`
}

/** Directional glyph: up, down, or "sortable but not sorted". */
export function SortGlyph({
  dir,
  className = "ml-0.5 h-3 w-3",
}: {
  dir: SortDirection
  className?: string
}) {
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown
  return <Icon className={className} aria-hidden />
}
