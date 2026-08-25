// @vitest-environment jsdom
/**
 * `tbl()` at line 3055 of docs/counter/counter-prototype.html, as a React tree.
 * These assert the DOM the ported stylesheet is written against — the classes
 * and the nesting — not our own output shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const push = vi.fn()
// Table calls useRouter() on every render for a link row's navigation. Outside
// a real App Router tree — which is what a plain RTL render is — that throws.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

import { Table, type Row } from "@/components/counter/surface/table"

const columns = [
  { key: "store", label: "Store" },
  { key: "orders", label: "Orders", numeric: true },
  { key: "net", label: "Net", numeric: true },
]

const rows: Row[] = [
  {
    key: "hollywood",
    cells: { store: "Hollywood", orders: "376", net: "$7,468" },
    href: "/dashboard/stores/hollywood",
    ariaLabel: "Open Hollywood",
  },
  { key: "glendale", cells: { store: "Glendale", orders: "—", net: "—" } },
]

beforeEach(() => push.mockClear())

describe("Table", () => {
  it("emits the prototype's wrapper and table classes", () => {
    const { container } = render(<Table columns={columns} rows={rows} />)
    const scroll = container.querySelector(".tblscroll")
    expect(scroll).toBeTruthy()
    expect(scroll!.firstElementChild!.tagName).toBe("TABLE")
    expect(scroll!.firstElementChild!.className).toBe("tbl")
  })

  it("renders a head and a row per record", () => {
    const { container } = render(<Table columns={columns} rows={rows} />)
    expect(screen.getAllByRole("columnheader")).toHaveLength(3)
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2)
    // Counted in the DOM, not by role, on purpose: note 47 puts role="link" on
    // a row that opens something, which takes that row OUT of the table's
    // accessibility tree. That is the prototype's trade and this records it.
    expect(screen.getAllByRole("row")).toHaveLength(2) // the head row + the inert one
  })

  it("puts class=num on BOTH the th and the td of a numeric column, and on neither of a text one", () => {
    render(<Table columns={columns} rows={rows} />)
    const [store, orders, net] = screen.getAllByRole("columnheader")
    expect(store.className).toBe("")
    expect(orders.className).toBe("num")
    expect(net.className).toBe("num")
    expect(screen.getByText("$7,468").className).toBe("num")
    expect(screen.getByText("Hollywood").className).toBe("")
  })

  it("scopes every column header, so a screen reader reads the right one", () => {
    render(<Table columns={columns} rows={rows} />)
    for (const th of screen.getAllByRole("columnheader")) {
      expect(th).toHaveAttribute("scope", "col")
    }
  })

  it("a cell can carry its own class — the prototype's { v, cls }", () => {
    render(
      <Table
        columns={columns}
        rows={[{ key: "a", cells: { store: "A", orders: "1", net: { v: "$9", cls: "hot" } } }]}
      />,
    )
    expect(screen.getByText("$9").className).toBe("num hot")
  })

  it("a row that opens something carries data-goto, a tab stop, role=link and its label", () => {
    render(<Table columns={columns} rows={rows} />)
    const tr = screen.getByText("Hollywood").closest("tr")!
    expect(tr).toHaveAttribute("data-goto", "/dashboard/stores/hollywood")
    expect(tr).toHaveAttribute("tabindex", "0")
    expect(tr).toHaveAttribute("role", "link")
    expect(tr).toHaveAttribute("aria-label", "Open Hollywood")
  })

  it("a row that opens nothing carries NONE of those — note 47", () => {
    render(<Table columns={columns} rows={rows} />)
    const tr = screen.getByText("Glendale").closest("tr")!
    expect(tr.getAttribute("data-goto")).toBeNull()
    expect(tr.getAttribute("tabindex")).toBeNull()
    expect(tr.getAttribute("role")).toBeNull()
    expect(tr.getAttribute("data-ln")).toBeNull()
  })

  it("clicking a link row navigates; clicking an inert row does nothing", () => {
    render(<Table columns={columns} rows={rows} />)
    fireEvent.click(screen.getByText("Glendale").closest("tr")!)
    expect(push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText("Hollywood").closest("tr")!)
    expect(push).toHaveBeenCalledWith("/dashboard/stores/hollywood")
  })

  it("Enter and Space open a link row, because a row is not a button — note 47", () => {
    render(<Table columns={columns} rows={rows} />)
    const tr = screen.getByText("Hollywood").closest("tr")!
    fireEvent.keyDown(tr, { key: "Enter" })
    fireEvent.keyDown(tr, { key: " " })
    expect(push).toHaveBeenCalledTimes(2)
    push.mockClear()
    fireEvent.keyDown(tr, { key: "a" })
    expect(push).not.toHaveBeenCalled()
  })

  it("a pressable row moves a control instead: role=button, data-ln, and no data-goto", () => {
    const onSelect = vi.fn()
    render(
      <Table
        columns={columns}
        rows={[{ key: "w1", cells: { store: "Week of Aug 3" }, onSelect, selected: true }]}
      />,
    )
    const tr = screen.getByText("Week of Aug 3").closest("tr")!
    expect(tr).toHaveAttribute("role", "button")
    expect(tr).toHaveAttribute("data-ln", "w1")
    expect(tr.getAttribute("data-goto")).toBeNull()
    expect(tr.className).toBe("is-sel")
    fireEvent.click(tr)
    fireEvent.keyDown(tr, { key: " " })
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(push).not.toHaveBeenCalled()
  })

  it("a row's own class comes through — the prototype's r.attrs", () => {
    render(
      <Table columns={columns} rows={[{ key: "a", cells: { store: "A" }, className: "is-hole" }]} />,
    )
    expect(screen.getByText("A").closest("tr")!.className).toBe("is-hole")
  })

  it("row.after is a SIBLING tr in tbody, never a child of the row it belongs to", () => {
    const { container } = render(
      <Table
        columns={columns}
        rows={[
          {
            key: "a",
            cells: { store: "A" },
            after: (
              <tr data-drawer>
                <td colSpan={3}>the drawer</td>
              </tr>
            ),
          },
          { key: "b", cells: { store: "B" } },
        ]}
      />,
    )
    const tbody = container.querySelector("tbody")!
    const trs = Array.from(tbody.children)
    expect(trs.map((t) => t.tagName)).toEqual(["TR", "TR", "TR"])
    // The drawer sits between its own row and the next one, at tbody level.
    expect(trs[1].hasAttribute("data-drawer")).toBe(true)
    expect(trs[0].querySelector("[data-drawer]")).toBeNull()
    expect(screen.getByText("the drawer").closest("tr")!.parentElement).toBe(tbody)
  })

  it("a row with a cell missing relative to columns does not crash — it just leaves a gap", () => {
    // Row.cells is keyed by column key, not positional, so columns[i] is never
    // dereferenced against a mismatched array index.
    const sparse: Row[] = [{ key: "x", cells: { store: "Partial" } }]
    expect(() => render(<Table columns={columns} rows={sparse} />)).not.toThrow()
    expect(screen.getByText("Partial")).toBeTruthy()
  })
})
