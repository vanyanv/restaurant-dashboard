// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { useState } from "react"
import { render, fireEvent } from "@testing-library/react"
import { dropIndex, shiftFor, useDragReorder } from "@/components/counter/motion/use-drag-reorder"
import { Grip } from "@/components/counter/ui"

// Five rows, 40 tall, 8 apart.
const ROWS = [0, 48, 96, 144, 192].map((top) => ({ top, height: 40 }))

describe("dropIndex", () => {
  it("stays put until the held row's middle passes a neighbour's middle", () => {
    expect(dropIndex(ROWS, 2, 0)).toBe(2)
    expect(dropIndex(ROWS, 2, 47)).toBe(2)
    expect(dropIndex(ROWS, 2, 49)).toBe(3)
    expect(dropIndex(ROWS, 2, -49)).toBe(1)
  })
  it("lands on the ends when dragged past them", () => {
    expect(dropIndex(ROWS, 4, -500)).toBe(0)
    expect(dropIndex(ROWS, 0, 500)).toBe(4)
  })
})

describe("shiftFor", () => {
  it("moves the rows between the old slot and the new one aside, and no others", () => {
    // row 4 hovering over slot 1: rows 1..3 step down one place
    expect([0, 1, 2, 3, 4].map((i) => shiftFor(i, 4, 1, 48))).toEqual([0, 48, 48, 48, 0])
    // row 0 hovering over slot 2: rows 1..2 step up
    expect([0, 1, 2, 3, 4].map((i) => shiftFor(i, 0, 2, 48))).toEqual([0, -48, -48, 0, 0])
  })
})

function List() {
  const [items, setItems] = useState(["Fryers", "Walk-in", "Cash"])
  const reorder = useDragReorder()
  return (
    <ul>
      {items.map((it, i) => (
        <li key={it} data-reorder-row>
          <Grip
            label={it}
            {...reorder.grip(i, (from, to) =>
              setItems((l) => {
                const next = [...l]
                next.splice(to, 0, ...next.splice(from, 1))
                return next
              }),
            )}
          />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

const order = (c: HTMLElement) => [...c.querySelectorAll("li span")].map((s) => s.textContent)

describe("useDragReorder on the keyboard", () => {
  it("moves the row one place with the arrow keys and keeps the focus on its grip", () => {
    const { container } = render(<List />)
    const grips = () => [...container.querySelectorAll<HTMLElement>(".cu-grip")]
    grips()[2].focus()
    fireEvent.keyDown(grips()[2], { key: "ArrowUp" })
    expect(order(container)).toEqual(["Fryers", "Cash", "Walk-in"])
    expect(document.activeElement).toBe(grips()[1])
    fireEvent.keyDown(grips()[1], { key: "ArrowUp" })
    expect(order(container)).toEqual(["Cash", "Fryers", "Walk-in"])
  })
  it("does nothing at the ends", () => {
    const { container } = render(<List />)
    fireEvent.keyDown(container.querySelectorAll(".cu-grip")[0], { key: "ArrowUp" })
    expect(order(container)).toEqual(["Fryers", "Walk-in", "Cash"])
  })
  it("names the row and how to move it", () => {
    const { container } = render(<List />)
    expect(container.querySelector(".cu-grip")!.getAttribute("aria-label")).toBe("Move Fryers. Drag, or press the up and down arrow keys.")
  })
})
