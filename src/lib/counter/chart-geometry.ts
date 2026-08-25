/**
 * Everything `chart()` computes before it draws anything.
 *
 * Ported from `mountChart()` at line 3175 of
 * `docs/counter/counter-prototype.html` (reached from `chart()` at 3135),
 * with the DOM half left to `src/components/counter/surface/chart.tsx`. The
 * split is the same one `bullet-state.ts`/`spark.tsx` already use: the
 * arithmetic is pure and testable without a renderer, and the component is
 * thin enough to read as markup.
 *
 * Nothing here is a colour. `ChartSeries.color` carries a CSS custom-property
 * REFERENCE (`var(--ink)`), never a literal — `counter-components.css` aliases
 * every prototype token name onto its `--ct-*` original inside `.ct-root`, so
 * the prototype's own spec values transcribe unchanged and still resolve
 * through the one colour source. See `npm run tokens`.
 */

/** The prototype's fixed user-space width. The SVG is stretched to the column. */
export const CH_W = 700
/** `spec.h || 148`. */
export const CH_H = 148
/** Padding above the plot, in user units. */
export const CH_PT = 10
/** Padding below the plot, in user units. */
export const CH_PB = 8
/** The three gridline positions, as a fraction of the plot's height. */
export const CH_GRID = [0.25, 0.5, 0.75]

export interface ChartSeries {
  name: string
  /** `null` is a gap, not a zero. */
  data: (number | null)[]
  /** A CSS custom-property reference — `var(--ink)`, never a literal. */
  color: string
  /**
   * Draw as a DASHED reference (`path.chref`) rather than a solid measure.
   * The comparison series is this, not a second solid line.
   */
  dash?: boolean
  /** Fade the area under the line down to nothing. */
  fill?: boolean
  /**
   * Paint the area ABOVE this value red, clipped at it. Note 35: colour the
   * overshoot, not the measure — a crossing is handled by geometry rather
   * than by branching.
   */
  fillFrom?: number
  /** Stroke width; 1.9 by default. */
  w?: number
  /** Force a line even on a bar chart — the bars are what happened, the line is what they are judged against. */
  as?: "line"
}

export interface ChartBand {
  lo: number[]
  hi: number[]
}

export interface ChartRule {
  v: number
  label: string
  /** Accent is for a line you must not cross. An average is not one. */
  tone?: "quiet"
}

export interface ChartSpec {
  /**
   * The prototype writes `'bars'` or `'multi'`; only `'bars'` is tested for,
   * so every other value is a line. Spelled `"line"` here because `'multi'`
   * names nothing a reader can act on.
   */
  type?: "bars" | "line"
  labels: string[]
  series: ChartSeries[]
  /** Plot height in CSS px; also the SVG's user-space height. */
  h?: number
  min?: number
  max?: number
  /** Pin the floor to zero. */
  zero?: boolean
  /** `"pct"` is a share of a whole; `"sum"` is a stack of parts keeping its own units. */
  stack?: "pct" | "sum"
  band?: ChartBand
  bandLabel?: string
  rule?: ChartRule
  /** Per-column notes, appended to that column's tooltip. */
  notes?: (string | undefined)[]
  /** Write the series name on its own band. Stacked charts only; `false` to suppress. */
  direct?: boolean
  /** `false` drops the `.axis` row entirely. */
  ticks?: boolean
  legend?: boolean
  /** Index of the series every other one is read against, for the tooltip's last line. */
  vs?: number | null
  vsLabel?: string
  /** The accessible name. Defaults to the first series' name. */
  alt?: string
}

export interface ChartScale {
  n: number
  w: number
  h: number
  min: number
  max: number
  /** Bars rather than a line: `type === "bars"`, or fewer than two readings. */
  bar: boolean
  stacked: boolean
}

/**
 * The domain, and which shape draws it.
 *
 * One hardening over the prototype: a series that is entirely `null` leaves
 * `vals` empty, and `Math.min.apply(null, [])` is `Infinity` — every
 * subsequent coordinate becomes `NaN` and the chart silently draws nothing.
 * An empty domain falls back to 0..1 here instead.
 */
