// @vitest-environment jsdom
import { useState } from "react"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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

async function openPicker() {
  render(<Picker />)
  const trigger = screen.getByRole("button", { name: "Pick a store" })
  trigger.focus()
  fireEvent.click(trigger)
  // The drawer's code loads on the first open (next/dynamic).
  const dialog = await screen.findByRole("dialog", { name: "Stores" })
  return { trigger, dialog, first: within(dialog).getByRole("button", { name: "First 0" }), last: within(dialog).getByRole("button", { name: "Last" }) }
}

describe("phone sheet (ui-sdk Drawer)", () => {
  it("renders nothing until first opened, so the drawer is not in the first load", () => {
    render(<Picker />)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.queryByText("First 0")).toBeNull()
  })
  it("opens as a modal sheet named by its title, with the grab bar and heading", async () => {
    const { dialog } = await openPicker()
    expect(dialog.getAttribute("id")).toBe("stores")
    expect(dialog.classList.contains("msheet")).toBe(true)
    expect(within(dialog).getByRole("heading", { name: "Stores" })).toBeTruthy()
  })
  it("closes on Escape and hands focus back to the trigger", async () => {
    const { trigger, last } = await openPicker()
    last.focus()
    fireEvent.keyDown(last, { key: "Escape" })
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
  it("keeps its children's state between opens", async () => {
    const { first, last, trigger } = await openPicker()
    fireEvent.click(first)
    fireEvent.click(last)
    fireEvent.click(trigger)
    const dialog = await screen.findByRole("dialog", { name: "Stores" })
    expect(within(dialog).getByRole("button", { name: "First 1" })).toBeTruthy()
  })
})
