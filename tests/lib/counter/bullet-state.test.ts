import { describe, expect, it } from "vitest"
import {
  bstat,
  bulletGeometry,
  bwords,
  isJudged,
  shaped,
  sparkGeometry,
  type Reference,
} from "@/lib/counter/bullet-state"

/**
 * These are the numbers a red cell depends on. Every threshold below is
 * asserted at its exact boundary and one step either side, so moving a
 * constant cannot pass silently — proved by moving each of the three
 * (`dist < 0`, `span * 0.10`, `|target| * 0.12`) by 0.1 and watching this file
 * go red. See task-3-report.md for the three failure outputs.
 */

const band = (v: number, better: "low" | "high" = "high"): Reference => ({
  v,
  lo: 100,
  hi: 200,
  better,
})
const target = (v: number, better: "low" | "high" = "high"): Reference => ({
  v,
  target: 1000,
  better,
})

describe("isJudged", () => {
  it("is true for a band and for a target", () => {
    expect(isJudged(band(150))).toBe(true)
    expect(isJudged(target(1500))).toBe(true)
  })

  it("is false for a reference that only carries a series", () => {
    expect(isJudged({ v: 12, better: "high", series: [1, 2, 3] })).toBe(false)
  })
})

describe("bstat — a band, where good is high", () => {
  // edge = lo = 100, span = hi - lo = 100, so the warning zone is [100, 110).
  it("breaches the moment the figure falls below the floor", () => {
    expect(bstat(band(99.999))).toBe("breach")
  })

  it("is NEAR, not breached, exactly on the floor — dist 0 is not dist < 0", () => {
    expect(bstat(band(100))).toBe("near")
  })

  it("is still near just inside a tenth of the span", () => {
    expect(bstat(band(109.999))).toBe("near")
  })

  it("is ok exactly at a tenth of the span — the near zone is half-open", () => {
    expect(bstat(band(110))).toBe("ok")
  })

  it("is ok comfortably inside the band", () => {
    expect(bstat(band(150))).toBe("ok")
  })

  it("is ok above the ceiling too — the ceiling is not the failure direction", () => {
    expect(bstat(band(400))).toBe("ok")
  })
})

describe("bstat — a band, where good is low", () => {
  // edge = hi = 200, and the figure fails by RISING.
  it("breaches above the ceiling", () => {
    expect(bstat(band(200.001, "low"))).toBe("breach")
  })

  it("is near exactly on the ceiling", () => {
    expect(bstat(band(200, "low"))).toBe("near")
  })

  it("is ok exactly a tenth of the span below the ceiling", () => {
    expect(bstat(band(190, "low"))).toBe("ok")
  })

  it("is ok below the floor — labour costing less than planned is not a breach", () => {
    expect(bstat(band(10, "low"))).toBe("ok")
  })
})

describe("bstat — a target, whose span is 12% of its own magnitude", () => {
  /*
   * A target has no width of its own, so one is invented: 12% of the target's
   * magnitude. The near zone is then a TENTH OF THAT — the same `span * 0.10`
   * the band branch uses — so for a target of 1000 it is [1000, 1012), not
   * [1000, 1120). The two constants compound; reading 0.12 as the warning
   * width is the obvious misreading and it is off by an order of magnitude.
   */
  it("breaches just below the target when good is high", () => {
    expect(bstat(target(999.999))).toBe("breach")
  })

  it("is near exactly on the target", () => {
    expect(bstat(target(1000))).toBe("near")
  })

  it("is still near just inside a tenth of the invented span", () => {
    expect(bstat(target(1011.999))).toBe("near")
  })

  it("is ok exactly at a tenth of the invented span — 1.2% of the target", () => {
    expect(bstat(target(1012))).toBe("ok")
  })

  it("the two multipliers COMPOUND — the near zone is 1.2% of the target, not 12%", () => {
    /*
     * The brief for this task stated both constants without noticing they
     * multiply, and reading 0.12 as the warning width is off by a factor of
     * ten in exactly the direction that matters: it makes "at the edge" fire
     * on figures that are comfortably fine.
     *
     * This fixture is chosen to DISCRIMINATE. A figure 5% above its target is
     * unambiguously ok. Under a 12% reading the near zone runs to 1120 and
     * this same figure reads "at the edge". If someone "fixes" bstat back to
     * the brief, this is the test that stops them.
     */
    expect(bstat(target(1050))).toBe("ok")
    expect(bstat(target(1100))).toBe("ok")
    // ...while the real 1.2% boundary still behaves:
    expect(bstat(target(1011.9))).toBe("near")
    expect(bstat(target(1012))).toBe("ok")
  })

  it("mirrors for a target where good is low", () => {
    expect(bstat(target(1000.001, "low"))).toBe("breach")
    expect(bstat(target(1000, "low"))).toBe("near")
    expect(bstat(target(988, "low"))).toBe("ok")
    expect(bstat(target(988.001, "low"))).toBe("near")
  })

  it("takes the ABSOLUTE value of a negative target, or its span comes out negative", () => {
    // span = |-50| * 0.12 = 6, near zone = 0.6, so ok begins at -49.4. Without
    // Math.abs the span is -6, `span * 0.10` is -0.6, and nothing is ever near
    // — every figure at or above the target reads ok.
    expect(bstat({ v: -50, target: -50, better: "high" })).toBe("near")
    expect(bstat({ v: -49.401, target: -50, better: "high" })).toBe("near")
    expect(bstat({ v: -49.4, target: -50, better: "high" })).toBe("ok")
  })

  it("prefers the target when a reference somehow carries both", () => {
    // The prototype checks `r.target != null` first; a band is only consulted
    // when there is no target.
    expect(bstat({ v: 150, lo: 100, hi: 200, target: 1000, better: "high" })).toBe("breach")
  })
})

