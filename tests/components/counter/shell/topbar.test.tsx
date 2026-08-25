// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Topbar } from "@/components/counter/shell/topbar"

describe("Topbar", () => {
  it("names the page it is on", () => {
    render(<Topbar pathname="/dashboard/invoices" title="Invoices" />)
    expect(screen.getByRole("heading", { name: "Invoices" })).toBeTruthy()
  })

  it("shows a breadcrumb back to the parent on a detail route", () => {
    // The route IS the hierarchy (note 48): /dashboard/invoices/I28517 makes
    // Invoices the parent, and nothing is hand-wired.
    render(<Topbar pathname="/dashboard/invoices/I28517" title="Invoice I28517" />)
    const crumb = screen.getByRole("navigation", { name: /breadcrumb/i })
    expect(crumb.textContent).toContain("Invoices")
  })

  it("shows no breadcrumb on a top-level page", () => {
    render(<Topbar pathname="/dashboard/invoices" title="Invoices" />)
    expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).toBeNull()
  })

  it("says when the figures were last synced", () => {
    render(<Topbar pathname="/dashboard" title="Overview" syncedAt={new Date(2026, 7, 24, 9, 0)} />)
    expect(screen.getByText(/synced/i)).toBeTruthy()
  })

  it("renders its controls slot", () => {
    render(<Topbar pathname="/dashboard" title="Overview"><span>controls</span></Topbar>)
    expect(screen.getByText("controls")).toBeTruthy()
  })
})
