import { donutGeometry, DONUT_SIZE, type DonutSlice } from "@/lib/counter/donut-geometry"
import { pct } from "@/lib/counter/format"

export type { DonutSlice }

export interface DonutProps {
  /** One row per category. Order is preserved in both the ring and the legend. */
  slices: DonutSlice[]
  /**
   * The prototype's `cx` — text drawn in the centre hole (`'$44k'`, `'84'`).
   * Omitted (or an empty string, same as the prototype's falsy check) draws
   * no `<text>` at all, leaving the hole empty.
   */
  center?: string
}

/**
 * The category-share ring: a donut chart with its legend beside it.
 *
 * Ported from `donut()` at line 3367 of
 * `docs/counter/counter-prototype.html` — same element order, same class
 * names (`donut`, `lg`), same fixed 118×118 geometry. The arc maths lives in
 * `@/lib/counter/donut-geometry` (`donutGeometry`); this file is the DOM,
 * same split `Chart`/`chart-geometry.ts` and `Bullet`/`bullet-state.ts` use.
 * `.donut`, `.donut svg` and `.donut .lg` (plus `.lg div`, `.lg i`, `.lg b`)
 * already carry rules in `src/styles/counter-components.css` — there is no
 * CSS of its own to write.
 *
 * ## One deliberate departure: how a share is printed
 *
 * The prototype's legend and `<title>` both print the RAW input number
 * followed by a bare `%` (`s[1] + '%'`) — correct for its own hand-picked
 * integer demo data (`46`, `18`, `14`…), wrong for a real `CogsCategory.share`
 * (`(cost / totalCategoryCost) * 100`, an unrounded float). Both places here
 * go through `pct(value, { scaled: true })` instead — the one formatter every
 * other Counter percentage already uses (`GapBar`, `ChannelRows`) — so a
 * share reads as `45.8%`, not `45.83892108%`, and stays consistent with every
 * other percent on the page.
 *
 * ## A slice of zero, and a total of zero
 *
 * A single slice whose own `value` is 0 needs nothing special: its wedge
 * collapses to zero area (see `donutGeometry`'s docblock) and simply doesn't
 * paint, but it still gets a legend row — a category that measured zero this
 * window is still a category, and dropping its row would make the legend
 * disagree with whatever table listed the same categories elsewhere on the
 * page.
 *
 * A TOTAL of zero (every slice is 0, or `slices` is empty) is the different,
 * worse case `donutGeometry` guards explicitly: dividing by a zero total is
 * `NaN` on every wedge, and the prototype does exactly that with no guard.
 * Left alone, that is the same shape of bug `Chart` documents for
 * `Math.min.apply(null, [])` — a value nobody chose (`NaN`, or here whatever
 * a browser does with a `NaN` path) standing in for a decision. This renders
 * an EMPTY ring instead: `arcs` comes back `[]`, so the `<svg>` draws only
 * the centre label (if any), never a full circle in the first slice's
 * colour. The legend is untouched — it maps `slices` directly, not `arcs` —
 * so every category still gets a row reading `0.0%`.
 */
export function Donut({ slices, center }: DonutProps) {
  const { arcs } = donutGeometry(slices)

  return (
    <div className="donut">
      <svg viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}>
        {arcs.map((a) => (
          <path key={a.name} d={a.d} fill={a.color}>
            {/*
              ONE STRING CHILD, not `{a.name} · {pct(…)}`.

              React serialises adjacent expression children with `<!-- -->`
              separators so it can find the text-node boundaries again on the
              client. Inside an SVG `<title>` the parser does not give them
              back as comment nodes, so the client saw different children than
              the server wrote and threw a hydration mismatch — on /cogs,
              /menu and /menu/catalog, every one of the three pages that draws
              a ring. React then regenerates the whole tree on the client,
              which is a flash and a lost render, not a cosmetic warning.

              A template literal is one text node with no separators. It is
              also what `components/mobile/daily-revenue-chart.tsx` already
              does in its own two `<title>`s.
            */}
            <title>{`${a.name} · ${pct(a.value, { scaled: true })}`}</title>
          </path>
        ))}
        {center ? (
          <text
            x={DONUT_SIZE / 2}
            // The prototype's own fixed baseline (59 + 4), not derived from
            // the box's centre — nudged down a touch to sit visually centred
            // against cap-height rather than the geometric midpoint.
            y={63}
            textAnchor="middle"
            fontSize={15}
            fontWeight={600}
            fill="var(--ink)"
            fontFamily="DM Sans"
          >
            {center}
          </text>
        ) : null}
      </svg>
      <div className="lg">
        {slices.map((s) => (
          <div key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
            <b>{pct(s.value, { scaled: true })}</b>
          </div>
        ))}
      </div>
    </div>
  )
}
