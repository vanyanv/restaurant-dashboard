// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Briefing } from "@/components/counter"

const LINES = [
  { key: "labor", lead: <b>Saturday is eleven hours short.</b>, body: " The forecast wants 214 orders.", figure: "$6,480" },
  { key: "beef", lead: <b>Beef is still climbing.</b>, body: " $4.86 a pound.", figure: "−$116" },
]

describe("Briefing", () => {
  it("numbers the lines from one, in order", () => {
    const { container } = render(<Briefing lines={LINES} />)
    const gutters = [...container.querySelectorAll(".briefline .g")].map((e) => e.textContent)
    expect(gutters).toEqual(["1", "2"])
  })

  it("renders one .briefline per line with its figure", () => {
    const { container } = render(<Briefing lines={LINES} />)
    expect(container.querySelectorAll(".briefline")).toHaveLength(2)
    expect(screen.getByText("$6,480")).toHaveClass("n")
  })

  // A briefing line with no figure still numbers correctly — the gutter is the
  // position in the list, not a count of lines that happen to carry a number.
  it("keeps numbering when a line carries no figure", () => {
    const { container } = render(
      <Briefing lines={[{ key: "a", lead: <b>A</b>, body: "", figure: null }, LINES[0]]} />,
    )
    expect([...container.querySelectorAll(".briefline .g")].map((e) => e.textContent)).toEqual(["1", "2"])
    expect(container.querySelectorAll(".briefline .n")).toHaveLength(1)
  })
})
