import type { ReactNode } from "react"

export type VsTone = "up" | "down" | "flat"

export type BigNumberProps = {
  /** What the number is, e.g. "Sales this week". */
  label: string
  /** The formatted figure. Pass `null` when an input is missing and there is no honest number. */
  value: string | null
  /** The comparison, already worded, e.g. "▲ 4.2%" + " vs last week". */
  vs?: { change: string; tone: VsTone; against: string }
  /** A missing input, labelled rather than counted as $0, e.g. "Glendale labor missing 2 days". */
  missing?: string
  /** The figure is an upper bound because an input is missing: drawn as "≤ value". */
  atMost?: boolean
}

/**
 * Headline figure with vs-last-period and missing inputs labelled.
 *
 * Shared block: replaces `.headline`/`.fig` (desk), `.mhead` (phone),
 * `.pl-big`, `.pl-hero`, `.ck-big`, `.mi-hero` and `.cw-fig`. The first
 * figure in a `BigNumbers` row is the lead; on a phone-width container the
 * others become a short list under it.
 */
export function BigNumber({ label, value, vs, missing, atMost }: BigNumberProps) {
  return (
    <div className="cu-big">
      <span className="cu-big__label">{label}</span>
      <span className="cu-big__value">
        {value === null ? "—" : atMost ? `≤ ${value}` : value}
      </span>
      {vs || missing ? (
        <span className="cu-big__vs">
          {vs ? (
            <>
              <span className={`cu-vs cu-vs--${vs.tone}`}>{vs.change}</span> {vs.against}
            </>
          ) : null}
          {missing ? <span className="cu-missing">{missing}</span> : null}
        </span>
      ) : null}
    </div>
  )
}

/** A lead figure and up to a few side figures. */
export function BigNumbers({ children }: { children: ReactNode }) {
  return (
    <div className="cu-bigs">
      <div className="cu-bigs__in">{children}</div>
    </div>
  )
}
