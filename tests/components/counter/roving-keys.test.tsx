// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { rovingKeyDown } from "@/components/counter/roving-keys"
import { ThemeToggle } from "@/components/counter/theme-toggle"
import { CounterThemeProvider } from "@/components/counter/theme-provider"

function Menu({ onPick }: { onPick: (v: string) => void }) {
  return (
    <div role="menu" aria-label="Actions" onKeyDown={(e) => rovingKeyDown(e, '[role="menuitem"]')}>
      {["Rename", "Fork", "Delete"].map((v) => (
        <button key={v} type="button" role="menuitem" onClick={() => onPick(v)}>
          {v}
        </button>
      ))}
    </div>
  )
}

function Radios({ onPick }: { onPick: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Start from" onKeyDown={(e) => rovingKeyDown(e, '[role="radio"]', { select: true })}>
      {["Blank", "Burger"].map((v) => (
        <button key={v} type="button" role="radio" aria-checked={v === "Blank"} onClick={() => onPick(v)}>
          {v}
        </button>
      ))}
    </div>
  )
}

describe("rovingKeyDown", () => {
  it("moves focus through a menu with the arrows, wrapping, and Home/End", () => {
    const pick = vi.fn()
    render(<Menu onPick={pick} />)
    const [rename, fork, del] = screen.getAllByRole("menuitem")
    rename.focus()
    fireEvent.keyDown(rename, { key: "ArrowDown" })
    expect(document.activeElement).toBe(fork)
    fireEvent.keyDown(fork, { key: "ArrowUp" })
    fireEvent.keyDown(rename, { key: "ArrowUp" })
    expect(document.activeElement).toBe(del)
    fireEvent.keyDown(del, { key: "Home" })
    expect(document.activeElement).toBe(rename)
    fireEvent.keyDown(rename, { key: "End" })
    expect(document.activeElement).toBe(del)
    expect(pick).not.toHaveBeenCalled()
  })

  it("selects as it moves in a radio group", () => {
    const pick = vi.fn()
    render(<Radios onPick={pick} />)
    const [blank, burger] = screen.getAllByRole("radio")
    blank.focus()
    fireEvent.keyDown(blank, { key: "ArrowRight" })
    expect(document.activeElement).toBe(burger)
    expect(pick).toHaveBeenCalledWith("Burger")
  })

  it("leaves other keys alone", () => {
    render(<Menu onPick={() => {}} />)
    const [rename] = screen.getAllByRole("menuitem")
    rename.focus()
    fireEvent.keyDown(rename, { key: "a" })
    expect(document.activeElement).toBe(rename)
  })
})

describe("ThemeToggle", () => {
  it("is a group of pressed buttons, not radios that are also pressed", () => {
    render(
      <CounterThemeProvider>
        <ThemeToggle />
      </CounterThemeProvider>,
    )
    const group = screen.getByRole("group", { name: "Theme" })
    expect(group.querySelector('[role="radio"]')).toBeNull()
    const buttons = screen.getAllByRole("button")
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"])
    expect(buttons.some((b) => b.hasAttribute("aria-checked"))).toBe(false)
  })
})
