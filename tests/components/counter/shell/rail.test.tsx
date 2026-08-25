// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { Rail } from "@/components/counter/shell/rail"

describe("Rail", () => {
  it("is a navigation landmark with an accessible name", () => {
    render(<Rail pathname="/dashboard" />)
    expect(screen.getByRole("navigation", { name: /sections/i })).toBeTruthy()
  })

  it("renders all seventeen destinations", () => {
    render(<Rail pathname="/dashboard" />)
    expect(screen.getAllByRole("link")).toHaveLength(17)
  })

  it("renders the five group captions", () => {
    render(<Rail pathname="/dashboard" />)
    // Menu's caption and Menu's own first item share the literal string
    // "Menu" (the section is named after the page it leads with — see the
    // prototype's "the Menu hub is the Menu section's first tab"), so a bare
    // `getByText("Menu")` is genuinely ambiguous: two elements match,
    // regardless of how faithfully the rail is built. The caption is the
    // only one of the two rendered as a `<div>` (item labels render inside
    // an `<a>` as a `<span>`), so scoping the query to that tag disambiguates
    // without asserting anything about the item label's markup.
    for (const cap of ["Today", "Money", "Menu", "Stock and suppliers", "Admin"]) {
      expect(screen.getByText(cap, { selector: "div" })).toBeTruthy()
    }
  })

  it("marks exactly one destination current, and says so to a screen reader", () => {
    render(<Rail pathname="/dashboard/invoices" />)
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page")
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain("Invoices")
  })

  it("keeps the parent lit on a detail route", () => {
    render(<Rail pathname="/dashboard/invoices/I28517" />)
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page")
    expect(current[0].textContent).toContain("Invoices")
  })

  it("lights Overview alone on /dashboard, not all seventeen", () => {
    render(<Rail pathname="/dashboard" />)
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page")
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain("Overview")
  })

  it("groups its links so the caption names the set", () => {
    render(<Rail pathname="/dashboard" />)
    const money = screen.getByRole("group", { name: "Money" })
    expect(within(money).getAllByRole("link")).toHaveLength(4)
  })
})
