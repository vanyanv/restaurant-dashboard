import { describe, it, expect } from "vitest"
import {
  CH_H,
  CH_PB,
  CH_PT,
  CH_W,
  axisTicks,
  chartMarks,
  chartReading,
  chartScale,
  scaleX,
  scaleY,
  smoothPath,
  type ChartSpec,
} from "@/lib/counter/chart-geometry"

const INK = "var(--ink)"
const QUIET = "var(--ink-3)"

function spec(over: Partial<ChartSpec> = {}): ChartSpec {
  return {
    labels: ["Aug 18", "Aug 19", "Aug 20"],
    series: [{ name: "Net", data: [7100, 7400, 7468], color: INK }],
    ...over,
  }
}

describe("chartScale", () => {
  it("pads an auto domain by 16% below and 12% above", () => {
    const sc = chartScale(spec())
    // span 368 -> min 7100 - 58.88, max 7468 + 44.16
    expect(sc.min).toBeCloseTo(7100 - 368 * 0.16, 5)
    expect(sc.max).toBeCloseTo(7468 + 368 * 0.12, 5)
  })

  it("leaves an explicitly given bound unpadded", () => {
    const sc = chartScale(spec({ min: 0, max: 10000 }))
    expect(sc.min).toBe(0)
    expect(sc.max).toBe(10000)
  })

  it("pins the floor to zero when asked", () => {
    expect(chartScale(spec({ zero: true })).min).toBe(0)
  })

  it("gives a share of a whole the one scale it can have", () => {
    const sc = chartScale(spec({ stack: "pct", series: [{ name: "a", data: [30, 40, 30], color: INK }] }))
    expect([sc.min, sc.max]).toEqual([0, 100])
    expect(sc.stacked).toBe(true)
  })

  it("gives a stack of parts a zero baseline and 10% headroom over the tallest column", () => {
    const sc = chartScale(
      spec({
        stack: "sum",
        series: [
          { name: "a", data: [10, 20, 30], color: INK },
          { name: "b", data: [10, 10, 10], color: QUIET },
        ],
      }),
    )
    expect(sc.min).toBe(0)
    expect(sc.max).toBeCloseTo(40 * 1.1, 5)
  })

  it("widens the domain to hold the band and the rule, not just the readings", () => {
    const sc = chartScale(
      spec({ band: { lo: [1000, 1000, 1000], hi: [9000, 9000, 9000] }, rule: { v: 500, label: "Floor" } }),
    )
    expect(sc.min).toBeLessThan(500)
    expect(sc.max).toBeGreaterThan(9000)
  })

  it("falls back to 0..1 when every reading is null, instead of an Infinity domain", () => {
    // `Math.min(...[])` is Infinity, which makes every coordinate NaN and
    // draws nothing at all — silently.
    const sc = chartScale(spec({ series: [{ name: "Net", data: [null, null, null], color: INK }] }))
    expect(Number.isFinite(sc.min)).toBe(true)
    expect(Number.isFinite(sc.max)).toBe(true)
    expect(Number.isFinite(scaleY(sc, 0))).toBe(true)
  })

  it("draws bars when asked, and a line otherwise", () => {
    expect(chartScale(spec({ type: "bars" })).bar).toBe(true)
    expect(chartScale(spec({ type: "line" })).bar).toBe(false)
    expect(chartScale(spec()).bar).toBe(false)
  })
})

describe("scaleX / scaleY", () => {
  it("puts a line's first and last readings on the plot's edges", () => {
    const sc = chartScale(spec())
    expect(scaleX(sc, 0)).toBe(0)
    expect(scaleX(sc, 2)).toBe(CH_W)
  })

  it("puts a bar at the centre of its band", () => {
    const sc = chartScale(spec({ type: "bars" }))
    expect(scaleX(sc, 0)).toBeCloseTo(CH_W / 6, 5)
    expect(scaleX(sc, 2)).toBeCloseTo((CH_W / 3) * 2.5, 5)
  })

  it("keeps the top and bottom of the domain inside the padding", () => {
    const sc = chartScale(spec({ min: 0, max: 100 }))
    expect(scaleY(sc, 100)).toBeCloseTo(CH_PT, 5)
    expect(scaleY(sc, 0)).toBeCloseTo(CH_H - CH_PB, 5)
  })
})

