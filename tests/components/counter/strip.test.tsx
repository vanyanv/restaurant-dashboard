// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Figure } from "@/components/counter/surface/figure"
import { Strip } from "@/components/counter/surface/strip"
import { ready, loading, empty } from "@/lib/counter/section-data"

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
  const cells = () => [
    { label: "Net sales", value: "$7,468" },
    { label: "Orders", value: "376" },
    { label: "Avg ticket", value: "$19.86" },
  ]

  it("renders one cell per figure when data is present", () => {
    const { container } = render(<Strip data={ready({})} cells={cells} />)
    expect(container.querySelectorAll("[data-figure-value]")).toHaveLength(3)
  })

  it("renders skeleton cells while loading, keeping the shape", () => {
    const { container } = render(<Strip data={loading()} cells={cells} cellCount={3} />)
    expect(container.querySelectorAll("[data-skeleton-cell]")).toHaveLength(3)
  })

  it("renders em-dashes rather than zeroes when empty", () => {
    render(<Strip data={empty("pre_open")} cells={cells} cellCount={3} />)
    expect(screen.getAllByText("—")).toHaveLength(3)
    expect(screen.queryByText("$0")).toBeNull()
  })
})
