import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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
    // The repair is no longer inline on this element — it is a stylesheet
    // rule covering EVERY `.screen > *`, because the defect was never the page
    // head's. A FILLING `transform: none` computes as `matrix(1,0,0,1,0,0)`,
    // not `none`, which makes each direct child of `.screen` a stacking
    // context and a containing block for fixed positioning. Measured live:
    // `.dispatch` and all three `.sec` elements trapped a `position:fixed`
    // probe at 127/181/352/493px, while this element — repaired inline at the
    // time — held it at 0. Repairing one element left every section broken.
    //
    // Asserted against the source, because jsdom applies no stylesheet: the
    // rule's ABSENCE is the regression, and nothing else in the tree can see
    // it. `backwards` and not `none`, because these children carry staggered
    // delays and only `backwards` applies the `from` state during the delay —
    // `none` would flash each section at full opacity before animating it in.
    const repairs = readFileSync(
      resolve(process.cwd(), "src/styles/counter-repairs.css"),
      "utf8",
    )
    const rule = repairs.replace(/\s+/g, " ")
    expect(rule).toContain(".screen > *")
    expect(rule).toContain(".mscroll > *")
    expect(rule).toContain("animation-fill-mode: backwards")
    expect(rule).not.toContain("animation-fill-mode: none")

    // And the element itself carries no inline style any more.
    const { container } = render(<PageHead title="Monday's numbers" />)
    const head = container.querySelector(".pagehead") as HTMLElement
    expect(head.style.animationFillMode).toBe("")
  })

  it("carries the heading id a landmark can be labelled by", () => {
    render(<PageHead id="ct-title" title="Monday's numbers" />)
    expect(screen.getByRole("heading", { level: 2 }).id).toBe("ct-title")
  })
})