describe("smoothPath", () => {
  it("returns nothing for fewer than two points", () => {
    expect(smoothPath([])).toBe("")
    expect(smoothPath([[0, 0]])).toBe("")
  })

  it("emits one move and a cubic per gap", () => {
    const d = smoothPath([
      [0, 0],
      [10, 10],
      [20, 0],
    ])
    expect(d.startsWith("M0.0,0.0")).toBe(true)
    expect(d.match(/C/g)?.length).toBe(2)
  })
})

describe("chartMarks — bars", () => {
  it("emits one bar per non-null reading and none for a gap", () => {
    const { bars } = (() => {
      const s = spec({ type: "bars", series: [{ name: "Net", data: [7100, null, 7468], color: INK }] })
      return chartMarks(s, chartScale(s))
    })()
    expect(bars.map((b) => b.i)).toEqual([0, 2])
  })

  it("draws a negative reading as a real bar on an auto domain", () => {
    const s = spec({ type: "bars", series: [{ name: "Variance", data: [-40, 12, -8], color: INK }] })
    const marks = chartMarks(s, chartScale(s))
    expect(marks.bars).toHaveLength(3)
    for (const b of marks.bars) expect(b.h).toBeGreaterThan(1)
  })

  it("never emits a negative or zero height for a reading below a pinned floor", () => {
    // A negative SVG `rect` height is invalid and renders NOTHING AT ALL —
    // an earlier version of this component drew a below-baseline value as
    // literally nothing. Every bar must survive as at least a stub.
    const s = spec({ type: "bars", zero: true, series: [{ name: "Variance", data: [-40, 12, -8], color: INK }] })
    const marks = chartMarks(s, chartScale(s))
    expect(marks.bars).toHaveLength(3)
    for (const b of marks.bars) {
      expect(Number.isFinite(b.h)).toBe(true)
      expect(b.h).toBeGreaterThanOrEqual(1)
    }
  })

  it("puts a reference series on a bar chart as a line, not as bars", () => {
    const s = spec({
      type: "bars",
      series: [
        { name: "Net", data: [7100, 7400, 7468], color: INK },
        { name: "Last year", data: [6900, 7000, 7100], color: QUIET, as: "line", dash: true },
      ],
    })
    const marks = chartMarks(s, chartScale(s))
    expect(marks.bars.every((b) => b.color === INK)).toBe(true)
    expect(marks.lines).toHaveLength(1)
    expect(marks.lines[0].dash).toBe(true)
  })
})

