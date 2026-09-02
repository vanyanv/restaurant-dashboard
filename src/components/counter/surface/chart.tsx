"use client"

import { useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import {
  axisTicks,
  chartMarks,
  chartReading,
  chartScale,
  CH_H,
  CH_W,
  type ChartSeries,
  type ChartSpec,
} from "@/lib/counter/chart-geometry"
import { money } from "@/lib/counter/format"
import { useChartDraw } from "@/components/counter/motion/use-chart-draw"
import { Figure } from "./figure"

export type { ChartSeries, ChartSpec }

export interface ChartProps extends ChartSpec {
  /** How a reading is written. Defaults to `money`. */
  fmt?: (v: number) => string
  /** How the band's bounds are written, when they want to be shorter than a reading. */
  bandFmt?: (v: number) => string
}

/**
 * The chart, drawn the way the design draws it.
 *
 * Ported from `chart()`/`mountChart()` at lines 3135 and 3175 of
 * `docs/counter/counter-prototype.html`. The arithmetic lives in
 * `@/lib/counter/chart-geometry`; this file is the DOM.
 *
 * ## Why this is not Recharts
 *
 * The previous implementation was Recharts 3, chosen by
 * `docs/counter/recharts-3-spike.md` — which answered a BEHAVIOUR question
 * (hover-anywhere, 42% dim, touch-drag: all reachable) and never a DOM one.
 * The fidelity gate compares landmark classes and computed styles, and the
 * ported stylesheet targets `.ch svg path.chref`, `.ch-cross`, `.ch-dot`,
 * `.ch-tip`, `.ch-lab`, `.chbar` and `.ch-legend` — element for element.
 * Recharts cannot emit any of them:
 *
 * - **`path.chref`** — `Line` builds its curve props as
 *   `{...svgPropertiesAndEvents(others), className: 'recharts-line-curve'}`
 *   (`recharts/es6/cartesian/Line.js:269`): a `className` passed to `<Line>`
 *   is spread first and then OVERWRITTEN. The class is not settable.
 * - **`.ch-cross` and `.ch-dot`** are HTML `<div>`s positioned over the plot
 *   (`top/bottom`, `background`, `border-radius`, `box-shadow`,
 *   `translate(-50%,-50%)`). Recharts' cursor is a `<path>` and its active
 *   dot a `<circle>`, both INSIDE the `<svg>` — where every one of those
 *   declarations is inert. A `<div>` cannot be put there at all.
 * - **`.axis` and `.ch-legend` are siblings of `.ch`**, not descendants:
 *   `chart()` returns three elements. Recharts renders its axis inside the
 *   surface and its legend inside `.recharts-legend-wrapper`.
 * - **The `.ch-tip` card** is `position:absolute` inside `.ch`, shown by
 *   `.ch.is-live .ch-tip` — a rule about an ancestor Recharts does not own.
 *   Its own wrapper (`recharts-tooltip-wrapper`) is positioned by an inline
 *   `transform` that fights `.ch-tip`'s `translate(-50%,-100%)`.
 * - **`.ch-lab`** (a direct label written on a stacked band, at a percentage
 *   of the plot's height) and the 2px `var(--surface)` seam between bands
 *   have no Recharts equivalent at all.
 *
 * What was given up is real and is now this file's job: hit-testing
 * (`chartReading`), tooltip placement and its edge clamp, and the touch
 * drag — which is `pointermove` plus `.ch { touch-action: pan-y }`, already
 * in the stylesheet. What was gained is that every ported rule above now
 * applies to something. `Cell` — deprecated in Recharts 3.10, removed in 4.0
 * — is gone with it: the 42% dim is `.ch.is-live .chbar` / `.chbar.on`, pure
 * CSS, no per-datum React element.
 *
 * `recharts` stays in `package.json`: 28 files under `src/components/charts/`
 * and `src/app/dashboard/(editorial)/**` still import it. This removes it
 * from Counter, which is the only part of the tree this plan governs.
 *
 * ## States
 *
 * `Section` is the sole renderer of `SectionData` (R3), so there is no
 * loading or empty branch here — the prototype's `chart()` has both, and
 * ours may not. The ONE guard that stays is the prototype's other one, which
 * is about the shape of the data rather than about a status: a single
 * reading is not a chart.
 */
export function Chart(props: ChartProps) {
  const { fmt = (v: number) => money(v), bandFmt, ...spec } = props
  const { animate, barStaggerMs } = useChartDraw()

  // Every hook runs before the single-reading return below — that branch is
  // decided by props, so it is stable for a given mount, but React still
  // requires the call order not to depend on it.
  const rawId = useId()
  // `useId` returns `:r1:`-shaped strings; a colon inside `url(#…)` is not
  // worth finding out about in one browser.
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "")

  // Recomputed every render rather than memoised: `spec` is a fresh object
  // out of the rest-spread above, so a `useMemo` keyed on it would recompute
  // anyway while claiming not to. The work is a few hundred `toFixed(1)`s;
  // React then diffs identical `d` attributes and writes nothing.
  const sc = chartScale(spec)
  const marks = chartMarks(spec, sc)
  const ticks = axisTicks(spec)

  const tipRef = useRef<HTMLDivElement>(null)
  // One entry per drawn line, filled by callback refs — a marker attribute
  // would have been simpler and would have put something in the DOM that the
  // prototype does not have.
  const linePaths = useRef<Array<SVGPathElement | null>>([])
  const [hover, setHover] = useState<{ ratio: number; hostW: number } | null>(null)
  const [tipW, setTipW] = useState(130)
  // Set only once `--len` has actually been written onto each path. Adding
  // `data-draw` first would start `cndraw` against an unresolved
  // `stroke-dasharray: var(--len)` — i.e. no dash at all, so the first frame
  // of the draw-on would show the whole finished line.
  const [drawable, setDrawable] = useState(false)

  const lineKey = marks.lines.map((l) => l.d).join("|")
  useLayoutEffect(() => {
    if (!animate) {
      setDrawable(false)
      return
    }
    for (const p of linePaths.current) {
      if (!p) continue
      let len = 0
      // jsdom has no `getTotalLength`, and neither does a detached path.
      try {
        len = p.getTotalLength()
      } catch {
        len = 1200
      }
      /*
       * `--len` HAS TO BE IN SCREEN UNITS, NOT VIEWBOX UNITS.
       *
       * These paths carry `vector-effect: non-scaling-stroke`, which moves the
       * whole stroke — dash pattern included — into the host coordinate space,
       * while `getTotalLength()` stays in the viewBox's own 700-unit space. The
       * `<svg>` is `preserveAspectRatio="none"` on a `0 0 700 h` box drawn at
       * `height: h`, so the vertical scale is exactly 1 and the horizontal one
       * is `width / 700` — 1.66 in a full-width `.sec`.
       *
       * Unscaled, `cndraw` ends at `stroke-dashoffset: 0` with a dash shorter
       * than the line it is dashing, and the last ~38% of the stroke lands in
       * the gap and is never painted. Measured on `/dashboard/labor`, whose two
       * full-width line charts were the first in the product: both solid lines
       * stopped dead at 62% of the plot with the fill continuing underneath.
       * Every chart shipped before it is either bars, a `.chref` dash (which
       * `cndraw` does not touch) or narrower than 700px, where an over-long
       * dash is harmless — which is why this has never shown.
       *
       * Rounding UP is deliberate and is the safe direction: a dash longer than
       * the path simply runs off the end and the line finishes fully drawn.
       */
      const scale = Math.max(1, (p.ownerSVGElement?.clientWidth ?? 0) / CH_W)
      p.style.setProperty("--len", Math.ceil((len || 1200) * scale).toFixed(0))
    }
    setDrawable(true)
  }, [animate, lineKey])

  // The tooltip is clamped by its own width, which is only knowable after it
  // has rendered its content. Measured here, fed back as state, and settled
  // in one extra pass because the guard stops it re-entering.
  useLayoutEffect(() => {
    const w = tipRef.current?.offsetWidth
    if (w && w !== tipW) setTipW(w)
  })

  // A single day is one reading, not a chart. Drawing it as a bar fills the
  // panel edge to edge and says nothing — the prototype renders a fitted
  // strip instead, and reuses `strip()`'s own cells to do it. `Strip` is not
  // reused here because it emits `data-n`, which IS the grid's track count;
  // `.strip--fit` is flex and the prototype's degraded strip carries no such
  // attribute, so emitting one would put a number in front of the fidelity
  // gate that the design never wrote.
  if (spec.labels.length < 2) {
    return (
      <div className="strip strip--fit">
        {spec.series.map((s) => (
          <Figure
            key={s.name}
            label={s.name}
            value={s.data[0] == null ? "—" : fmt(s.data[0])}
            delta={spec.labels[0]}
            deltaTone="is-flat"
            size="cell"
          />
        ))}
      </div>
    )
  }

  const reading = hover ? chartReading(spec, sc, hover.ratio, fmt, bandFmt) : null
  const cssX = reading && hover ? reading.ratio * hover.hostW : 0
  const tipLeft =
    reading && hover
      ? Math.max(tipW / 2 + 2, Math.min(hover.hostW - tipW / 2 - 2, cssX))
      : 0

  function read(e: ReactPointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.width) return
    setHover({ ratio: (e.clientX - r.left) / r.width, hostW: r.width })
  }

  const h = spec.h ?? CH_H

  return (
    <>
      <div
        className={reading ? "ch is-live" : "ch"}
        onPointerMove={read}
        onPointerDown={read}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${CH_W} ${h}`}
          preserveAspectRatio="none"
          style={{ height: h }}
          role="img"
          aria-label={spec.alt ?? spec.series[0]?.name ?? ""}
        >
          {marks.grid.map((y, i) => (
            <line
              key={`g${i}`}
              x1={0}
              y1={y.toFixed(1)}
              x2={CH_W}
              y2={y.toFixed(1)}
              stroke="var(--line)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* The comparison band: blocks behind bars, a ribbon behind a line. */}
          {marks.bandRects.map((r, i) => (
            <rect
              key={`b${i}`}
              x={r.x.toFixed(1)}
              y={r.y.toFixed(1)}
              width={r.w.toFixed(1)}
              height={r.h.toFixed(1)}
              fill="var(--sunk)"
              rx={1}
            />
          ))}
          {marks.bandPath ? <path d={marks.bandPath} fill="var(--sunk)" opacity={0.9} /> : null}

          {/* Accent is for a line you must not cross. An average is not one. */}
          {marks.rule ? (
            <line
              x1={0}
              y1={marks.rule.y.toFixed(1)}
              x2={CH_W}
              y2={marks.rule.y.toFixed(1)}
              stroke={marks.rule.quiet ? "var(--ink-3)" : "var(--accent)"}
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              opacity={0.7}
            />
          ) : null}

          {marks.stack.map((layer, i) => (
            <g key={`s${i}`}>
              <path data-fill="" d={layer.area} fill={layer.color} />
              {layer.seam ? (
                <path
                  d={layer.seam}
                  fill="none"
                  stroke="var(--surface)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </g>
          ))}

          {marks.bars.map((b, i) => (
            <rect
              key={`r${i}`}
              className={reading && reading.i === b.i ? "chbar on" : "chbar"}
              data-i={b.i}
              x={b.x.toFixed(1)}
              y={b.y.toFixed(1)}
              width={b.w.toFixed(1)}
              height={b.h.toFixed(1)}
              fill={b.color}
              rx={1}
              style={
                animate ? { animationDelay: `${Math.min(320, b.i * barStaggerMs)}ms` } : undefined
              }
            />
          ))}

          {marks.lines.map((l) => (
            <g key={`l${l.si}`}>
              {/* Colour the overshoot, not the measure (note 35): only the
                  area past the rule is red, clipped at the rule so a crossing
                  is handled by geometry rather than by branching. */}
              {l.overshootPath ? (
                <>
                  <clipPath id={`k${uid}${l.si}`}>
                    <rect x={0} y={0} width={CH_W} height={(l.overshootClipH ?? 0).toFixed(1)} />
                  </clipPath>
                  <path
                    data-fill=""
                    clipPath={`url(#k${uid}${l.si})`}
                    d={l.overshootPath}
                    fill="var(--bad)"
                    opacity={0.18}
                  />
                </>
              ) : null}
              {l.fillPath ? (
                <>
                  <defs>
                    <linearGradient id={`g${uid}${l.si}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={l.color} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={l.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <path data-fill="" d={l.fillPath} fill={`url(#g${uid}${l.si})`} />
                </>
              ) : null}
              <path
                // The comparison is a DASHED reference, not a second solid
                // line — `.ch svg path.chref` is what dashes it.
                ref={(el) => {
                  linePaths.current[l.si] = el
                }}
                className={l.dash ? "chref" : undefined}
                data-draw={!l.dash && drawable ? "" : undefined}
                d={l.d}
                fill="none"
                stroke={l.color}
                strokeWidth={l.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
        </svg>

        <div className="ch-cross" style={{ left: cssX }} />

        {sc.stacked
          ? null
          : spec.series.map((s, si) => {
              const dot = reading?.dots[si]
              return (
                <div
                  key={s.name}
                  className="ch-dot"
                  data-s={si}
                  style={{
                    background: s.color,
                    left: cssX,
                    top: dot ? dot.topPx : 0,
                    display: dot ? undefined : "none",
                  }}
                />
              )
            })}

        {/* Four names written on four bands, so identity is never colour
            alone. A share band carries its own last figure because the figure
            IS the share; a stack of parts carries a name only. */}
        {sc.stacked && spec.direct !== false
          ? marks.directLabels.map((d) => (
              <span key={d.name} className="ch-lab" style={{ top: `${d.topPct.toFixed(1)}%` }}>
                {d.name}
                {spec.stack === "sum" ? null : <b>{Math.round(d.v)}%</b>}
              </span>
            ))
          : null}

        <div ref={tipRef} className="ch-tip" style={{ left: tipLeft, top: reading?.tipTop ?? 0 }}>
          {reading ? (
            <>
              {/* The uncut name where there is room for one. See `fullLabels`. */}
              <span className="lb">{spec.fullLabels?.[reading.i] ?? spec.labels[reading.i]}</span>
              {reading.rows.map((r) => (
                <span key={r.name} className="rw">
                  <i style={{ background: r.color }} />
                  {r.name}
                  <b>{fmt(r.v)}</b>
                </span>
              ))}
              {reading.extras.map((x) => (
                <span key={x} className="ex">
                  {x}
                </span>
              ))}
            </>
          ) : null}
        </div>
      </div>

      {spec.ticks === false ? null : (
        <div className="axis">
          {ticks.map((t, i) => (
            <span key={`${t}-${i}`}>{t}</span>
          ))}
        </div>
      )}

      {spec.legend ? (
        <div className="ch-legend">
          {spec.series.map((s) => (
            <span key={s.name}>
              <i
                className={s.dash ? "dsh" : undefined}
                style={s.dash ? { borderColor: s.color } : { background: s.color }}
              />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}

      {/*
        Reachable without the picture: every reading, in reading order. The
        prototype has no such table — its `<svg role="img">` is the whole
        accessible surface, and a pointer is the only way to read a value off
        it. That is the one place this component departs from the design, and
        it departs in the direction the design's own notes argue for.

        THE WRAPPER IS LOAD-BEARING. `sr-only` used to sit on the `<table>`
        itself, and a table ignores `width: 1px`: its used width is at least
        its min-content width, so this one measured 777px. Absolutely
        positioned and 777px wide, it extended the scrollable area of the page
        — `/m/ingredients` scrolled sideways to 820px in a 412px viewport, and
        the fixed tab bar stretched to 820px with it. A table nobody can see
        was the widest thing on the phone.

        On a `<div>` the utility does what it says: 1×1 with `overflow:
        hidden`, which clips the table and stops its overflow contributing to
        any ancestor's scroll area. Screen readers read the DOM, so the wrapper
        changes nothing they announce. Only /m/ingredients crossed 412px today
        — the width depends on how many series a chart has and how long their
        names are — so this is a general defect one page happened to expose.
        `e2e/mobile/overflow-sweep.spec.ts` found it and is what keeps it
        found.
      */}
      <div className="sr-only">
      <table aria-label={spec.alt ?? spec.series[0]?.name ?? ""}>
        <thead>
          <tr>
            <th>Label</th>
            {spec.series.map((s) => (
              <th key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.labels.map((label, i) => (
            // Index, not the label: labels repeat (repeated hours, repeated
            // channel names) and a duplicate key produces a React warning.
            <tr key={i}>
              {/* A screen reader has no axis to be cramped by, and no hover to
                  recover a cut name with. It gets the whole one. */}
              <td>{spec.fullLabels?.[i] ?? label}</td>
              {spec.series.map((s) => (
                <td key={s.name}>{s.data[i] == null ? "—" : fmt(s.data[i] as number)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  )
}
