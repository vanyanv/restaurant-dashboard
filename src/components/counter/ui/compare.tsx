"use client"

import { useId, type CSSProperties } from "react"

/**
 * Two periods side by side, line by line, with the change.
 *
 * Shared block: a real table at every width (the figure's name moves onto
 * its own line on a phone-width container). With `options`, two pickers
 * choose the periods. The rows rise in again when the pair changes, so a
 * new comparison reads as new.
 */
export type CompareRow = {
  key: string
  label: string
  a: string
  b: string
  /** "▲ $1,200", "flat", or "" when a side is missing. */
  change: string
  /** The good direction, the bad one, or neither. */
  tone: "up" | "down" | "flat"
}

export type CompareOption = { key: string; label: string }

export function Compare({
  a,
  b,
  rows,
  options,
  onPick,
  labels = { a: "Period", b: "Against" },
}: {
  a: CompareOption
  b: CompareOption
  rows: CompareRow[]
  options?: CompareOption[]
  onPick?: (next: { a: string; b: string }) => void
  labels?: { a: string; b: string }
}) {
  const idA = useId()
  const idB = useId()
  return (
    <div className="cu-cmp">
      {options && onPick ? (
        <div className="cu-cmp__picks">
          <label className="cu-cmp__pick" htmlFor={idA}>
            <span>{labels.a}</span>
            <select id={idA} value={a.key} onChange={(e) => onPick({ a: e.target.value, b: b.key })}>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="cu-cmp__pick" htmlFor={idB}>
            <span>{labels.b}</span>
            <select id={idB} value={b.key} onChange={(e) => onPick({ a: a.key, b: e.target.value })}>
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <table className="cu-cmp__t">
        <thead>
          <tr className="cu-cmp__row cu-cmp__row--head">
            <th scope="col">Figure</th>
            <th scope="col">{a.label}</th>
            <th scope="col">{b.label}</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody key={`${a.key}|${b.key}`}>
          {rows.map((r, i) => (
            <tr key={r.key} className="cu-cmp__row" style={{ "--i": i } as CSSProperties}>
              <th scope="row">{r.label}</th>
              <td>{r.a}</td>
              <td>{r.b}</td>
              <td className="cu-cmp__chg" data-tone={r.tone}>
                {r.change}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
