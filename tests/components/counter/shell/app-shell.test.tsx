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

describe("AppShell", () => {
  beforeEach(() => vi.unstubAllGlobals())

  it("renders the rail and the page content", () => {
    setReducedMotion(true)
    render(<AppShell pathname="/dashboard"><p>page body</p></AppShell>)
    expect(screen.getByRole("navigation", { name: /sections/i })).toBeTruthy()
    expect(screen.getByText("page body")).toBeTruthy()
  })

  it("puts the page content in a main landmark", () => {
    setReducedMotion(true)
    render(<AppShell pathname="/dashboard"><p>page body</p></AppShell>)
    expect(within(screen.getByRole("main")).getByText("page body")).toBeTruthy()
  })

  it("offers a skip link so a keyboard user can pass seventeen rail items", () => {
    setReducedMotion(true)
    render(<AppShell pathname="/dashboard"><p>body</p></AppShell>)
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
