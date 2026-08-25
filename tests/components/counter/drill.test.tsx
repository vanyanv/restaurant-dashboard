// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { Drill } from "@/components/counter/surface/drill"

describe("Drill", () => {
  it("emits the prototype's DOM: .drill > .drill__t + .ldrawer > .lpanel", () => {
    const { container } = render(
      <Drill label="Every figure against the same 4 weekdays">
        <p>a table</p>
      </Drill>,
    )
    expect(container.querySelector(".drill")).toBeTruthy()
    expect(container.querySelector(".drill > .drill__t")).toBeTruthy()
    expect(container.querySelector(".drill > .ldrawer > .lpanel")).toBeTruthy()
    // the chevron the sheet rotates
    expect(container.querySelector(".drill__t .car svg")).toBeTruthy()
  })

  it("starts closed: aria-expanded false, and the drawer carries no .is-open", () => {
    const { container } = render(<Drill label="Details">panel</Drill>)
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("false")
    expect(container.querySelector(".ldrawer")!.className).toBe("ldrawer")
  })

  it("aria-controls names the panel it opens — a real element, not a dangling id", () => {
    const { container } = render(<Drill label="Details">panel</Drill>)
    const controls = screen.getByRole("button").getAttribute("aria-controls")
    expect(controls).toBeTruthy()
    const panel = container.querySelector(`#${CSS.escape(controls!)}`)
    expect(panel).toBeTruthy()
    expect(panel!.className).toMatch(/ldrawer/)
  })

  it("clicking the toggle opens it, and clicking again closes it", () => {
    const { container } = render(<Drill label="Details">panel</Drill>)
    const toggle = screen.getByRole("button")

    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector(".ldrawer")!.className).toMatch(/is-open/)

    fireEvent.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(container.querySelector(".ldrawer")!.className).not.toMatch(/is-open/)
  })

  it("the panel stays MOUNTED when closed, so aria-controls never points at nothing", () => {
    render(
      <Drill label="Details">
        <span>the comparison table</span>
      </Drill>,
    )
    // present in the DOM while the sheet hides it with display:none
    expect(screen.getByText("the comparison table")).toBeTruthy()
  })

  it("two drills on one page do not share a panel id", () => {
    render(
      <>
        <Drill label="One">a</Drill>
        <Drill label="Two">b</Drill>
      </>,
    )
    const ids = screen.getAllByRole("button").map((b) => b.getAttribute("aria-controls"))
    expect(ids[0]).not.toBe(ids[1])
  })

  it("drill--wide is a modifier on .drill, not a replacement for it", () => {
    const { container } = render(
      <Drill label="Every figure" wide>
        table
      </Drill>,
    )
    const drill = container.querySelector(".drill")!
    expect(drill.className).toBe("drill drill--wide")
  })

  it("defaultOpen renders open on first paint, without a click", () => {
    const { container } = render(
      <Drill label="Details" defaultOpen>
        panel
      </Drill>,
    )
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true")
    expect(container.querySelector(".ldrawer")!.className).toMatch(/is-open/)
  })
})