export function chartScale(spec: ChartSpec): ChartScale {
  const n = spec.labels.length
  const h = spec.h ?? CH_H

  const vals: number[] = []
  for (const s of spec.series) {
    for (const v of s.data) if (v != null) vals.push(v)
  }
  if (spec.band) vals.push(...spec.band.lo, ...spec.band.hi)
  if (spec.rule) vals.push(spec.rule.v)

  let min: number
  let max: number
  if (vals.length === 0) {
    min = spec.min ?? 0
    max = spec.max ?? 1
  } else {
    min = spec.min ?? Math.min(...vals)
    max = spec.max ?? Math.max(...vals)
    const span = max - min || 1
    if (spec.min == null) min = min - span * 0.16
    if (spec.max == null) max = max + span * 0.12
  }
  if (spec.zero) min = 0

  // Share of a whole has one scale and it is not negotiable. A stack of parts
  // that is not a share keeps its own units and a zero baseline, because the
  // baseline is the thing the parts are measured from.
  const stacked = spec.stack === "pct" || spec.stack === "sum"
  if (spec.stack === "pct") {
    min = 0
    max = 100
  } else if (spec.stack === "sum") {
    const tops: number[] = []
    for (let i = 0; i < n; i++) {
      let acc = 0
      for (const s of spec.series) acc += s.data[i] ?? 0
      tops.push(acc)
    }
    min = 0
    max = (tops.length ? Math.max(...tops) : 1) * 1.1
  }

  return { n, w: CH_W, h, min, max, bar: spec.type === "bars" || n < 2, stacked }
}

/** A value's y, in user units. */
export function scaleY(sc: ChartScale, v: number): number {
  const span = sc.max - sc.min || 1
  return CH_PT + (1 - (v - sc.min) / span) * (sc.h - CH_PT - CH_PB)
}

/** A reading's x, in user units. Bars sit at the centre of their band. */
export function scaleX(sc: ChartScale, i: number): number {
  if (sc.bar) return (i + 0.5) * (sc.w / sc.n)
  return sc.n === 1 ? sc.w / 2 : (i / (sc.n - 1)) * sc.w
}

/**
 * A Catmull-Rom-ish cubic through every point — `smooth()` at line 3164,
 * transcribed. Returns `""` for fewer than two points, which is the
 * prototype's own signal to draw no line at all.
 */
export function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return ""
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i - 1] || pts[i]
    const b = pts[i]
    const c = pts[i + 1]
    const e = pts[i + 2] || c
    d +=
      `C${(b[0] + (c[0] - a[0]) / 6).toFixed(1)},${(b[1] + (c[1] - a[1]) / 6).toFixed(1)}` +
      ` ${(c[0] - (e[0] - b[0]) / 6).toFixed(1)},${(c[1] - (e[1] - b[1]) / 6).toFixed(1)}` +
      ` ${c[0].toFixed(1)},${c[1].toFixed(1)}`
  }
  return d
}

export interface ChartBar {
  /** The reading's index — what `.chbar.on` is matched against on hover. */
  i: number
  x: number
  y: number
  w: number
  h: number
  color: string
}

export interface ChartLine {
  /** Series index, for the gradient/clip ids the component has to make unique. */
  si: number
  d: string
  color: string
  width: number
  dash: boolean
  fill: boolean
  /** The closed area under the line, for `fill`. */
  fillPath?: string
  /** The closed area above `fillFrom`, clipped at it. */
  overshootPath?: string
  /** The clip rectangle's height for `overshootPath` — never negative. */
  overshootClipH?: number
}

export interface ChartStackLayer {
  /** The band itself. */
  area: string
  /** A 2px surface rule along its lower edge so two adjacent fills never touch. Absent on the first band. */
  seam?: string
  color: string
}

export interface ChartDirectLabel {
  name: string
  /** Vertical position as a percentage of the plot's height. */
  topPct: number
  /** The band's last reading — printed only for a share. */
  v: number
}

export interface ChartMarks {
  /** y of each gridline, in user units. */
  grid: number[]
  /** A comparison band drawn as blocks behind bars. */
  bandRects: Array<{ x: number; y: number; w: number; h: number }>
  /** A comparison band drawn as a ribbon behind a line. */
  bandPath?: string
  rule?: { y: number; quiet: boolean }
  stack: ChartStackLayer[]
  bars: ChartBar[]
  lines: ChartLine[]
  directLabels: ChartDirectLabel[]
}

