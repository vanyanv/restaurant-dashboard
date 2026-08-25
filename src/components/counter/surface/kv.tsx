import type { ReactNode } from "react"
import { toneStyle, type Tone } from "./tone"

export interface KvRow {
  /** The prototype's `r[0]`. */
  label: string
  /** `r[1]`. Pre-formatted — formatting belongs to `@/lib/counter/format`. */
  value: ReactNode
  /** `r[2]`, the optional colour. A checked union, not a string — see `./tone`. */
  tone?: Tone
}

/**
 * A ruled list of facts: what it is on the left, what it reads on the right.
 *
 * Ported from `kv()` at line 3086 of `docs/counter/counter-prototype.html`:
 *
 *   <div class="kv">
 *     <div><span>label</span><b style="color:var(--tone)">value</b></div>
 *   </div>
 *
 * Both children are bare — `.kv > div`, `.kv b` are what style them — so this
 * emits no class of its own below `.kv`. `.kv b` already carries
 * `font-variant-numeric: tabular-nums`, which is why the value needs no
 * numeral utility.
 *
 * A `<dl>` would be the more semantic element for a term/definition list, and
 * it is deliberately not used: every rule in the ported sheet is written as
 * `.kv > div` / `.kv b`, and a `<dl><div><dt><dd>` would render with none of
 * them. Phase B emits the prototype's DOM.
 *
 * Sole state renderer is `Section` (R3).
 */
export function Kv({ rows }: { rows: KvRow[] }) {
  return (
    <div className="kv">
      {rows.map((r) => (
        <div key={r.label}>
          <span>{r.label}</span>
          <b style={toneStyle(r.tone)}>{r.value}</b>
        </div>
      ))}
    </div>
  )
}
