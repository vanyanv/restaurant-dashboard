// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PageHead } from "@/components/counter/shell/page-head"

describe("PageHead", () => {
  it("is the prototype's .pagehead: a title block, then .phactions", () => {
    const { container } = render(
      <PageHead title="7 days to Aug 21" sub="Hollywood · Aug 15 – 21 · vs the same 4 weekdays">
        <span data-testid="control" />
      </PageHead>,
    )
    const head = container.querySelector(".pagehead") as HTMLElement
    expect(head).toBeTruthy()
    const [titles, actions] = [...head.children] as HTMLElement[]
    expect(titles.querySelector("h2")?.textContent).toBe("7 days to Aug 21")
    expect(titles.querySelector("p.sub")?.textContent).toBe(
      "Hollywood · Aug 15 – 21 · vs the same 4 weekdays",
    )
    expect(actions.className).toBe("phactions")
    expect(actions.querySelector("[data-testid=control]")).toBeTruthy()
  })

  it("uses h2, because .pagehead h2 is the selector that sets the display face", () => {
    // Not a heading-level opinion: `.pagehead h2` (counter-components.css:145)
    // is Bricolage at 22px with -.03em tracking, and an <h1> gets none of it.
    // AppShell names the `main` landmark with this heading instead.
    render(<PageHead title="Monday's numbers" />)
    expect(screen.getByRole("heading", { level: 2, name: "Monday's numbers" })).toBeTruthy()
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull()
  })

  it("emits no .phactions when there is nothing to put in it", () => {
    const { container } = render(<PageHead title="Monday's numbers" />)
    expect(container.querySelector(".phactions")).toBeNull()
  })

  it("emits no .sub when the page has nothing to qualify its title with", () => {
    const { container } = render(<PageHead title="Monday's numbers" />)
    expect(container.querySelector("p.sub")).toBeNull()
  })

  it("cancels the entry animation's FORWARDS fill, which is what traps the date popover", () => {
    // Measured in Chromium, on the prototype as well as on us: `.screen > *`
    // animates `cnter` with `fill-mode: both`, whose `to` state is
    // `transform:none` — and a FILLED `transform:none` computes as
    // `matrix(1, 0, 0, 1, 0, 0)`, not `none`. That identity matrix makes
    // `.pagehead` a permanent stacking context (so every later `.sec` paints
    // over the open `.drpop`) and a permanent containing block for fixed
    // positioning (so below 640px the date sheet anchors to the page head and
    // lands 295px above the viewport). `.pagehead` is `.screen`'s first child,
    // so its animation-delay is 0 and the BACKWARDS half of the fill never
    // applied; and `cnter`'s `to` state is this element's default state, so
    // dropping the forwards half changes nothing that is drawn.
    const { container } = render(<PageHead title="Monday's numbers" />)
    const head = container.querySelector(".pagehead") as HTMLElement
    expect(head.style.animationFillMode).toBe("none")
  })

  it("carries the heading id a landmark can be labelled by", () => {
    render(<PageHead id="ct-title" title="Monday's numbers" />)
    expect(screen.getByRole("heading", { level: 2 }).id).toBe("ct-title")
  })
})
