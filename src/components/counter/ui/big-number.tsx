import type { ReactNode } from "react"

export type VsTone = "up" | "down" | "flat"

export type Vs = { change: string; tone: VsTone; against: string }

export type BigNumberProps = {
  /** What the number is, e.g. "Sales this week". */
  label: string
  /** The formatted figure. Pass `null` when an input is missing and there is no honest number. */
  value: string | null
  /** Small words after the figure, e.g. "23.1% of sales". */
  sub?: string
  /** The comparison(s), already worded, e.g. "▲ 4.2%" + "vs last week". */
  vs?: Vs | Vs[]
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
export function BigNumber({ label, value, sub, vs, missing, atMost }: BigNumberProps) {
  const comparisons = vs === undefined ? [] : Array.isArray(vs) ? vs : [vs]
  return (
    <div className="cu-big">
      <span className="cu-big__label">{label}</span>
      <span className="cu-big__value">
        {value === null ? "—" : atMost ? `≤ ${value}` : value}
        {sub ? <small className="cu-big__sub">{sub}</small> : null}
      </span>
      {comparisons.length > 0 || missing ? (
        <span className="cu-big__vs">
          {comparisons.map((c) => (
            <span key={`${c.change}${c.against}`}>
              {c.change ? <span className={`cu-vs cu-vs--${c.tone}`}>{c.change}</span> : null}
              {c.change && c.against ? " " : null}
              {c.against}
            </span>
          ))}
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
