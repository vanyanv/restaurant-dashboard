// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { AppShell, EntryItem } from "@/components/counter/shell/app-shell"

function setReducedMotion(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches, media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {}, removeEventListener: () => {},
  }))
}

const stores = [
  { id: "hollywood", name: "Hollywood", stage: "trading" as const },
  { id: "glendale", name: "Glendale", stage: "pre_open" as const },
]

function shell(props: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return render(
    <AppShell pathname="/dashboard" title="7 days to Aug 21" {...props}>
      <p>page body</p>
    </AppShell>,
  )
}

describe("AppShell", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("builds the prototype's frame: rail, then .app > .topbar + .appwrap > .screenwrap > .screen", () => {
    const { container } = shell()
    const root = container.firstElementChild as HTMLElement
    expect(root.classList.contains("ct-root")).toBe(true)
    const rail = root.querySelector(":scope > aside.rail") as HTMLElement
    const app = root.querySelector(":scope > .app") as HTMLElement
    expect(rail).toBeTruthy()
    expect(app).toBeTruthy()
    expect(app.querySelector(":scope > .topbar")).toBeTruthy()
    const screen_ = app.querySelector(".appwrap > .screenwrap > main#ct-main") as HTMLElement
    expect(screen_).toBeTruthy()
    expect(screen_.classList.contains("screen")).toBe(true)
  })

  it("puts the page content in a main landmark", () => {
    shell()
    expect(within(screen.getByRole("main")).getByText("page body")).toBeTruthy()
  })

  // THE SECOND OF TASK 5'S THREE STRUCTURAL CORRECTIONS.
  it("puts the page head INSIDE the screen, above the page's own content", () => {
    const { container } = shell({ sub: "Hollywood · Aug 15 – 21" })
    const main = container.querySelector("main#ct-main") as HTMLElement
    const head = main.firstElementChild as HTMLElement
    expect(head.className).toBe("pagehead")
    expect(head.querySelector("h2")?.textContent).toBe("7 days to Aug 21")
    expect(head.querySelector("p.sub")?.textContent).toBe("Hollywood · Aug 15 – 21")
    // Not in the topbar, which is where it used to be.
    expect((container.querySelector(".topbar") as HTMLElement).querySelector("h2")).toBeNull()
  })

  it("puts the page's actions in .phactions inside .pagehead, not in the topbar", () => {
    const { container } = shell({ actions: <span data-testid="date-control" /> })
    expect(container.querySelector(".pagehead .phactions [data-testid=date-control]")).toBeTruthy()
    expect(container.querySelector(".topbar [data-testid=date-control]")).toBeNull()
  })

  // THE FIRST OF TASK 5'S THREE STRUCTURAL CORRECTIONS.
  it("puts the store switcher in the rail, not in the topbar", () => {
    const { container } = shell({ stores, selectedStoreId: "hollywood", onSelectStore: () => {} })
    expect(container.querySelector("aside.rail .rail__store")).toBeTruthy()
    expect(container.querySelector(".topbar .rail__store")).toBeNull()
  })

  it("names the main landmark with the page head's own heading", () => {
    // The heading LEVEL belongs to `.pagehead h2` — the selector that styles
    // it — so the landmark carries the naming instead.
    shell()
    const main = screen.getByRole("main")
    const heading = screen.getByRole("heading", { level: 2, name: "7 days to Aug 21" })
    expect(main.getAttribute("aria-labelledby")).toBe(heading.id)
    expect(heading.id).not.toBe("")
  })

  it("names the aggregate in the breadcrumb when a store list exists but none is picked", () => {
    const { container } = shell({ stores, onSelectStore: () => {} })
    expect((container.querySelector(".crumbs") as HTMLElement).textContent).toBe(
      "All stores/Overview",
    )
  })

  it("starts the trail at the page on a shell with no stores at all", () => {
    const { container } = shell()
    expect((container.querySelector(".crumbs") as HTMLElement).textContent).toBe("Overview")
  })

  it("gives the content column a floor of zero, so 390px does not scroll the document sideways", () => {
    // A bare `1fr` is `minmax(auto,1fr)`: its minimum is min-content, so the
    // widest table in the page pushes the whole grid — rail included — past
    // the viewport. Measured in a real browser at 390 before this.
    const { container } = shell()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain("grid-cols-[212px_minmax(0,1fr)]")
    // And the row, for the same reason vertically: with only an implicit
    // `auto` row the rail grew past `h-dvh` instead of scrolling inside it.
    expect(root.className).toContain("grid-rows-[minmax(0,1fr)]")
  })

  it("renders the rail's navigation", () => {
    shell()
    expect(screen.getByRole("navigation", { name: /sections/i })).toBeTruthy()
  })

  it("offers a skip link so a keyboard user can pass seventeen rail items", () => {
    shell()
    const skip = screen.getByRole("link", { name: /skip to content/i })
    expect(skip.getAttribute("href")).toBe("#ct-main")
  })

  it("EntryItem staggers by index when motion is allowed", () => {
    setReducedMotion(false)
    const { container } = render(
      <>
        <EntryItem index={0}><p>a</p></EntryItem>
        <EntryItem index={1}><p>b</p></EntryItem>
      </>,
    )
    const items = container.querySelectorAll("[data-entry-item]")
    expect((items[0] as HTMLElement).style.animationDelay).toBe("0ms")
    expect((items[1] as HTMLElement).style.animationDelay).toBe("36ms")
  })

  it("EntryItem emits no animation under reduced motion", () => {
    setReducedMotion(true)
    const { container } = render(<EntryItem index={3}><p>a</p></EntryItem>)
    const item = container.querySelector("[data-entry-item]") as HTMLElement
    expect(item.style.animationName).toBe("")
  })
})
