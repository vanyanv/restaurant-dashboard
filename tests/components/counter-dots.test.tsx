// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { Dots } from "@/components/counter"

describe("Dots", () => {
  it("always renders four slots, filling the first n", () => {
    const { container } = render(<Dots filled={3} />)
    const all = container.querySelectorAll(".dots i")
    expect(all).toHaveLength(4)
    expect(container.querySelectorAll(".dots i.on")).toHaveLength(3)
  })

  // A confidence meter that renders three slots at low confidence and four at
  // high is a meter whose LENGTH encodes the value twice. The prototype always
  // draws four.
  it("renders four slots at zero", () => {
    const { container } = render(<Dots filled={0} />)
    expect(container.querySelectorAll(".dots i")).toHaveLength(4)
    expect(container.querySelectorAll(".dots i.on")).toHaveLength(0)
  })

  it("clamps out-of-range input rather than rendering a fifth slot", () => {
    const { container } = render(<Dots filled={9} />)
    expect(container.querySelectorAll(".dots i")).toHaveLength(4)
    expect(container.querySelectorAll(".dots i.on")).toHaveLength(4)
  })
})
