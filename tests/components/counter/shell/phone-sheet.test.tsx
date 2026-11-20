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
  it("opens as a native modal dialog and moves focus inside", () => {
    // Tab containment and the inert page behind are the browser's, from showModal().
    const { first, dialog } = openPicker()
    expect(dialog.tagName).toBe("DIALOG")
    expect((dialog as HTMLDialogElement).open).toBe(true)
    expect(document.activeElement).toBe(first)
  })
  it("closes and restores the trigger on Escape", () => {
    const { trigger, last, dialog } = openPicker()
    last.focus()
    fireEvent.keyDown(last, { key: "Escape" })
    expect(document.activeElement).toBe(trigger)
    expect((dialog as HTMLDialogElement).open).toBe(false)
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
