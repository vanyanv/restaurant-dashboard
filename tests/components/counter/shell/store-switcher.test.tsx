// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { StoreSwitcher } from "@/components/counter/shell/store-switcher"

const stores = [
  { id: "hollywood", name: "Hollywood", stage: "trading" as const },
  { id: "glendale", name: "Glendale", stage: "pre_open" as const },
  { id: "vannuys", name: "Van Nuys", stage: "warming_up" as const },
]

/**
 * The radiogroup now lives behind a single-line trigger (a real-browser
 * finding: see docs/counter/controls-verification.md — a bare radiogroup
 * mounted directly in a topbar produced a four-row stack next to
 * DateControl's one-line trigger). Every test below opens that popover
 * first. It MUST be `fireEvent`, not a raw `.click()`: under React 19 +
 * RTL 16 + jsdom, `.click()` runs the handler but the resulting `setState`
 * does not commit before the next synchronous line — only `fireEvent`
 * (act-wrapped) flushes in time for the assertion right after it.
 */
function openSwitcher() {
  fireEvent.click(screen.getByRole("button", { name: /all stores|hollywood|glendale|van nuys/i }))
}

describe("StoreSwitcher", () => {
  it("shows the current selection on its trigger", () => {
    const { rerender } = render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByRole("button", { name: /all stores/i })).toBeTruthy()

    rerender(<StoreSwitcher stores={stores} selectedId="hollywood" onSelect={() => {}} />)
    expect(screen.getByRole("button", { name: /hollywood/i })).toBeTruthy()
  })

  it("offers every store plus all of them", () => {
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    openSwitcher()
    expect(screen.getByRole("radio", { name: /all stores/i })).toBeTruthy()
    expect(screen.getByRole("radio", { name: /hollywood/i })).toBeTruthy()
    expect(screen.getAllByRole("radio")).toHaveLength(4)
  })

  it("marks the selection with aria-checked, not just colour", () => {
    render(<StoreSwitcher stores={stores} selectedId="hollywood" onSelect={() => {}} />)
    openSwitcher()
    const checked = screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")
    expect(checked).toHaveLength(1)
    expect(checked[0].textContent).toContain("Hollywood")
  })

  it("treats a null selection as all stores", () => {
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    openSwitcher()
    expect(screen.getByRole("radio", { name: /all stores/i }).getAttribute("aria-checked")).toBe("true")
  })

  it("reports the chosen store, and null for all", () => {
    const onSelect = vi.fn()
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={onSelect} />)
    openSwitcher()
    fireEvent.click(screen.getByRole("radio", { name: /hollywood/i }))
    expect(onSelect).toHaveBeenCalledWith("hollywood")

    // Selecting closes the popover (same contract as DateControl's menus),
    // so it has to be reopened for the second choice.
    openSwitcher()
    fireEvent.click(screen.getByRole("radio", { name: /all stores/i }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it("names a store's stage, because a pre-open store has no figures for a reason", () => {
    // Note 58: the model has three stages and only two were ever expressible.
    // A reader seeing an empty Glendale needs to know it is not trading yet,
    // not that the sync failed.
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    openSwitcher()
    expect(screen.getByText(/opening soon/i)).toBeTruthy()
    expect(screen.getByText(/warming up/i)).toBeTruthy()
  })

  it("is a radiogroup with an accessible name", () => {
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    openSwitcher()
    expect(screen.getByRole("radiogroup", { name: /store/i })).toBeTruthy()
  })

  it("closes without selecting on Escape", () => {
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    openSwitcher()
    expect(screen.getByRole("radiogroup", { name: /store/i })).toBeTruthy()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("radiogroup", { name: /store/i })).toBeNull()
  })
})
