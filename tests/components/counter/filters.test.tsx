// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { Filters, type FilterToggle } from "@/components/counter/surface/filters"

const TOGGLES: FilterToggle[] = [
  { id: "house", label: "In-house", tint: "--ch-house", pressed: false },
  { id: "doordash", label: "DoorDash", tint: "--ch-dd", pressed: true },
]

function setup(over: Partial<Parameters<typeof Filters>[0]> = {}) {
  const props = {
    search: "",
    searchPlaceholder: "Order ID, customer, item",
    searchLabel: "Search orders",
    onSearch: vi.fn(),
    toggles: TOGGLES,
    onToggle: vi.fn(),
    count: "8 of 187",
    ...over,
  }
  const { container } = render(<Filters {...props} />)
  return { ...props, container }
}

describe("Filters", () => {
  it("presses exactly the toggles that are pressed", () => {
    setup()
    expect(screen.getByRole("button", { name: "In-house" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "DoorDash" })).toHaveAttribute("aria-pressed", "true")
  })

  it("hides the clear button rather than dropping it", () => {
    // Not screen.getByRole(..., { hidden: true }): @testing-library/dom@10's
    // queryAllByRole never forwards its `hidden` option into
    // dom-accessibility-api's computeAccessibleName (see
    // node_modules/@testing-library/dom/dist/queries/role.js), so a node
    // that is itself `hidden` always resolves to accessible name "" —
    // matching by name is therefore unable to find it at all, independent of
    // anything this component does. A plain DOM query proves the same
    // thing the brief's version intended: the button is present in the
    // document with its label, carrying `hidden`, not conditionally absent.
    const { container } = setup({ onClear: undefined })
    // `button.clear`, not `.clear`: matching by class alone would keep passing
    // if this stopped being a button, and `.filters .clear[hidden]` styles a
    // control the reader is meant to be able to press once it is shown.
    const clear = container.querySelector("button.clear")
    expect(clear).not.toBeNull()
    expect(clear).toHaveTextContent("Clear filters")
    expect(clear).toHaveAttribute("hidden")
  })

  it("shows the clear button when there is something to clear", () => {
    const onClear = vi.fn()
    setup({ onClear })
    const clear = screen.getByRole("button", { name: "Clear filters" })
    expect(clear).not.toHaveAttribute("hidden")
    fireEvent.click(clear)
    expect(onClear).toHaveBeenCalled()
  })

  it("puts the channel tint on the swatch as a custom property, not a colour", () => {
    setup()
    const dd = screen.getByRole("button", { name: "DoorDash" })
    expect(dd.getAttribute("style")).toBe("--pc: var(--ch-dd);")
  })

  it("omits --pc entirely when a toggle has no tint", () => {
    setup({ toggles: [{ id: "all", label: "All", pressed: false }] })
    expect(screen.getByRole("button", { name: "All" }).getAttribute("style")).toBeFalsy()
  })

  it("reports typing through onSearch", () => {
    const props = setup()
    fireEvent.change(screen.getByLabelText("Search orders"), { target: { value: "4821" } })
    expect(props.onSearch).toHaveBeenCalledWith("4821")
  })
})
