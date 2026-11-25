// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { useState } from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { menuKeys, menuTrigger, radioKeys, tabKeys } from "@/components/counter/ui"

const key = (k: string, init = {}) => fireEvent.keyDown(document.activeElement!, { key: k, ...init })
const focused = () => document.activeElement?.textContent

function Group({ role, onKey, names }: { role: "tab" | "radio"; onKey: typeof tabKeys; names: string[] }) {
  const [on, setOn] = useState(names[0])
  return (
    <div onKeyDown={onKey}>
      {names.map((n) => (
        <button
          key={n}
          role={role}
          aria-selected={role === "tab" ? on === n : undefined}
          aria-checked={role === "radio" ? on === n : undefined}
          tabIndex={on === n ? 0 : -1}
          disabled={n === "Off"}
          onClick={() => setOn(n)}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

describe("tabs and radios", () => {
  it("is one tab stop, and the arrows move, wrap and pick", () => {
    render(<Group role="tab" onKey={tabKeys} names={["A", "B", "C"]} />)
    screen.getByText("A").focus()
    key("ArrowRight")
    expect(focused()).toBe("B")
    expect(screen.getAllByRole("tab").filter((t) => t.tabIndex === 0).map((t) => t.textContent)).toEqual(["B"])
    key("End")
    key("ArrowRight")
    expect(focused()).toBe("A")
    key("ArrowLeft")
    expect(focused()).toBe("C")
    expect(screen.getByText("C").getAttribute("aria-selected")).toBe("true")
  })

  it("leaves up and down, and browser shortcuts, alone in a tab row", () => {
    render(<Group role="tab" onKey={tabKeys} names={["A", "B"]} />)
    screen.getByText("A").focus()
    key("ArrowDown")
    key("ArrowRight", { altKey: true })
    expect(focused()).toBe("A")
  })

  it("takes all four arrows in a radio group and skips a disabled option", () => {
    render(<Group role="radio" onKey={radioKeys} names={["A", "Off", "B"]} />)
    screen.getByText("A").focus()
    key("ArrowDown")
    expect(focused()).toBe("B")
    expect(screen.getByText("B").getAttribute("aria-checked")).toBe("true")
    key("ArrowUp")
    expect(focused()).toBe("A")
  })
})

function Menu({ onRun }: { onRun: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button id="t" {...menuTrigger({ open, setOpen, menuId: "m" })}>
        More
      </button>
      {open ? (
        <div id="m" role="menu" onKeyDown={(e) => menuKeys(e, { close: () => setOpen(false), triggerId: "t" })}>
          <button role="menuitem" tabIndex={-1} onClick={onRun}>
            One
          </button>
          <button role="menuitem" tabIndex={-1}>
            Two
          </button>
        </div>
      ) : null}
    </>
  )
}

describe("menu", () => {
  it("enters from the keyboard, moves, and Escape gives focus back", () => {
    render(<Menu onRun={vi.fn()} />)
    screen.getByText("More").focus()
    key("ArrowDown")
    expect(focused()).toBe("One")
    key("ArrowUp")
    expect(focused()).toBe("Two")
    key("Escape")
    expect(focused()).toBe("More")
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("Enter on the button enters; a pointer press opens and stays on the button", () => {
    render(<Menu onRun={vi.fn()} />)
    const b = screen.getByText("More")
    b.focus()
    fireEvent.click(b, { detail: 1 })
    expect(screen.getByRole("menu")).toBeTruthy()
    expect(focused()).toBe("More")
    fireEvent.click(b, { detail: 1 })
    expect(screen.queryByRole("menu")).toBeNull()
    fireEvent.click(b, { detail: 0 })
    expect(focused()).toBe("One")
  })

  it("Tab closes it and carries on from the button", () => {
    render(<Menu onRun={vi.fn()} />)
    screen.getByText("More").focus()
    key("ArrowDown")
    key("Tab")
    expect(focused()).toBe("More")
    expect(screen.queryByRole("menu")).toBeNull()
  })
})
