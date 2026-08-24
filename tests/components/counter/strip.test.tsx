// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Figure } from "@/components/counter/surface/figure"
import { Strip } from "@/components/counter/surface/strip"

describe("Figure", () => {
  it("renders label, value and caption", () => {
    render(<Figure label="Net sales" value="$7,468" caption="gross $9,681" />)
    expect(screen.getByText("Net sales")).toBeTruthy()
    expect(screen.getByText("$7,468")).toBeTruthy()
    expect(screen.getByText("gross $9,681")).toBeTruthy()
  })

  it("every figure carries tabular lining numerals, or columns do not line up", () => {
    render(<Figure label="Net sales" value="$7,468" />)
    expect(screen.getByText("$7,468").className).toMatch(/tabular-nums/)
    expect(screen.getByText("$7,468").className).toMatch(/lining-nums/)
  })

  it("a lead figure is larger than a strip cell", () => {
    const { container: lead } = render(<Figure label="a" value="1" size="lead" />)
    const { container: cell } = render(<Figure label="a" value="1" />)
    expect(lead.querySelector("[data-figure-value]")!.className)
      .not.toBe(cell.querySelector("[data-figure-value]")!.className)
  })

  it("renders a delta when given one", () => {
    render(<Figure label="Net sales" value="$7,468" delta="▲ 11.4%" />)
    expect(screen.getByText("▲ 11.4%")).toBeTruthy()
  })
})

describe("Strip", () => {
  const cells = [
    { label: "Net sales", value: "$7,468" },
    { label: "Orders", value: "376" },
    { label: "Avg ticket", value: "$19.86" },
  ]

  it("renders one cell per figure", () => {
    const { container } = render(<Strip cells={cells} />)
    expect(container.querySelectorAll("[data-figure-value]")).toHaveLength(3)
  })

  it("the cell count is just the length of what it's given — no separate count to pass or drift", () => {
    const { container } = render(<Strip cells={cells.slice(0, 2)} />)
    expect(container.querySelectorAll("[data-figure-value]")).toHaveLength(2)
  })

  it("renders whatever values it's handed, including a caller-supplied em-dash", () => {
    render(<Strip cells={[{ label: "Net sales", value: "—" }]} />)
    expect(screen.getByText("—")).toBeTruthy()
  })
})
