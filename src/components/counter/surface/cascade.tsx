import { money } from "@/lib/counter/format"

/**
 * A P&L is a sequence of subtractions, so it is drawn as one.
 *
 * Ported from `cascade()` at line 5023 of
 * `docs/counter/counter-prototype.html`:
 *
 * ```
 * <div class="wf">
 *   <div class="wf__row is-total">
 *     <span class="wf__k">Gross sales<em>1,024 orders</em></span>
 *     <span class="wf__t"><i class="wf__stay" style="width:100.00%"></i></span>
 *     <span class="wf__v">$25,879</span>
 *     <span class="wf__p">100.0%</span>
 *   </div>
 *   <div class="wf__row">
 *     …<span class="wf__t"><i class="wf__stay" style="width:82.10%"></i>
 *               <i class="wf__cut is-over" style="left:82.10%;width:17.90%"></i></span>
 *       <span class="wf__v">−$4,632</span>…
 * ```
 *
 * Note 52: **a cascade, not a donut.** A donut answers "what share of the
 * money did each line take", which is not the question a statement asks. Each
 * bar here is what is LEFT after that line, and the slice beside it is what
 * that line took, so the reader watches the money run down the page.
 *
 * Colour marks the exception and nothing else: `is-over` on a single cut that
 * beat its own target. Five cost rows are not five red bars.
 *
 * ## Why this takes `start`/`cuts`/`end` and not a list of steps
 *
 * The previous version took `CascadeStep[]`, each carrying its own `amount`,
 * and every row's arithmetic was the caller's to get right. Nothing stopped a
 * statement whose subtractions did not reach its own bottom line — a cascade
 * that does not add up is worse than no cascade, because it is a picture of
 * arithmetic and the reader will trust it over their own.
 *
 * So the bottom line is not a parameter. `end` carries a NAME and no figure;
 * its value is `start.amount − Σ cuts`, computed here. The statement
 * reconciles by construction, and `tests/components/counter/cascade.test.tsx`
 * asserts it on the rendered DOM rather than on the inputs.
 */
export interface CascadeStart {
  name: string
  /** The prototype's `st.sub` — the small line under the name. */
  sub?: string
  amount: number
}

export interface CascadeCut {
  name: string
  sub?: string
  /** What this line takes away. Positive; the minus sign is the drawing's. */
  amount: number
  /** This one line beat its own published target. The ONLY thing that is red. */
  over?: boolean
}

export interface CascadeEnd {
  name: string
  sub?: string
}

export function Cascade({
  start,
  cuts,
  end,
}: {
  start: CascadeStart
  cuts: CascadeCut[]
  end: CascadeEnd
}) {
  const top = start.amount

  let running = top
  const middle = cuts.map((c) => {
    running -= c.amount
    return { ...c, left: running }
  })
  const bottom = running

  return (
    <div className="wf">
      <Row name={start.name} sub={start.sub} left={top} top={top} total pct={pctOf(top, top)} />
      {/* Keyed by index, not name: two "Other" lines are plausible in a
          statement, and the order never changes at runtime. */}
      {middle.map((c, i) => (
        <Row
          key={i}
          name={c.name}
          sub={c.sub}
          left={c.left}
          cut={c.amount}
          over={c.over}
          top={top}
          pct={pctOf(c.amount, top)}
        />
      ))}
      <Row
        name={end.name}
        sub={end.sub}
        left={bottom}
        top={top}
        total
        good={bottom > 0}
        pct={pctOf(bottom, top)}
      />
    </div>
  )
}

function Row({
  name,
  sub,
  left,
  cut,
  over,
  total,
  good,
  top,
  pct,
}: {
  name: string
  sub?: string
  left: number
  cut?: number
  over?: boolean
  total?: boolean
  good?: boolean
  top: number
  pct: number
}) {
  const stay = clampPct(share(left, top))
  // `Math.max(0.4, …)` is the prototype's: a line that took almost nothing
  // still gets a visible sliver rather than vanishing into the seam.
  const cutW = cut === undefined ? 0 : Math.max(0.4, clampPct(share(cut, top)))

  return (
    <div className={`wf__row${total ? " is-total" : ""}${good ? " is-good" : ""}`}>
      <span className="wf__k">
        {name}
        {sub ? <em>{sub}</em> : null}
      </span>
      <span className="wf__t">
        <i className="wf__stay" style={{ width: `${stay.toFixed(2)}%` }} />
        {cut === undefined ? null : (
          <i
            className={over ? "wf__cut is-over" : "wf__cut"}
            style={{ left: `${stay.toFixed(2)}%`, width: `${cutW.toFixed(2)}%` }}
          />
        )}
      </span>
      {/* U+2212 MINUS, not a hyphen — this is a column of figures. */}
      <span className="wf__v">{cut === undefined ? money(left) : `−${money(cut)}`}</span>
      <span className="wf__p">{pct.toFixed(1)}%</span>
    </div>
  )
}

/**
 * A zero `start` is a real state — a closed store, a channel filter that
 * matched no orders — and dividing by it would print "NaN%" and lay out a
 * width of "Infinity%". Every bar collapses to 0% instead.
 */
function share(v: number, top: number): number {
  return top === 0 ? 0 : (v / top) * 100
}

function pctOf(v: number, top: number): number {
  return round1(share(v, top))
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
