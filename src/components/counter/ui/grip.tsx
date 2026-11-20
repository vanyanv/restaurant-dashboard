import type { ComponentPropsWithoutRef } from "react"

/**
 * The handle a row is dragged by. Spread `useDragReorder().grip(index)` on
 * it and mark the row `data-reorder-row`. `label` names the row for a screen
 * reader, e.g. "Task 3"; the way to move it is said after.
 */
export function Grip({ label, ...rest }: { label: string } & Omit<ComponentPropsWithoutRef<"button">, "type" | "aria-label" | "children">) {
  return (
    <button type="button" className="cu-grip" aria-label={`Move ${label}. Drag, or press the up and down arrow keys.`} {...rest}>
      <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden>
        <circle cx="4" cy="3" r="1.6" />
        <circle cx="10" cy="3" r="1.6" />
        <circle cx="4" cy="9" r="1.6" />
        <circle cx="10" cy="9" r="1.6" />
        <circle cx="4" cy="15" r="1.6" />
        <circle cx="10" cy="15" r="1.6" />
      </svg>
    </button>
  )
}