describe("chartMarks — lines, band, rule, stack", () => {
  it("draws three gridlines inside the plot", () => {
    const s = spec()
    const { grid } = chartMarks(s, chartScale(s))
    expect(grid).toHaveLength(3)
    for (const y of grid) {
      expect(y).toBeGreaterThan(CH_PT)
      expect(y).toBeLessThan(CH_H - CH_PB)
    }
  })

  it("draws the comparison band as a ribbon behind a line and as blocks behind bars", () => {
    const band = { lo: [7000, 7100, 7200], hi: [7300, 7500, 7700] }
    const line = chartMarks(spec({ band }), chartScale(spec({ band })))
    expect(line.bandPath).toMatch(/^M/)
    expect(line.bandRects).toHaveLength(0)

    const barSpec = spec({ band, type: "bars" })
    const bars = chartMarks(barSpec, chartScale(barSpec))
    expect(bars.bandPath).toBeUndefined()
    expect(bars.bandRects).toHaveLength(3)
    for (const r of bars.bandRects) expect(r.h).toBeGreaterThanOrEqual(1)
  })

  it("marks a quiet rule as quiet — accent is for a line you must not cross", () => {
    const loud = spec({ rule: { v: 7200, label: "Floor" } })
    const quiet = spec({ rule: { v: 7200, label: "Average", tone: "quiet" } })
    expect(chartMarks(loud, chartScale(loud)).rule?.quiet).toBe(false)
    expect(chartMarks(quiet, chartScale(quiet)).rule?.quiet).toBe(true)
  })

  it("seams every stacked band but the first, so two adjacent fills never touch", () => {
    const s = spec({
      stack: "pct",
      series: [
        { name: "In-house", data: [60, 58, 57], color: INK },
        { name: "DoorDash", data: [25, 26, 27], color: QUIET },
        { name: "Uber Eats", data: [15, 16, 16], color: INK },
      ],
    })
    const marks = chartMarks(s, chartScale(s))
    expect(marks.stack).toHaveLength(3)
    expect(marks.stack[0].seam).toBeUndefined()
    expect(marks.stack[1].seam).toMatch(/^M/)
    expect(marks.stack[2].seam).toMatch(/^M/)
    expect(marks.bars).toHaveLength(0)
    expect(marks.lines).toHaveLength(0)
  })

  it("names every stacked band, positioned as a percentage of the plot", () => {
    const s = spec({
      stack: "pct",
      series: [
        { name: "In-house", data: [60, 58, 57], color: INK },
        { name: "DoorDash", data: [40, 42, 43], color: QUIET },
      ],
    })
    const { directLabels } = chartMarks(s, chartScale(s))
    expect(directLabels.map((d) => d.name)).toEqual(["In-house", "DoorDash"])
    for (const d of directLabels) {
      expect(d.topPct).toBeGreaterThan(0)
      expect(d.topPct).toBeLessThan(100)
    }
  })

  it("clips the overshoot area at the rule and never with a negative height", () => {
    const s = spec({ series: [{ name: "Food cost", data: [28, 31, 33], color: INK, fillFrom: 29 }] })
    const marks = chartMarks(s, chartScale(s))
    expect(marks.lines[0].overshootPath).toMatch(/Z$/)
    expect(marks.lines[0].overshootClipH).toBeGreaterThanOrEqual(0)
  })

  it("closes the fill area on the plot's floor", () => {
    const s = spec({ series: [{ name: "Net", data: [7100, 7400, 7468], color: INK, fill: true }] })
    const marks = chartMarks(s, chartScale(s))
    expect(marks.lines[0].fillPath?.endsWith(`,${CH_H}Z`)).toBe(true)
  })

  it("skips a null reading rather than breaking the line, as the prototype does", () => {
    const s = spec({ series: [{ name: "Net", data: [7100, null, 7468], color: INK }] })
    const marks = chartMarks(s, chartScale(s))
    // One move command: the curve runs through the two readings that exist.
    expect(marks.lines[0].d.match(/M/g)?.length).toBe(1)
  })
})

describe("axisTicks", () => {
  it("labels every bar", () => {
    expect(axisTicks(spec({ type: "bars" }))).toEqual(["Aug 18", "Aug 19", "Aug 20"])
  })

  it("labels a line at its start, middle and end only", () => {
    const long = spec({ labels: ["a", "b", "c", "d", "e", "f", "g"] })
    expect(axisTicks(long)).toEqual(["a", "d", "g"])
  })
})

