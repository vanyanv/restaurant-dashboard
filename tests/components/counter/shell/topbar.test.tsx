// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Topbar } from "@/components/counter/shell/topbar"

describe("Topbar", () => {
  // THE THIRD OF TASK 5'S THREE STRUCTURAL CORRECTIONS. `deskFor()` puts
  // exactly three things in the topbar; everything else that used to be here
  // moved to the rail (the store switcher) or to `.pagehead` (the title, the
  // subtitle and the date control).
  it("carries the breadcrumb, a spacer and the ask button — and no page title", () => {
    const { container } = render(<Topbar pathname="/dashboard" storeName="Hollywood" />)
    const bar = container.querySelector(".topbar") as HTMLElement
    expect(bar.querySelector(".crumbs")).toBeTruthy()
    expect(bar.querySelector(".spacer")).toBeTruthy()
    expect(bar.querySelector(".askbtn")).toBeTruthy()
    // The page title is `.pagehead h2`'s now. A heading here would be a second
    // name for the page, one scroll position away from the real one.
    expect(screen.queryByRole("heading")).toBeNull()
    // And the two controls that used to sit here.
    expect(bar.querySelector(".dr")).toBeNull()
    expect(bar.querySelector(".rail__store")).toBeNull()
  })

  it("starts the trail at the store, as crumbs() does", () => {
    const { container } = render(<Topbar pathname="/dashboard" storeName="Hollywood" />)
    const crumbs = container.querySelector(".crumbs") as HTMLElement
    expect(crumbs.textContent).toBe("Hollywood/Overview")
    expect(crumbs.querySelector("b")?.textContent).toBe("Overview")
  })

  it("shows a crumb back to the parent on a detail route, and names the record itself", () => {
    // The route IS the hierarchy (note 48): /dashboard/invoices/I28517 makes
    // Invoices the parent, and nothing is hand-wired.
    render(<Topbar pathname="/dashboard/invoices/I28517" storeName="Hollywood" leaf="I28517" />)
    const crumb = screen.getByRole("link", { name: "Invoices" })
    expect(crumb.getAttribute("href")).toBe("/dashboard/invoices")
    expect(screen.getByRole("navigation", { name: /breadcrumb/i }).textContent).toBe(
      "Hollywood/Invoices/I28517",
    )
  })

  it("offers no parent crumb on a top-level page", () => {
    render(<Topbar pathname="/dashboard/invoices" storeName="Hollywood" />)
    expect(screen.queryByRole("link", { name: "Invoices" })).toBeNull()
  })

  it("opens the ⌘K surface through the same delegated attribute every .askmini uses", () => {
    // `data-askabout=""` — an empty question. `ask-surface.tsx` walks up from
    // the click target looking for `[data-askabout]`, so one listener serves
    // ⌘K, this button and every section head.
    const { container } = render(<Topbar pathname="/dashboard" />)
    const ask = container.querySelector(".askbtn") as HTMLElement
    expect(ask.getAttribute("data-askabout")).toBe("")
    expect(ask.querySelector("kbd")?.textContent).toBe("⌘K")
  })

  it("says when the figures were last synced", () => {
    const now = new Date(2026, 7, 24, 9, 12)
    render(
      <Topbar
        pathname="/dashboard"
        sync={{ state: "synced", at: new Date(2026, 7, 24, 9, 0), now }}
      />,
    )
    expect(screen.getByText(/synced 12 min ago/i)).toBeTruthy()
  })

  it("renders no sync chip at all when there is no reading — a dot that means nothing is worse than none", () => {
    const { container } = render(<Topbar pathname="/dashboard" />)
    expect(container.querySelector(".sync")).toBeNull()
  })
})