describe("bstat — nothing to judge against", () => {
  it("returns ok rather than NaN-comparing its way there", () => {
    expect(bstat({ v: 12, better: "high" })).toBe("ok")
    expect(bstat({ v: 12, better: "low", series: [1, 2] })).toBe("ok")
  })
})

describe("bwords", () => {
  it("says nothing at all when the figure is ok", () => {
    expect(bwords(band(150))).toBeNull()
  })

  it("says 'under' when a figure that should be high has fallen through its floor", () => {
    expect(bwords(band(50))).toEqual({ status: "breach", word: "under" })
  })

  it("says 'over' when a figure that should be low has risen through its ceiling", () => {
    expect(bwords(band(500, "low"))).toEqual({ status: "breach", word: "over" })
  })

  it("says 'at the edge' either way when it is near", () => {
    expect(bwords(band(100))).toEqual({ status: "near", word: "at the edge" })
    expect(bwords(band(200, "low"))).toEqual({ status: "near", word: "at the edge" })
  })
})

describe("bulletGeometry — the domain", () => {
  it("pads the domain by half its own span and clamps the floor at zero", () => {
    // pts 100/150/200 -> pad 50 -> domain [50, 250], so 150 sits dead centre.
    const g = bulletGeometry(band(150))
    expect(g.band).toEqual({ left: "25.0%", width: "50.0%" })
    expect(g.fill).toEqual({ width: "50.0%" })
    expect(g.now).toEqual({ left: "50.0%" })
    expect(g.tick).toBeNull()
    expect(g.over).toBeNull()
    expect(g.status).toBe("ok")
  })

  it("never lets the domain start below zero, so a bar cannot run off the track", () => {
    // min - pad would be -25 here; d0 is clamped to 0.
    const g = bulletGeometry({ v: 50, lo: 50, hi: 150, better: "high" })
    expect(g.band!.left).toBe("25.0%")
  })

  it("falls back to 6% of the magnitude when every point is the same", () => {
    // A figure sitting exactly on its target has zero span. Without the `||`
    // fallback d1 - d0 is 0 and every coordinate is NaN.
    const g = bulletGeometry({ v: 5, target: 5, better: "high" })
    expect(g.now).toEqual({ left: "50.0%" })
    expect(g.tick).toEqual({ left: "50.0%" })
    expect(g.fill).toEqual({ width: "50.0%" })
  })

  it("draws a tick for a target and a band for a band, never both", () => {
    const t = bulletGeometry(target(1500))
    expect(t.tick).not.toBeNull()
    expect(t.band).toBeNull()

    const b = bulletGeometry(band(150))
    expect(b.band).not.toBeNull()
    expect(b.tick).toBeNull()
  })
})

describe("bulletGeometry — the overrun", () => {
  it("colours only the distance past the line, not the whole measure", () => {
    // v 300 against a ceiling of 200: the bar reads 300, the RED reads 100.
    const g = bulletGeometry(band(300, "low"))
    expect(g.status).toBe("breach")
    expect(g.fill.width).toBe("75.0%")
    expect(g.over).toEqual({ left: "50.0%", width: "25.0%" })
  })

  it("floors a hairline breach at 1.5% so it is still visible", () => {
    const g = bulletGeometry(band(99.9))
    expect(g.status).toBe("breach")
    expect(g.over!.width).toBe("1.5%")
  })

  it("draws no overrun at all when the figure is only near", () => {
    expect(bulletGeometry(band(100)).over).toBeNull()
  })
})

describe("sparkGeometry", () => {
  it("draws nothing for fewer than two points — one point is not a trend", () => {
    expect(sparkGeometry([])).toBeNull()
    expect(sparkGeometry([7])).toBeNull()
    expect(sparkGeometry(undefined)).toBeNull()
  })

  it("maps the series across 100 units wide and 15 tall, with 1.6 of padding", () => {
    const g = sparkGeometry([1, 2, 3])!
    expect(g.line).toBe("M0.0 13.4L50.0 7.5L100.0 1.6")
    expect(g.last).toEqual({ x: "100.0", y: "1.6" })
  })

  it("closes the area down to the baseline and back", () => {
    const g = sparkGeometry([1, 2, 3])!
    expect(g.area).toBe(`${g.line}L100 15L0 15Z`)
  })

  it("puts a flat series on one line instead of dividing by a zero range", () => {
    const g = sparkGeometry([5, 5, 5])!
    expect(g.line).toBe("M0.0 13.4L50.0 13.4L100.0 13.4")
  })
})

describe("shaped", () => {
  it("rescales a series so its mean is the figure the page states", () => {
    const out = shaped([1, 2, 3], 10)!
    expect(out).toEqual([5, 10, 15])
    expect(out.reduce((a, b) => a + b, 0) / out.length).toBe(10)
  })

  it("keeps the SHAPE while moving the level", () => {
    const out = shaped([4, 8, 4, 8], 100)!
    expect(out).toEqual([66.67, 133.33, 66.67, 133.33])
  })

  it("rounds to two decimals, because that is the precision a spark needs", () => {
    expect(shaped([1, 2], 1)).toEqual([0.67, 1.33])
  })

  it("does not divide by a zero mean", () => {
    // Without Math.max(0.0001, m) the scale factor is Infinity and every
    // point becomes 0 * Infinity = NaN, so the spark's path is unparseable
    // and it disappears. (Not Infinity itself — the multiply is what breaks.)
    expect(shaped([0, 0, 0], 5)).toEqual([0, 0, 0])
  })

  it("passes an empty or absent series straight through", () => {
    expect(shaped([], 5)).toEqual([])
    expect(shaped(undefined, 5)).toBeUndefined()
  })
})
