// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { StoreSwitcher } from "@/components/counter/shell/store-switcher"

const stores = [
  { id: "hollywood", name: "Hollywood", stage: "trading" as const },
  { id: "glendale", name: "Glendale", stage: "pre_open" as const },
  { id: "vannuys", name: "Van Nuys", stage: "warming_up" as const },
]

describe("StoreSwitcher", () => {
  it("offers every store plus all of them", () => {
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByRole("radio", { name: /all stores/i })).toBeTruthy()
    expect(screen.getByRole("radio", { name: /hollywood/i })).toBeTruthy()
    expect(screen.getAllByRole("radio")).toHaveLength(4)
  })

  it("marks the selection with aria-checked, not just colour", () => {
    render(<StoreSwitcher stores={stores} selectedId="hollywood" onSelect={() => {}} />)
    const checked = screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true")
    expect(checked).toHaveLength(1)
    expect(checked[0].textContent).toContain("Hollywood")
  })

  it("treats a null selection as all stores", () => {
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByRole("radio", { name: /all stores/i }).getAttribute("aria-checked")).toBe("true")
  })

  it("reports the chosen store, and null for all", () => {
    const onSelect = vi.fn()
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={onSelect} />)
    screen.getByRole("radio", { name: /hollywood/i }).click()
    expect(onSelect).toHaveBeenCalledWith("hollywood")
    screen.getByRole("radio", { name: /all stores/i }).click()
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it("names a store's stage, because a pre-open store has no figures for a reason", () => {
    // Note 58: the model has three stages and only two were ever expressible.
    // A reader seeing an empty Glendale needs to know it is not trading yet,
    // not that the sync failed.
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByText(/opening soon/i)).toBeTruthy()
    expect(screen.getByText(/warming up/i)).toBeTruthy()
  })

  it("is a radiogroup with an accessible name", () => {
    render(<StoreSwitcher stores={stores} selectedId={null} onSelect={() => {}} />)
    expect(screen.getByRole("radiogroup", { name: /store/i })).toBeTruthy()
  })
})
