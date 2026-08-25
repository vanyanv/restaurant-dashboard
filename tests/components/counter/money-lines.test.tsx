// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { MoneyLines } from "@/components/counter/surface/money-lines"

const ROWS = [
  { label: "Received", value: "34 · $18,420" },
  { label: "Posted to COGS", value: "31 · $16,280" },
  { label: "In review", value: "3 · $2,140", tone: "warn" as const },
  { label: "Does not reconcile", value: "1", total: true },
]

describe("MoneyLines", () => {
  it("emits one .moneyline per row, each a label and a figure", () => {
    const { container } = render(<MoneyLines rows={ROWS} />)
    const lines = Array.from(container.querySelectorAll(".moneyline"))
    expect(lines).toHaveLength(4)
    expect(lines[0].querySelectorAll("span")).toHaveLength(2)
    expect(lines[0].textContent).toBe("Received34 · $18,420")
  })

  it("wraps the rows in NOTHING — .moneyline:last-child is what drops the last rule", () => {
    const { container } = render(<MoneyLines rows={ROWS} />)
    // the rows are direct children of whatever mounted them, not of a div
    // this component added
    expect(Array.from(container.children).map((c) => c.className)).toEqual([
      "moneyline",
      "moneyline",
      "moneyline",
      "moneyline total",
    ])
  })

  it("the total is a SHAPE, and it takes no colour of its own", () => {
    const { container } = render(<MoneyLines rows={ROWS} />)
    const total = container.querySelector(".moneyline.total")!
    expect((total.querySelectorAll("span")[1] as HTMLElement).style.color).toBe("")
    expect((total.querySelectorAll("span")[1] as HTMLElement).style.fontWeight).toBe("")
  })

  it("a toned figure reads its colour from a token, and is bolded like the prototype's", () => {
    const { container } = render(<MoneyLines rows={ROWS} />)
    const warn = container.querySelectorAll(".moneyline")[2].querySelectorAll("span")[1] as HTMLElement
    expect(warn.style.color).toBe("var(--warn)")
    expect(warn.style.fontWeight).toBe("600")
  })

  it("an untoned figure is left at the row's own weight", () => {
    const { container } = render(<MoneyLines rows={ROWS} />)
    const plain = container.querySelectorAll(".moneyline")[0].querySelectorAll("span")[1] as HTMLElement
    expect(plain.getAttribute("style")).toBeNull()
  })

  it("renders duplicate labels without colliding", () => {
    const { container } = render(
      <MoneyLines rows={[{ label: "Other", value: "$1" }, { label: "Other", value: "$2" }]} />,
    )
    expect(container.querySelectorAll(".moneyline")).toHaveLength(2)
  })
})
