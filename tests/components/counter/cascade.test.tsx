// @vitest-environment jsdom
/**
 * The one thing a cascade must do is add up. Every other assertion here is
 * secondary to `it("reconciles")` — a picture of arithmetic that is wrong is
 * worse than no picture, because the reader trusts it over their own sum.
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { Cascade, type CascadeCut } from "@/components/counter/surface/cascade"

const START = { name: "Gross sales", sub: "1,024 orders", amount: 25_879 }
const CUTS: CascadeCut[] = [
  { name: "Marketplace commissions", sub: "DoorDash 25%, Uber Eats 23%", amount: 4_632 },
  { name: "Food", sub: "against a 29.0% target", amount: 8_126, over: true },
  { name: "Labor", sub: "612 hours at $23.40 loaded", amount: 6_418 },
  { name: "Occupancy", sub: "rent, prorated across 24 days", amount: 2_604 },
  { name: "Other operating", sub: "fixed lines and packaging", amount: 1_890 },
]
const END = { name: "Bottom line", sub: "8.5% of sales" }

/** "−$4,632" → 4632; "$2,209" → 2209. */
function figure(text: string): number {
  return Number(text.replace(/[^0-9.]/g, ""))
}

function readRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".wf__row")).map((r) => ({
    name: r.querySelector(".wf__k")!.textContent ?? "",
    value: r.querySelector(".wf__v")!.textContent ?? "",
    pct: r.querySelector(".wf__p")!.textContent ?? "",
    stay: (r.querySelector(".wf__stay") as HTMLElement).style.width,
    cut: r.querySelector(".wf__cut") as HTMLElement | null,
    className: r.className,
  }))
}

describe("Cascade", () => {
  it("RECONCILES: the start, minus every subtraction, is the figure on the last row", () => {
    const { container } = render(<Cascade start={START} cuts={CUTS} end={END} />)
    const rows = readRows(container)

    const start = figure(rows[0].value)
    const cuts = rows.slice(1, -1).map((r) => figure(r.value))
    const end = figure(rows[rows.length - 1].value)

    expect(start).toBe(25_879)
    expect(cuts).toHaveLength(5)
    expect(start - cuts.reduce((t, c) => t + c, 0)).toBe(end)
  })

  it("the bottom line is DERIVED, so no caller can state one the subtractions do not reach", () => {
    // `end` carries a name and no figure. Adding a cut moves the bottom line
    // on its own — there is no second place for it to be wrong.
    const { container } = render(
      <Cascade start={START} cuts={[...CUTS, { name: "Bank fees", amount: 200 }]} end={END} />,
    )
    const rows = readRows(container)
    expect(figure(rows[rows.length - 1].value)).toBe(25_879 - 23_670 - 200)
  })

  it("the bar is what is LEFT after the line, not the size of the line", () => {
    const { container } = render(<Cascade start={START} cuts={CUTS} end={END} />)
    const rows = readRows(container)
    // after commissions: 25,879 − 4,632 = 21,247 of 25,879 → 82.10%
    // jsdom normalises the emitted "82.10%" — the trailing zero the prototype
    // writes is cosmetic in the style attribute, not in the layout.
    expect(rows[1].stay).toBe("82.1%")
    // and the cut sits beside it, starting where the remainder ends
    expect(rows[1].cut!.style.left).toBe("82.1%")
    expect(rows[1].cut!.style.width).toBe("17.9%")
  })

  it("colour marks ONE exception — five cost rows are not five red bars", () => {
    const { container } = render(<Cascade start={START} cuts={CUTS} end={END} />)
    const over = container.querySelectorAll(".wf__cut.is-over")
    expect(over).toHaveLength(1)
    // and it is the row that beat its own target, not simply the largest
    const rows = readRows(container)
    expect(rows[2].name).toMatch(/^Food/)
    expect(rows[2].cut!.className).toMatch(/is-over/)
  })

  it("the first and last rows are totals; a positive bottom line is the only good one", () => {
    const { container } = render(<Cascade start={START} cuts={CUTS} end={END} />)
    const rows = readRows(container)
    expect(rows[0].className).toMatch(/is-total/)
    expect(rows[rows.length - 1].className).toMatch(/is-total/)
    expect(rows[rows.length - 1].className).toMatch(/is-good/)
    expect(rows[1].className).not.toMatch(/is-total|is-good/)
  })

  it("a statement that ran below zero is not painted as good", () => {
    const { container } = render(
      <Cascade start={START} cuts={[{ name: "Everything", amount: 30_000 }]} end={END} />,
    )
    const rows = readRows(container)
    expect(rows[rows.length - 1].className).not.toMatch(/is-good/)
    // and the bar cannot paint outside its track
    expect(rows[rows.length - 1].stay).toBe("0%")
  })

  it("a subtraction is written with a minus; a total is written plain", () => {
    const { container } = render(<Cascade start={START} cuts={CUTS} end={END} />)
    const rows = readRows(container)
    expect(rows[0].value).toBe("$25,879")
    expect(rows[1].value).toBe("−$4,632")
  })

  it("each line's percent is of the start, so the column is comparable down the page", () => {
    const { container } = render(<Cascade start={START} cuts={CUTS} end={END} />)
    const rows = readRows(container)
    expect(rows[0].pct).toBe("100.0%")
    expect(rows[1].pct).toBe("17.9%") // 4,632 / 25,879
    expect(rows[rows.length - 1].pct).toBe("8.5%") // 2,209 / 25,879
  })

  it("the sub-line renders inside the key, where the sheet styles it", () => {
    const { container } = render(<Cascade start={START} cuts={CUTS} end={END} />)
    expect(container.querySelector(".wf__k em")!.textContent).toBe("1,024 orders")
  })

  it("a line that took almost nothing still draws a sliver rather than vanishing", () => {
    const { container } = render(
      <Cascade start={START} cuts={[{ name: "Rounding", amount: 1 }]} end={END} />,
    )
    // 1 / 25,879 = 0.004% — floored at the prototype's 0.4%
    expect((container.querySelector(".wf__cut") as HTMLElement).style.width).toBe("0.4%")
  })

  it("a zero-revenue start collapses every bar to 0% rather than NaN%/Infinity%", () => {
    const { container } = render(
      <Cascade
        start={{ name: "Gross sales", amount: 0 }}
        cuts={[{ name: "Food", amount: 0 }]}
        end={END}
      />,
    )
    for (const row of readRows(container)) {
      expect(row.stay).toBe("0%")
      expect(row.pct).toBe("0.0%")
      expect(row.stay).not.toMatch(/NaN|Infinity/)
    }
  })

  it("renders duplicate line names without colliding", () => {
    const { container } = render(
      <Cascade
        start={START}
        cuts={[
          { name: "Other", amount: 100 },
          { name: "Other", amount: 200 },
        ]}
        end={END}
      />,
    )
    expect(container.querySelectorAll(".wf__row")).toHaveLength(4)
  })

  it("emits the prototype's classes and no Tailwind of its own", () => {
    const { container } = render(<Cascade start={START} cuts={CUTS} end={END} />)
    expect(container.querySelector(".wf")).toBeTruthy()
    expect(container.querySelectorAll(".wf__row")).toHaveLength(7)
    expect(container.querySelectorAll(".wf__stay")).toHaveLength(7)
    expect(container.querySelectorAll(".wf__k")).toHaveLength(7)
    expect(container.querySelectorAll(".wf__v")).toHaveLength(7)
    expect(container.querySelectorAll(".wf__p")).toHaveLength(7)
  })
})