/** Every mark the chart draws, in paint order. */
export function chartMarks(spec: ChartSpec, sc: ChartScale): ChartMarks {
  const { n, w, h, bar, stacked } = sc
  const Y = (v: number) => scaleY(sc, v)
  const X = (i: number) => scaleX(sc, i)

  const grid = CH_GRID.map((f) => CH_PT + f * (h - CH_PT - CH_PB))

  const bandRects: ChartMarks["bandRects"] = []
  let bandPath: string | undefined
  if (spec.band) {
    if (bar) {
      for (let i = 0; i < n; i++) {
        const bw = w / n
        const yh = Y(spec.band.hi[i])
        const yl = Y(spec.band.lo[i])
        bandRects.push({
          x: bw * i + bw * 0.14,
          y: yh,
          w: bw * 0.72,
          // Never negative: an inverted band would otherwise emit an invalid rect.
          h: Math.max(1, yl - yh),
        })
      }
    } else {
      const up: string[] = []
      const dn: string[] = []
      for (let i = 0; i < n; i++) {
        up.push(`${X(i).toFixed(1)},${Y(spec.band.hi[i]).toFixed(1)}`)
        dn.push(`${X(i).toFixed(1)},${Y(spec.band.lo[i]).toFixed(1)}`)
      }
      bandPath = `M${up.join("L")}L${dn.reverse().join("L")}Z`
    }
  }

  const rule = spec.rule ? { y: Y(spec.rule.v), quiet: spec.rule.tone === "quiet" } : undefined

  const stack: ChartStackLayer[] = []
  const directLabels: ChartDirectLabel[] = []
  if (stacked) {
    const cum = new Array<number>(n).fill(0)
    spec.series.forEach((s, si) => {
      const top: string[] = []
      const bot: string[] = []
      let mid = 0
      for (let i = 0; i < n; i++) {
        const lo = cum[i]
        const hi = lo + (s.data[i] ?? 0)
        top.push(`${X(i).toFixed(1)},${Y(hi).toFixed(1)}`)
        bot.push(`${X(i).toFixed(1)},${Y(lo).toFixed(1)}`)
        cum[i] = hi
        if (i === n - 1) mid = (Y(hi) + Y(lo)) / 2
      }
      stack.push({
        area: `M${top.join("L")}L${bot.slice().reverse().join("L")}Z`,
        seam: si ? `M${bot.join("L")}` : undefined,
        color: s.color,
      })
      directLabels.push({ name: s.name, topPct: (mid / h) * 100, v: s.data[n - 1] ?? 0 })
    })
  }

  const bars: ChartBar[] = []
  const lines: ChartLine[] = []
  if (!stacked) {
    spec.series.forEach((s, si) => {
      if (bar && s.as !== "line") {
        s.data.forEach((v, i) => {
          if (v == null) return
          const bw = w / n
          const y = Y(v)
          bars.push({
            i,
            x: bw * i + bw * 0.2,
            y,
            w: bw * 0.6,
            // THE NEGATIVE CASE. Bars grow from the domain's floor, so a
            // negative reading on an auto domain draws a real bar. When the
            // floor is pinned (`zero`) and the reading falls below it,
            // `Y(min) - y` goes negative — and a negative `height` is invalid
            // SVG that renders NOTHING AT ALL. The prototype's own clamp is
            // what keeps a below-floor reading visible as a stub rather than
            // vanishing, and it is load-bearing, not defensive noise.
            h: Math.max(1, Y(sc.min) - y),
            color: s.color,
          })
        })
      } else {
        const pts: Array<[number, number]> = []
        s.data.forEach((v, i) => {
          if (v != null) pts.push([X(i), Y(v)])
        })
        const d = smoothPath(pts)
        if (!d) return
        const line: ChartLine = {
          si,
          d,
          color: s.color,
          width: s.w ?? 1.9,
          dash: !!s.dash,
          fill: !!s.fill,
        }
        if (s.fillFrom != null) {
          const yr = Y(s.fillFrom)
          line.overshootClipH = Math.max(0, yr)
          line.overshootPath =
            `${d}L${pts[pts.length - 1][0].toFixed(1)},${yr.toFixed(1)}` +
            `L${pts[0][0].toFixed(1)},${yr.toFixed(1)}Z`
        }
        if (s.fill) {
          line.fillPath = `${d}L${pts[pts.length - 1][0].toFixed(1)},${h}L${pts[0][0].toFixed(1)},${h}Z`
        }
        lines.push(line)
      }
    })
  }

  return { grid, bandRects, bandPath, rule, stack, bars, lines, directLabels }
}

