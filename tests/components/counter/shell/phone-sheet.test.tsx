// @vitest-environment jsdom
import { useState } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PhoneSheet } from "@/components/counter/shell/phone-sheet"

function Picker() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  return <>
    <button onClick={() => setOpen(true)}>Pick a store</button>
    <button>Background action</button>
    <PhoneSheet open={open} onClose={() => setOpen(false)} title="Stores" id="stores">
      <button onClick={() => setCount(count + 1)}>First {count}</button>
      <button onClick={() => setOpen(false)}>Last</button>
    </PhoneSheet>
  </>
}

function openPicker() {
  render(<Picker />)
  const trigger = screen.getByRole("button", { name: "Pick a store" })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = screen.getByRole("dialog", { name: "Stores" })
  return { trigger, dialog, first: within(dialog).getByRole("button", { name: "First 0" }), last: within(dialog).getByRole("button", { name: "Last" }) }
}

describe("phone sheet keyboard behavior", () => {
  it("moves focus inside, contains Tab in both directions, and makes the background inert", () => {
    const { first, last } = openPicker()
    expect(document.activeElement).toBe(first)
    expect(screen.getByRole("button", { name: "Background action" }).inert).toBe(true)
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: "Tab" })
    expect(document.activeElement).toBe(first)
  })
  it("restores the trigger and background on Escape", () => {
    const { trigger, last, dialog } = openPicker()
    last.focus()
    fireEvent.keyDown(last, { key: "Escape" })
    expect(document.activeElement).toBe(trigger)
    expect(dialog.getAttribute("aria-hidden")).toBe("true")
    expect(dialog.hasAttribute("inert")).toBe(true)
    expect(screen.getByRole("button", { name: "Background action" }).inert).toBeFalsy()
  })
  it("does not reset focus on a rerender, and returns focus after choosing", () => {
    const { trigger, first, last } = openPicker()
    fireEvent.click(first)
    expect(document.activeElement).toBe(first)
    last.focus()
    fireEvent.click(last)
    expect(document.activeElement).toBe(trigger)
  })
})
