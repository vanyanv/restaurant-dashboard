// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { render, screen, within, fireEvent } from "@testing-library/react"
import { Rail } from "@/components/counter/shell/rail"

const stores = [
  { id: "hollywood", name: "Hollywood", stage: "trading" as const },
  { id: "glendale", name: "Glendale", stage: "pre_open" as const },
  { id: "vannuys", name: "Van Nuys", stage: "warming_up" as const },
]

describe("Rail", () => {
  it("is a navigation landmark with an accessible name", () => {
    render(<Rail pathname="/dashboard" />)
    expect(screen.getByRole("navigation", { name: /sections/i })).toBeTruthy()
  })

  it("renders all seventeen destinations", () => {
    render(<Rail pathname="/dashboard" />)
    const nav = screen.getByRole("navigation", { name: /sections/i })
    expect(within(nav).getAllByRole("link")).toHaveLength(17)
  })

  it("renders the five group captions", () => {
    render(<Rail pathname="/dashboard" />)
    // Menu's caption and Menu's own first item share the literal string
    // "Menu". `.rail__cap` is the only one of the two rendered as a `<div>`,
    // so scoping the query to that tag disambiguates.
    for (const cap of ["Today", "Money", "Menu", "Stock and suppliers", "Admin"]) {
      expect(screen.getByText(cap, { selector: "div" })).toBeTruthy()
    }
  })

  it("marks exactly one destination current, and says so to a screen reader", () => {
    render(<Rail pathname="/dashboard/invoices" />)
    const current = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page")
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain("Invoices")
  })

  it("keeps the parent lit on a detail route", () => {
    render(<Rail pathname="/dashboard/invoices/I28517" />)
    const current = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page")
    expect(current[0].textContent).toContain("Invoices")
  })

  it("lights Overview alone on /dashboard, not all seventeen", () => {
    render(<Rail pathname="/dashboard" />)
    const current = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page")
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain("Overview")
  })

  it("groups its links so the caption names the set", () => {
    render(<Rail pathname="/dashboard" />)
    const money = screen.getByRole("group", { name: "Money" })
    expect(within(money).getAllByRole("link")).toHaveLength(4)
  })

  it("emits the prototype's classes: .rail__cap and .rail__group, as siblings", () => {
    // The prototype writes the caption and the group as siblings inside ONE
    // unclassed container (`rail()`, line 8248). A per-group wrapper <div>
    // would be a fourth element in a stylesheet that has rules for three.
    const { container } = render(<Rail pathname="/dashboard" />)
    const cap = container.querySelector(".rail__cap") as HTMLElement
    expect(cap).toBeTruthy()
    expect((cap.nextElementSibling as HTMLElement).className).toBe("rail__group")
  })

  it("prints ⌘K on Ask alone — the one rail item whose shortcut is real", () => {
    const { container } = render(<Rail pathname="/dashboard" />)
    const kbs = container.querySelectorAll(".kb")
    expect(kbs).toHaveLength(1)
    expect(kbs[0].closest("a")?.textContent).toContain("Ask")
  })

  // THE FIRST OF TASK 5'S THREE STRUCTURAL CORRECTIONS.
  describe("the store switcher lives here, not in the topbar", () => {
    it("renders the .rail__store trigger inside the rail", () => {
      const { container } = render(
        <Rail pathname="/dashboard" stores={stores} selectedStoreId="hollywood" onSelectStore={() => {}} />,
      )
      const trigger = container.querySelector(".rail__store") as HTMLElement
      expect(trigger).toBeTruthy()
      expect(trigger.closest(".rail")).toBeTruthy()
      expect(trigger.querySelector(".nm")?.textContent).toBe("Hollywood")
    })

    it("puts the open state on the RAIL, because .rail.is-picking .storepop is the selector that shows it", () => {
      const { container } = render(
        <Rail pathname="/dashboard" stores={stores} selectedStoreId={null} onSelectStore={() => {}} />,
      )
      const rail = container.querySelector(".rail") as HTMLElement
      expect(rail.classList.contains("is-picking")).toBe(false)
      fireEvent.click(container.querySelector(".rail__store") as HTMLElement)
      expect(rail.classList.contains("is-picking")).toBe(true)
    })

    it("reports the chosen store and closes", () => {
      const onSelectStore = vi.fn()
      const { container } = render(
        <Rail pathname="/dashboard" stores={stores} selectedStoreId={null} onSelectStore={onSelectStore} />,
      )
      fireEvent.click(container.querySelector(".rail__store") as HTMLElement)
      fireEvent.click(screen.getByRole("button", { name: /glendale/i }))
      expect(onSelectStore).toHaveBeenCalledWith("glendale")
      expect((container.querySelector(".rail") as HTMLElement).classList.contains("is-picking")).toBe(false)
    })

    it("renders no store control at all when there are no stores, rather than an empty one", () => {
      const { container } = render(<Rail pathname="/dashboard" />)
      expect(container.querySelector(".rail__store")).toBeNull()
    })
  })

  describe(".rail__foot", () => {
    it("names the reader and their role, and opens settings", () => {
      const { container } = render(
        <Rail pathname="/dashboard" user={{ name: "Chris Karimian", role: "Owner" }} />,
      )
      const foot = container.querySelector(".rail__foot") as HTMLAnchorElement
      expect(foot).toBeTruthy()
      expect(foot.getAttribute("href")).toBe("/dashboard/settings")
      expect(foot.querySelector(".avatar")?.textContent).toBe("C")
      expect(foot.querySelector(".nm")?.textContent).toBe("Chris Karimian")
      expect(foot.querySelector(".rl")?.textContent).toBe("Owner · settings")
    })

    it("is absent when there is no reader to name", () => {
      const { container } = render(<Rail pathname="/dashboard" />)
      expect(container.querySelector(".rail__foot")).toBeNull()
    })
  })
})
