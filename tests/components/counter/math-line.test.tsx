// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { MathLines, type MathRow } from "@/components/counter/surface/math-line"

const ROWS: MathRow[] = [
  { key: "ticket", label: "Ticket, as charged on DoorDash", value: "$36.65" },
  { key: "fee", label: "− commission 20%", op: true, value: "−$7.33" },
  { key: "net", label: "Net to you", value: "$29.32", strong: true, rule: true },
  { key: "cost", label: "− food cost", op: true, value: "−$8.10", noBorder: true },
]

describe("MathLines", () => {
  it("marks operations and terms differently", () => {
    const { container } = render(<MathLines rows={ROWS} />)
    const rows = container.querySelectorAll(".mathline")
    expect(rows).toHaveLength(4)
    expect(rows[0].querySelector("span.op")).toBeNull()
    expect(rows[1].querySelector("span.op")).not.toBeNull()
  })

  it("bolds both halves of a strong row", () => {
    const { container } = render(<MathLines rows={ROWS} />)
    const net = container.querySelectorAll(".mathline")[2]
    expect(net.querySelector("span > b")?.textContent).toBe("Net to you")
    expect(net.querySelector(":scope > b")?.textContent).toBe("$29.32")
  })

  it("draws the rule above a subtotal as a class, never an inline style", () => {
    const { container } = render(<MathLines rows={ROWS} />)
    const net = container.querySelectorAll(".mathline")[2]
    expect(net.className).toContain("is-rule")
    expect(net.getAttribute("style")).toBeFalsy()
  })

  it("opens the trailing rows", () => {
    const { container } = render(<MathLines rows={ROWS} />)
    expect(container.querySelectorAll(".mathline")[3].className).toContain("is-open")
  })
})
