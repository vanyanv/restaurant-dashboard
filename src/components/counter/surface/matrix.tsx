"use client"

import { useState } from "react"
import {
  placeMatrix,
  QUADRANT_CORNERS,
  type MatrixSpec,
  type MenuQuadrant,
  type PlacedPoint,
} from "@/lib/counter/matrix-geometry"

export type { MatrixPoint, MatrixSpec, MenuQuadrant } from "@/lib/counter/matrix-geometry"

/**
 * The menu matrix: volume against margin, split at the medians, with the four
 * quadrants operators already name.
 *
 * Ported from `P.menu.desk()` at line 5446 of
 * `docs/counter/counter-prototype.html`, class for class — `.qlegend`,
 * `.qbtn`, `.mtx`, `.gl`, `.ql`, `.mdot` and `.ch-tip` all already carry rules
 * in the generated sheet (lines 237–243 and 693–701) and **nothing rendered
 * them until this file**. The four quadrant colours are `.mdot.STAR`,
 * `.PLOWHORSE`, `.PUZZLE`, `.DOG`; this component never names a colour.
 *
 * ## What it does that the prototype does not
 *
 * 1. **The axes are scaled to the data.** The prototype divides units by a
 *    hardcoded 660 and maps margin from a hardcoded 50–82. Both are its own
 *    fixture's extremes; a real menu with a 900-unit seller would pile every
 *    other dot into the left third. See `matrix-geometry.ts`.
 * 2. **The split lines sit at the medians**, wherever those fall, rather than
 *    at a fixed 50%. The medians are what define the quadrants, so a line
 *    drawn anywhere else would put dots on the wrong side of their own label.
 * 3. **The legend filters.** `.qbtn[aria-pressed="true"]` already has a rule
 *    and the prototype never sets the attribute — the buttons are decoration
 *    there. Here they toggle their quadrant, which is what a legend with a
 *    pressed state is for.
 *
 * ## The tooltip is a `<div>`, not a `title`
 *
 * `.ch-tip` is the same card `Chart` uses, positioned inside `.mtx`. A native
 * `title` cannot be styled, does not appear on touch, and takes a second to
 * show — this is the interaction the class exists for.
 */
export function Matrix({
  spec,
  /** The axis's middle caption — "Units sold, 30 days →". */
  axisLabel,
}: {
  spec: MatrixSpec
  axisLabel: string
}) {
  const placed = placeMatrix(spec)
  const [hidden, setHidden] = useState<ReadonlySet<MenuQuadrant>>(new Set())
  const [active, setActive] = useState<PlacedPoint | null>(null)

  const counts = new Map<MenuQuadrant, number>()
  for (const p of spec.points) counts.set(p.quadrant, (counts.get(p.quadrant) ?? 0) + 1)

  const toggle = (q: MenuQuadrant) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(q)) next.delete(q)
      else next.add(q)
      return next
    })

  const shown = placed.points.filter((p) => !hidden.has(p.quadrant))

  return (
    <>
      <div className="qlegend" style={{ marginBottom: 10 }}>
        {QUADRANT_CORNERS.map((q) => (
          <button
            key={q.quadrant}
            type="button"
            className="qbtn"
            // `--qc` is the swatch's colour and every value is a token
            // reference. `.mdot.STAR` and this must agree, so both read the
            // same four names.
            style={{ ["--qc" as string]: QUADRANT_SWATCH[q.quadrant] }}
            aria-pressed={!hidden.has(q.quadrant)}
            onClick={() => toggle(q.quadrant)}
          >
            <i />
            {q.label} <span className="n">{counts.get(q.quadrant) ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="mtx" onMouseLeave={() => setActive(null)}>
        {/* The two median splits. Horizontal first, as the prototype writes them. */}
        <div className="gl" style={{ left: 0, right: 0, bottom: `${placed.splitBottom}%`, height: 1 }} />
        <div className="gl" style={{ top: 0, bottom: 0, left: `${placed.splitLeft}%`, width: 1 }} />

        <span className="ql" style={{ top: 6, left: 8 }}>
          Puzzles
        </span>
        <span className="ql" style={{ top: 6, right: 8 }}>
          Stars
        </span>
        <span className="ql" style={{ bottom: 6, left: 8 }}>
          Dogs
        </span>
        <span className="ql" style={{ bottom: 6, right: 8 }}>
          Plowhorses
        </span>

        {shown.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`mdot ${p.quadrant}`}
            style={{ left: `${p.left}%`, bottom: `${p.bottom}%` }}
            aria-label={p.label}
            onMouseEnter={() => setActive(p)}
            onFocus={() => setActive(p)}
          />
        ))}

        {active ? (
          <div
            className="ch-tip"
            style={{
              left: `${active.left}%`,
              bottom: `calc(${active.bottom}% + 16px)`,
              opacity: 1,
            }}
          >
            <b>{active.label}</b>
            {active.detail.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="axis">
        <span>{fmtUnits(placed.minUnits)}</span>
        <span>{axisLabel}</span>
        <span>{fmtUnits(placed.maxUnits)}</span>
      </div>
    </>
  )
}

/**
 * The swatch colour per quadrant, matching `.mdot.STAR` and its three siblings.
 * `--qc` is set inline per button and CSS cannot read its own rule back out,
 * so the four are named here — as TOKENS, never literals.
 *
 * `PUZZLE` needed a token invented for it: `.mdot.PUZZLE` is the one rule in
 * the generated sheet whose colour has none behind it, a bare
 * `oklch(45% 0.11 250)` carried over from the prototype. `--ct-quadrant-puzzle`
 * in `counter.css` names that value (and gives it the dark arm every other
 * pair in that block has). If the sheet's four ever change, these four change
 * with them.
 */
const QUADRANT_SWATCH: Record<MenuQuadrant, string> = {
  STAR: "var(--good)",
  PLOWHORSE: "var(--signal)",
  PUZZLE: "var(--ct-quadrant-puzzle)",
  DOG: "var(--bad)",
}

const fmtUnits = (n: number) => `${Math.round(n).toLocaleString()} sold`
