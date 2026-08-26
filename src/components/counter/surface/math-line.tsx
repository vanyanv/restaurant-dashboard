import type { ReactNode } from "react"

export interface MathRow {
  key: string
  label: string
  /** The prototype's `<span class="op">` — this row is an operation, not a term. */
  op?: boolean
  /** Pre-formatted, already carrying its own sign. */
  value: string
  /** `<b>` on both label and value. The prototype bolds Net to you and Contribution. */
  strong?: boolean
  /** The rule above a subtotal. */
  rule?: boolean
  /** Drop the row's own bottom border — the prototype's trailing rows. */
  noBorder?: boolean
}

/**
 * The chain from ticket to contribution, shown as arithmetic.
 *
 * Ported from `P.order.desk()`'s "What you keep" panel, prototype lines
 * 6595-6600 of `docs/counter/counter-prototype.html`:
 *
 *   <div class="mathline"><span>Ticket, as charged on DoorDash</span><b>$36.65</b></div>
 *   <div class="mathline"><span class="op">&minus; commission 20%</span><b>&minus;$7.33</b></div>
 *   <div class="mathline" style="border-top:1px solid var(--line-strong);padding-top:9px;border-bottom:none">
 *     <span><b>Net to you</b></span><b>$29.32</b></div>
 *   <div class="mathline" style="border-bottom:none"><span class="op">&minus; food cost</span><b>&minus;$8.10</b></div>
 *
 * Note 20's rule — arithmetic is shown as arithmetic — is why this is not a
 * `Kv`: a `Kv` row is a fact, and a `MathRow` is a step in a sum, distinguished
 * by `op` (`<span class="op">`) from a term that merely states a total.
 *
 * ## What this component refuses to do
 *
 * The prototype's own comment at line 6600 records the bug it already fixed
 * once: "Tax was drawn as a subtraction and then not subtracted: the net
 * printed underneath it was the ticket less commission alone." Tax is stated
 * in prose beneath the panel and is NOT a row here — there is no `op`-less,
 * unapplied way to draw a `MathRow`; every row this component renders is a
 * term that IS summed into the figure below it. A caller with something to
 * say about money that did not move writes its own `<p class="mono">` under
 * `<MathLines>` — that paragraph is the caller's child, not a prop of this
 * component, so it can never be confused for a row.
 *
 * ## `rule` / `noBorder`, not inline styles
 *
 * The prototype draws its subtotal rule and its trailing rows with inline
 * `style="border-top:1px solid var(--line-strong);…"` / `style="border-bottom:none"`.
 * Ported as the `.mathline.is-rule` / `.mathline.is-open` classes in
 * `src/styles/counter-repairs.css` instead, because a page drawing its own
 * rules is what the ported sheet exists to prevent.
 *
 * **`npm run tokens` does NOT enforce this, and the plan that asked for it was
 * wrong to say it did.** That was measured, not assumed: reintroducing
 * `style={{ borderTop: "1px solid var(--line-strong)" }}` here leaves the
 * linter clean. Its `no-colour-literal` rule matches hex, `oklch()`, `rgb()`
 * and `hsl()` literals — a `var()` reference is none of those, and it cannot
 * be banned outright either, since assigning one to a custom property is the
 * sanctioned pattern (`channel-rows.tsx` sets `--pc` exactly that way). The
 * rule this comment states is therefore held by review and by this comment,
 * not by the build. Treat it as binding anyway.
 */
export function MathLines({ rows }: { rows: MathRow[] }): ReactNode {
  return (
    <>
      {rows.map((r) => {
        const classes = ["mathline"]
        if (r.rule) classes.push("is-rule")
        if (r.noBorder) classes.push("is-open")

        const label = r.strong ? <b>{r.label}</b> : r.label

        return (
          <div className={classes.join(" ")} key={r.key}>
            {r.op ? <span className="op">{label}</span> : <span>{label}</span>}
            <b>{r.value}</b>
          </div>
        )
      })}
    </>
  )
}