describe("chartReading", () => {
  const fmt = (v: number) => `$${v}`

  it("resolves the nearest reading for a line and the containing band for bars", () => {
    const lineSpec = spec()
    expect(chartReading(lineSpec, chartScale(lineSpec), 0.9, fmt).i).toBe(2)
    const barSpec = spec({ type: "bars" })
    expect(chartReading(barSpec, chartScale(barSpec), 0.9, fmt).i).toBe(2)
    expect(chartReading(barSpec, chartScale(barSpec), 0.5, fmt).i).toBe(1)
  })

  it("clamps a pointer that ran off either edge", () => {
    const s = spec()
    expect(chartReading(s, chartScale(s), -3, fmt).i).toBe(0)
    expect(chartReading(s, chartScale(s), 4, fmt).i).toBe(2)
  })

  it("walks back off a bucket nothing was recorded in", () => {
    const s = spec({ series: [{ name: "Net", data: [7100, 7400, null], color: INK }] })
    expect(chartReading(s, chartScale(s), 1, fmt).i).toBe(1)
  })

  it("lists only the series that have a reading here", () => {
    const s = spec({
      series: [
        { name: "Net", data: [7100, 7400, 7468], color: INK },
        { name: "Last year", data: [null, 7000, 7100], color: QUIET },
      ],
    })
    expect(chartReading(s, chartScale(s), 0, fmt).rows.map((r) => r.name)).toEqual(["Net"])
    expect(chartReading(s, chartScale(s), 1, fmt).rows.map((r) => r.name)).toEqual(["Net", "Last year"])
  })

  it("adds the band, the rule and the column's note under the readings", () => {
    const s = spec({
      band: { lo: [7000, 7100, 7200], hi: [7300, 7500, 7700] },
      bandLabel: "4-week band",
      rule: { v: 7200, label: "Floor" },
      notes: [undefined, "Closed at 4pm", undefined],
    })
    const r = chartReading(s, chartScale(s), 0.5, fmt)
    expect(r.extras).toEqual(["4-week band $7100–$7500", "Floor $7200", "Closed at 4pm"])
  })

  it("reads the measure against the reference, per bucket", () => {
    const s = spec({
      series: [
        { name: "Net", data: [7100, 7400, 7468], color: INK },
        { name: "Last year", data: [7000, 7000, 7000], color: QUIET, dash: true },
      ],
      vs: 1,
      vsLabel: "against last year",
    })
    const up = chartReading(s, chartScale(s), 1, fmt)
    expect(up.extras.at(-1)).toBe("▲ 6.7% against last year")
    const s2 = spec({
      series: [
        { name: "Net", data: [6500, 7400, 7468], color: INK },
        { name: "Last year", data: [7000, 7000, 7000], color: QUIET, dash: true },
      ],
      vs: 1,
    })
    expect(chartReading(s2, chartScale(s2), 0, fmt).extras.at(-1)).toBe("▼ 7.1% vs Last year")
  })

  it("uses the band's own formatter when one is given", () => {
    const s = spec({ band: { lo: [7000, 7100, 7200], hi: [7300, 7500, 7700] } })
    const r = chartReading(s, chartScale(s), 0, fmt, (v) => `${(v / 1000).toFixed(1)}k`)
    expect(r.extras[0]).toBe("4-week band 7.0k–7.3k")
  })

  it("places one dot per series on a line chart and none on bars", () => {
    const s = spec({
      series: [
        { name: "Net", data: [7100, 7400, 7468], color: INK },
        { name: "Last year", data: [null, 7000, 7100], color: QUIET },
      ],
    })
    const r = chartReading(s, chartScale(s), 0, fmt)
    expect(r.dots[0]).not.toBeNull()
    expect(r.dots[1]).toBeNull()
    const bars = spec({ type: "bars" })
    expect(chartReading(bars, chartScale(bars), 0, fmt).dots).toEqual([null])
  })

  it("lifts the tooltip above the highest reading in the bucket", () => {
    const s = spec()
    const sc = chartScale(s)
    const r = chartReading(s, sc, 1, fmt)
    expect(r.tipTop).toBeCloseTo(scaleY(sc, 7468) - 10, 5)
  })

  it("puts the tooltip at the top of the plot on a stacked chart", () => {
    const s = spec({ stack: "pct", series: [{ name: "a", data: [100, 100, 100], color: INK }] })
    expect(chartReading(s, chartScale(s), 0.5, fmt).tipTop).toBe(CH_PT - 10)
  })
})