/**
 * The `.axis` row: every label under bars, first/middle/last under a line.
 * `spec.ticks === false` means the caller wants no axis at all — that is the
 * component's branch, not this one's.
 */
export function axisTicks(spec: ChartSpec): string[] {
  const L = spec.labels
  if (spec.type === "bars") return L
  if (L.length < 2) return L
  return [L[0], L[Math.floor(L.length / 2)], L[L.length - 1]]
}

export interface ChartReadingRow {
  name: string
  color: string
  v: number
}

export interface ChartReading {
  /** Which reading the pointer resolved to. */
  i: number
  /** Its x as a fraction of the plot's width — the SVG is stretched, so this is exact at any size. */
  ratio: number
  rows: ChartReadingRow[]
  /** The `.ex` lines under the readings, already worded. */
  extras: string[]
  /** Where the tooltip's bottom edge sits, in CSS px from the top of `.ch`. */
  tipTop: number
  /** Per-series dot positions; `null` where that series has no reading here (or the chart draws bars). */
  dots: Array<{ topPx: number } | null>
}

/**
 * What the pointer is over — `read()` at line 3300, transcribed.
 *
 * Takes a 0..1 position rather than a `PointerEvent` so it is testable
 * without a layout: the prototype divides the pointer's offset by the host's
 * measured width to get exactly this number.
 */
export function chartReading(
  spec: ChartSpec,
  sc: ChartScale,
  pointerRatio: number,
  fmt: (v: number) => string,
  bandFmt?: (v: number) => string,
): ChartReading {
  const { n, h, bar, stacked } = sc
  const clamped = Math.max(0, Math.min(1, pointerRatio))
  let i = bar ? Math.min(n - 1, Math.floor(clamped * n)) : Math.round(clamped * (n - 1))
  // Walk back off a bucket nothing was recorded in, rather than showing an
  // empty card over it.
  while (i > 0 && spec.series.every((s) => s.data[i] == null)) i--

  const rows: ChartReadingRow[] = []
  for (const s of spec.series) {
    const v = s.data[i]
    if (v != null) rows.push({ name: s.name, color: s.color, v })
  }

  const extras: string[] = []
  const bf = bandFmt ?? fmt
  if (spec.band) {
    extras.push(`${spec.bandLabel ?? "4-week band"} ${bf(spec.band.lo[i])}–${bf(spec.band.hi[i])}`)
  }
  if (spec.rule) extras.push(`${spec.rule.label} ${fmt(spec.rule.v)}`)
  if (spec.notes?.[i]) extras.push(spec.notes[i] as string)
  // The reading against the reference, per bucket — which is the whole reason
  // the comparison belongs on the chart rather than beside it.
  if (spec.vs != null && spec.series[spec.vs]) {
    const av = spec.series[0].data[i]
    const bv = spec.series[spec.vs].data[i]
    if (av != null && bv) {
      const pc = ((av - bv) / Math.abs(bv)) * 100
      extras.push(
        `${pc >= 0 ? "▲ " : "▼ "}${Math.abs(pc).toFixed(1)}% ` +
          (spec.vsLabel ?? `vs ${spec.series[spec.vs].name}`),
      )
    }
  }

  let topY: number
  if (stacked) topY = CH_PT
  else if (bar) topY = scaleY(sc, Math.max(...spec.series.map((s) => s.data[i] ?? sc.min)))
  else topY = Math.min(...spec.series.map((s) => (s.data[i] == null ? h : scaleY(sc, s.data[i] as number))))

  const dots = spec.series.map((s) => {
    const v = s.data[i]
    if (v == null || bar || stacked) return null
    return { topPx: scaleY(sc, v) }
  })

  return { i, ratio: scaleX(sc, i) / sc.w, rows, extras, tipTop: topY - 10, dots }
}
