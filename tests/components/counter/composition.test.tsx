// @vitest-environment jsdom
/**
 * R3: Section is the SOLE state renderer. Strip, Table, Meter and Cascade take
 * plain data and have no state branching of their own — the six-state
 * contract only exists when they are nested inside a Section.
 *
 * This test proves the intended composition end to end, across all six
 * states, with a Strip and a Table as Section's children: the children never
 * render when there is no data, and render correctly when there is.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// Table calls useRouter() for a link row's navigation; none of these rows
// carry an href, but the hook runs on every render and throws outside a real
// App Router tree.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }))
import { Section } from "@/components/counter/surface/section"
import { Strip } from "@/components/counter/surface/strip"
import { Table } from "@/components/counter/surface/table"
import { ready, stale, loading, failed, empty, notComputed, type SectionData } from "@/lib/counter/section-data"

interface Data {
  cells: { label: string; value: string }[]
  rows: { key: string; cells: Record<string, React.ReactNode> }[]
}

const columns = [{ key: "name", label: "Name" }]

const DATA: Data = {
  cells: [{ label: "Net sales", value: "$7,468" }],
  rows: [{ key: "a", cells: { name: "Row A" } }],
}

function renderSection(data: SectionData<Data>) {
  return render(
    <Section title="Net sales" data={data}>
      {(d) => (
        <>
          <Strip cells={d.cells} />
          <Table columns={columns} rows={d.rows} />
        </>
      )}
    </Section>,
  )
}

describe("Section + Strip + Table composition", () => {
  it("ready: children render, with the strip's figure and the table's row", () => {
    renderSection(ready(DATA))
    expect(screen.getByText("$7,468")).toBeTruthy()
    expect(screen.getByText("Row A")).toBeTruthy()
  })

  it("stale: children still render — the figures are still real, just not fresh", () => {
    renderSection(stale(DATA, new Date(2026, 7, 24, 9, 0)))
    expect(screen.getByText("$7,468")).toBeTruthy()
    expect(screen.getByText("Row A")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toMatch(/last good/i)
  })

  it("loading: children never render — only the skeleton", () => {
    renderSection(loading())
    expect(screen.queryByText("$7,468")).toBeNull()
    expect(screen.queryByText("Row A")).toBeNull()
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
  })

  it("failed: children never render — only the failure", () => {
    renderSection(failed("sync timed out", "retrySync"))
    expect(screen.queryByText("$7,468")).toBeNull()
    expect(screen.queryByText("Row A")).toBeNull()
    expect(screen.getByRole("alert")).toBeTruthy()
  })

  it("empty: children never render — only the empty explanation", () => {
    renderSection(empty("no_match"))
    expect(screen.queryByText("$7,468")).toBeNull()
    expect(screen.queryByText("Row A")).toBeNull()
    expect(screen.getByText(/nothing matched/i)).toBeTruthy()
  })

  it("not_computed: children never render — only the owed notice", () => {
    renderSection(notComputed("this ledger"))
    expect(screen.queryByText("$7,468")).toBeNull()
    expect(screen.queryByText("Row A")).toBeNull()
    expect(screen.getByText(/this ledger/)).toBeTruthy()
  })

  it("the heading is reachable from the section landmark via aria-labelledby", () => {
    renderSection(ready(DATA))
    const section = screen.getByRole("region")
    const heading = screen.getByRole("heading", { name: "Net sales" })
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id)
  })
})
