// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { Table } from "@/components/counter/surface/table"

const columns = [
  { key: "store", label: "Store" },
  { key: "orders", label: "Orders", numeric: true },
  { key: "net", label: "Net", numeric: true },
]

const rows = [
  { key: "hollywood", cells: ["Hollywood", "376", "$7,468"], href: "/dashboard/stores/hollywood" },
  { key: "glendale", cells: ["Glendale", "—", "—"] },
]

describe("Table", () => {
  it("renders a head and a row per record", () => {
    render(<Table columns={columns} rows={rows} />)
    expect(screen.getAllByRole("columnheader")).toHaveLength(3)
    expect(screen.getAllByRole("row")).toHaveLength(3) // head + 2
  })

  it("right-aligns numeric columns and gives their cells tabular numerals", () => {
    render(<Table columns={columns} rows={rows} />)
    const cell = screen.getByText("$7,468")
    expect(cell.className).toMatch(/text-right/)
    expect(cell.className).toMatch(/tabular-nums/)
  })

  it("a row with a destination is a link and is reachable by keyboard", () => {
    render(<Table columns={columns} rows={rows} />)
    const link = screen.getByRole("link", { name: /Hollywood/ })
    expect(link).toHaveAttribute("href", "/dashboard/stores/hollywood")
  })

  it("a row that opens nothing is NOT a link, not focusable, and wears no pointer", () => {
    render(<Table columns={columns} rows={rows} />)
    const glendale = screen.getByText("Glendale").closest("tr")!
    expect(glendale.querySelector("a")).toBeNull()
    expect(glendale.getAttribute("tabindex")).toBeNull()
    expect(glendale.className).not.toMatch(/cursor-pointer/)
    // and the navigable one does wear it
    const hollywood = screen.getByRole("link", { name: /Hollywood/ }).closest("tr")!
    expect(hollywood.className).toMatch(/cursor-pointer/)
  })

  it("exactly one native link stretches over the row, so the whole row is clickable through it", () => {
    // jsdom does no layout, so this cannot prove the overlay visually covers
    // the row — only that the row is a positioning context and the link
    // carries the stretch classes. Real coverage is verified in a browser.
    render(<Table columns={columns} rows={rows} />)
    const link = screen.getByRole("link", { name: /Hollywood/ })
    expect(link.className).toMatch(/after:absolute/)
    expect(link.className).toMatch(/after:inset-0/)
    const hollywood = link.closest("tr")!
    expect(hollywood.className).toMatch(/relative\b/)
    expect(hollywood.querySelectorAll("a")).toHaveLength(1)
  })

  it("scrolls horizontally inside its own container rather than the page", () => {
    const { container } = render(<Table columns={columns} rows={rows} />)
    expect(container.querySelector("[data-table-scroll]")!.className).toMatch(/overflow-x-auto/)
  })

  describe("sticky head (2a: maxHeight)", () => {
    // jsdom does no layout/scrolling, so this cannot prove the header stays
    // fixed on scroll — only that the markup is right. Real sticking is
    // verified in a browser; see the fix report for measured `top` values.
    it("is NOT sticky when maxHeight is unset — overflow-x-auto alone doesn't create a vertical scrollport", () => {
      render(<Table columns={columns} rows={rows} />)
      expect(screen.getAllByRole("columnheader")[0].className).not.toMatch(/sticky/)
    })

    it("is sticky, and the wrapper is constrained to scroll vertically, when maxHeight is set", () => {
      const { container } = render(<Table columns={columns} rows={rows} maxHeight="300px" />)
      expect(screen.getAllByRole("columnheader")[0].className).toMatch(/sticky/)
      const wrapper = container.querySelector("[data-table-scroll]") as HTMLElement
      expect(wrapper.style.maxHeight).toBe("300px")
      expect(wrapper.style.overflowY).toBe("auto")
    })
  })
})
