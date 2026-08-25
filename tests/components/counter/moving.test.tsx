// @vitest-environment jsdom
/**
 * `.moving` — the honesty strip, prototype line 4295.
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { Moving } from "@/components/counter/surface/moving"

const CELLS = [
  {
    label: "Still moving",
    value: "$412 to the call",
    note: "Against a $6,180 forecast · 20 minutes of service left",
  },
  {
    label: "Not in the figures",
    value: "$2,140 unposted",
    note: "3 invoices approved but not posted · COGS understated",
  },
  {
    label: "Labor posted",
    value: "$1,852",
    note: "104 hours at $17.80 loaded · last punch 9:12pm",
  },
]

describe("Moving", () => {
  it("is a .moving of bare divs — .moving>div is the rule that lays them out", () => {
    const { container } = render(<Moving cells={CELLS} />)
    const strip = container.querySelector(".moving") as HTMLElement
    expect(strip.children).toHaveLength(3)
    // A class on a cell would be markup no ported rule reads; the layout,
    // the padding and the dividing rule all key on `.moving>div`.
    expect([...strip.children].every((c) => c.className === "")).toBe(true)
  })

  it("each cell is k, then v, then n — what is open, how much, and why it is not above", () => {
    const { container } = render(<Moving cells={CELLS} />)
    const first = container.querySelector(".moving > div") as HTMLElement
    expect([...first.children].map((c) => c.className)).toEqual(["k", "v", "n"])
    expect(first.querySelector(".k")?.textContent).toBe("Still moving")
    expect(first.querySelector(".v")?.textContent).toBe("$412 to the call")
    expect(first.querySelector(".n")?.textContent).toBe(
      "Against a $6,180 forecast · 20 minutes of service left",
    )
  })

  it("renders exactly the cells it is given, in order", () => {
    const { container } = render(<Moving cells={CELLS} />)
    expect([...container.querySelectorAll(".moving .k")].map((k) => k.textContent)).toEqual([
      "Still moving",
      "Not in the figures",
      "Labor posted",
    ])
  })

  it("a single cell still gets the strip — a day in progress has one thing open", () => {
    const { container } = render(<Moving cells={[CELLS[0]]} />)
    expect(container.querySelectorAll(".moving > div")).toHaveLength(1)
  })

  it("renders no state of its own — Section decides whether there is anything to be honest about", () => {
    const { container } = render(<Moving cells={CELLS} />)
    expect(container.querySelector(".skb")).toBeNull()
  })
})
