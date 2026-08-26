// @vitest-environment jsdom
/**
 * `AskSheet` against the prototype's own `.masksheet`, emitted inline inside
 * `P.overview.phone()` (`docs/counter/counter-prototype.html` line 4375).
 *
 * The differences from `AskBar` are the reason this is a second component and
 * not a variant prop, so each one is asserted here rather than described.
 */
import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { AskSheet } from "@/components/counter/ask/ask-sheet"

describe("AskSheet — the phone's way into Ask", () => {
  it("emits .masksheet with the row first and the chips after", () => {
    const { container } = render(
      <AskSheet prompt="Ask about today" href="/m/chat" suggestions={["Why is food cost over?", "Prep for Saturday?"]} />,
    )
    const sheet = container.firstElementChild!
    expect(sheet.className).toBe("masksheet")
    expect([...sheet.children].map((c) => c.getAttribute("class"))).toEqual(["row", "sugs"])
  })

  it("puts the glyph before the prompt, as .masksheet .row svg is written for", () => {
    const { container } = render(<AskSheet prompt="Ask about this range" href="/m/chat" />)
    const row = container.querySelector(".row")!
    expect([...row.children].map((c) => c.tagName.toLowerCase())).toEqual(["svg", "span"])
    expect(row.querySelector(".ph")!.textContent).toBe("Ask about this range")
  })

  it("carries NO ⌘K hint — a phone has no command key and the sheet has no kbd rule", () => {
    const { container } = render(<AskSheet prompt="Ask about today" href="/m/chat" />)
    expect(container.querySelector("kbd")).toBeNull()
  })

  it("labels no chip SUGGESTED — the desk's .sk is not on this surface", () => {
    const { container } = render(
      <AskSheet prompt="Ask" href="/m/chat" suggestions={["Why is food cost over?", "Prep for Saturday?"]} />,
    )
    expect(container.querySelector(".sk")).toBeNull()
  })

  it("navigates rather than carrying data-askabout, because no AskSurface is mounted here", () => {
    // A `data-askabout` on a surface with no listener is note 46's defect: a
    // shortcut printed on a page that opens nothing.
    const { container } = render(
      <AskSheet prompt="Ask about today" href="/m/chat" suggestions={["Why is food cost over?"]} />,
    )
    expect(container.querySelector("[data-askabout]")).toBeNull()
    expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "/m/chat",
      "/m/chat",
    ])
  })

  it("draws no .sugs at all when there are no suggestions", () => {
    const { container } = render(<AskSheet prompt="Ask about today" href="/m/chat" />)
    expect(container.querySelector(".sugs")).toBeNull()
  })

  it("gives every chip the class the sheet styles", () => {
    const { container } = render(
      <AskSheet prompt="Ask" href="/m/chat" suggestions={["One?", "Two?"]} />,
    )
    expect([...container.querySelectorAll(".sugs > *")].map((c) => c.getAttribute("class"))).toEqual([
      "sug",
      "sug",
    ])
  })
})
