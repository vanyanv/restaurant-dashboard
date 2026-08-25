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
    expect(tr.className).toBe("is-on")
    fireEvent.click(tr)
    fireEvent.keyDown(tr, { key: " " })
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(push).not.toHaveBeenCalled()
  })

  it("marks a selected row with is-on ON A data-ln ROW — the pair the sheet actually paints", () => {
    // `.tbl tbody tr[data-ln].is-on td:first-child` (counter-components.css:306)
    // is what draws the accent rail and bolds the first cell. It needs BOTH the
    // attribute and the class. `.is-sel` (207–209) has the wash and the bold
    // cell but NO rail, and nothing in the prototype ever emits it — its
    // `select()` toggles `is-on` (counter-prototype.html 8968–8976) on the rows
    // it emits as `data-ln="…" tabindex="0" role="button"` (6770, 6773). Task
    // 4's report had these the wrong way round, so note 53's eight pressable
    // weeks would have rendered a selected row with the design's rail missing —
    // and neither class is a landmark, so no gate would have said a word.
    const { container } = render(
      <Table
        columns={columns}
        rows={[
          { key: "w1", cells: { store: "Week of Aug 3" }, onSelect: () => {}, selected: true },
          { key: "w2", cells: { store: "Week of Aug 10" }, onSelect: () => {}, selected: false },
        ]}
      />,
    )
    expect(container.querySelectorAll("tr[data-ln].is-on")).toHaveLength(1)
    expect(container.querySelector("tr[data-ln].is-on")!.textContent).toContain("Week of Aug 3")
    expect(container.querySelectorAll(".is-sel")).toHaveLength(0)
  })

  describe("the guard a native anchor used to give for free", () => {
    it("does NOT navigate when the click ends a text-selection drag", () => {
      // A drag from one cell into another fires `click` on the row at mouseup.
      // Navigating away from figures someone has just selected is the worst
      // possible answer to "I wanted to copy this".
      render(<Table columns={columns} rows={rows} />)
      const cell = screen.getByText("Hollywood")
      const tr = cell.closest("tr")!
      const range = document.createRange()
      range.selectNodeContents(tr)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      expect(selection.isCollapsed).toBe(false)

      fireEvent.click(cell)
      expect(push).not.toHaveBeenCalled()

      selection.removeAllRanges()
      fireEvent.click(cell)
      expect(push).toHaveBeenCalledTimes(1)
    })

    it("does NOT navigate when the click lands on a control inside a cell", () => {
      const onAct = vi.fn()
      render(
        <Table
          columns={columns}
          rows={[
            {
              key: "hollywood",
              href: "/dashboard/stores/hollywood",
              cells: {
                store: "Hollywood",
                orders: <button type="button" onClick={onAct}>Flag</button>,
                net: "$7,468",
              },
            },
          ]}
        />,
      )
      fireEvent.click(screen.getByRole("button", { name: "Flag" }))
      expect(onAct).toHaveBeenCalledTimes(1)
      expect(push).not.toHaveBeenCalled()
    })

    it("still navigates from a plain cell — the guard is not a blanket off switch", () => {
      render(<Table columns={columns} rows={rows} />)
      fireEvent.click(screen.getByText("Hollywood"))
      expect(push).toHaveBeenCalledWith("/dashboard/stores/hollywood")
    })

    it("does not stand between the keyboard and the row", () => {
      // Enter on a focused row can neither land on a descendant nor end a drag,
      // so it deliberately does not go through the guard.
      render(<Table columns={columns} rows={rows} />)
      const tr = screen.getByText("Hollywood").closest("tr")!
      const range = document.createRange()
      range.selectNodeContents(tr)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      fireEvent.keyDown(tr, { key: "Enter" })
      expect(push).toHaveBeenCalledTimes(1)
      window.getSelection()!.removeAllRanges()
    })
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
